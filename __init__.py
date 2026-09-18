import os
import platform
import subprocess
from aiohttp import web
from server import PromptServer
import folder_paths

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


def is_path_safe(base_dir, target_path):
    """Prevents Path Traversal attacks."""
    real_base = os.path.realpath(base_dir)
    real_target = os.path.realpath(target_path)
    try:
        # commonpath reliably handles OS-specific case sensitivity and slash logic
        return os.path.commonpath([real_base, real_target]) == real_base
    except ValueError:
        # Raised if paths are on different drives on Windows
        return False


def get_all_candidate_roots(subfolder="", folder_type="output"):
    """Gathers all potential ComfyUI base directories (output, model folders, extra paths)."""
    roots = []
    try:
        roots.append(folder_paths.get_output_directory())
    except Exception:
        pass

    # Include specific model categories (loras, checkpoints, etc.)
    categories = ["loras", "checkpoints", "vae", "unet", "clip", "embeddings", "upscale_models"]
    if subfolder and subfolder in folder_paths.folder_names_and_paths:
        try:
            roots.extend(folder_paths.get_folder_paths(subfolder))
        except Exception:
            pass

    for cat in categories:
        try:
            roots.extend(folder_paths.get_folder_paths(cat))
        except Exception:
            pass

    try:
        roots.append(folder_paths.get_input_directory())
        roots.append(folder_paths.get_temp_directory())
    except Exception:
        pass

    # Deduplicate while preserving existence
    unique = []
    for r in roots:
        if r and r not in unique and os.path.exists(r):
            unique.append(r)
    return unique


def resolve_existing_path(filename="", subfolder="", folder_type="output", candidate_roots=None):
    """Finds the actual location of a file or folder across all candidate root directories."""
    candidates = candidate_roots if candidate_roots is not None else get_all_candidate_roots(subfolder, folder_type)

    if filename:
        for root in candidates:
            if subfolder:
                p1 = os.path.join(root, subfolder, filename)
                if os.path.isfile(p1) and is_path_safe(root, p1):
                    return p1, root
            p2 = os.path.join(root, filename)
            if os.path.isfile(p2) and is_path_safe(root, p2):
                return p2, root

    for root in candidates:
        if subfolder:
            d1 = os.path.join(root, subfolder)
            if os.path.isdir(d1) and is_path_safe(root, d1):
                return d1, root
        if os.path.isdir(root):
            return root, root

    return None, None


def open_file_in_os(target_path):
    """Fast, native cross-platform explorer launch."""
    system = platform.system()

    if system == "Windows":
        norm_path = os.path.normpath(target_path)
        if not os.path.exists(norm_path):
            raise FileNotFoundError(f"Path not found: {norm_path}")
        if os.path.isfile(norm_path):
            # Passed as a single argument so Windows Explorer highlights the file properly
            subprocess.Popen(["explorer", f"/select,{norm_path}"])
        else:
            subprocess.Popen(["explorer", norm_path])

    elif system == "Darwin":  # macOS
        if not os.path.exists(target_path):
            raise FileNotFoundError(f"Path not found: {target_path}")
        if os.path.isfile(target_path):
            subprocess.Popen(["open", "-R", target_path])
        else:
            subprocess.Popen(["open", target_path])

    else:  # Linux / Unix
        folder = os.path.dirname(target_path) if os.path.isfile(target_path) else target_path
        if not os.path.exists(folder):
            raise FileNotFoundError(f"Path not found: {folder}")
        if "DISPLAY" in os.environ or "WAYLAND_DISPLAY" in os.environ:
            subprocess.Popen(["xdg-open", folder], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            raise RuntimeError("Headless Linux server detected (no desktop GUI available).")


@PromptServer.instance.routes.post("/comfy-sidebar/open-folder")
async def open_folder_handler(request):
    try:
        data = await request.json()
        filename = (data.get("filename") or "").strip()
        subfolder = (data.get("subfolder") or "").strip()
        folder_type = (data.get("type") or "output").strip()

        target_path, _ = resolve_existing_path(filename, subfolder, folder_type)
        if not target_path:
            target_path = folder_paths.get_output_directory()

        open_file_in_os(target_path)
        return web.json_response({"success": True, "path": target_path})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


@PromptServer.instance.routes.post("/comfy-sidebar/delete-file")
async def delete_file_handler(request):
    try:
        data = await request.json()
        filename = (data.get("filename") or "").strip()
        subfolder = (data.get("subfolder") or "").strip()
        folder_type = (data.get("type") or "output").strip()

        if not filename:
            return web.json_response({"error": "No filename provided"}, status=400)

        # Strictly restrict deletion to generated output and temp files (protects models/checkpoints)
        delete_roots = [
            folder_paths.get_output_directory(),
            folder_paths.get_temp_directory()
        ]
        delete_roots = [os.path.realpath(r) for r in delete_roots if r and os.path.exists(r)]

        target_file, root = resolve_existing_path(filename, subfolder, folder_type, candidate_roots=delete_roots)

        if not target_file or not os.path.isfile(target_file) or not is_path_safe(root, target_file):
            return web.json_response({"error": "File not found or outside output directory"}, status=404)

        # Try moving to Recycle Bin / Trash first, fallback to os.remove
        permanent = bool(data.get("permanent", False))
        action = "deleted"
        if not permanent:
            try:
                import send2trash
                send2trash.send2trash(target_file)
                action = "trashed"
            except Exception:
                os.remove(target_file)
                action = "deleted"
        else:
            os.remove(target_file)
            action = "deleted"

        return web.json_response({"success": True, "deleted": target_file, "action": action})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.post("/comfy-sidebar/promote-output")
async def promote_output_handler(request):
    try:
        import shutil
        data = await request.json()
        raw_filename = (data.get("filename") or "").strip()
        filename = os.path.basename(raw_filename)
        subfolder = (data.get("subfolder") or "").strip()
        folder_type = (data.get("type") or "output").strip()

        target_file, root = resolve_existing_path(raw_filename, subfolder, folder_type)
        if not target_file or not os.path.isfile(target_file):
            return web.json_response({"error": "File not found"}, status=404)

        input_dir = folder_paths.get_input_directory()
        dest_path = os.path.join(input_dir, filename)
        if not is_path_safe(input_dir, dest_path):
            return web.json_response({"error": "Unsafe destination path"}, status=403)

        shutil.copy2(target_file, dest_path)
        return web.json_response({"name": filename})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)