import os
import platform
import subprocess
import json
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
            # Use raw command string so Windows Explorer correctly parses /select,"path"
            subprocess.Popen(f'explorer /select,"{norm_path}"')
        else:
            subprocess.Popen(f'explorer "{norm_path}"')

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


def check_png_prompt_match(filepath, search_term):
    """Checks PNG prompt metadata strictly for text inputs matching search."""
    try:
        with open(filepath, "rb") as f:
            if f.read(8) != b"\x89PNG\r\n\x1a\n":
                return False
            while True:
                len_b = f.read(4)
                if len(len_b) < 4:
                    break
                length = int.from_bytes(len_b, "big")
                ctype = f.read(4)
                if ctype in (b"tEXt", b"iTXt"):
                    data = f.read(length)
                    if data.startswith(b"prompt\x00") or b'"inputs"' in data:
                        text = data.decode("utf-8", errors="ignore")
                        idx = text.find("{")
                        if idx != -1:
                            try:
                                prompt_dict = json.loads(text[idx:])
                                for node in prompt_dict.values():
                                    if isinstance(node, dict) and "inputs" in node:
                                        for val in node["inputs"].values():
                                            if isinstance(val, str) and search_term in val.lower():
                                                return True
                            except Exception:
                                pass
                elif ctype in (b"IDAT", b"IEND"):
                    break
                else:
                    f.seek(length, 1)
                f.seek(4, 1)
        return False
    except Exception:
        return False


@PromptServer.instance.routes.get("/comfy-sidebar/gallery/list")
async def gallery_list_handler(request):
    try:
        subfolder = request.query.get("subfolder", "").strip().strip("/\\")
        search = request.query.get("search", "").strip().lower()
        output_dir = folder_paths.get_output_directory()

        target_dir = os.path.realpath(os.path.join(output_dir, subfolder)) if subfolder else os.path.realpath(output_dir)

        if not is_path_safe(output_dir, target_dir):
            return web.json_response({"error": "Unsafe path"}, status=403)

        if not os.path.exists(target_dir) or not os.path.isdir(target_dir):
            return web.json_response({"subfolder": subfolder, "folders": [], "files": []})

        folders = []
        files = []

        supported_exts = {
            ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif",
            ".mp4", ".webm", ".mov", ".mkv",
            ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac",
            ".glb", ".gltf", ".obj", ".fbx", ".stl",
            ".json"
        }

        if search:
            # Recursive search in current directory and all subfolders
            for root, dirs, fnames in os.walk(target_dir):
                dirs[:] = [d for d in dirs if not d.startswith(".")]
                for fname in fnames:
                    if fname.startswith("."):
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    if ext in supported_exts:
                        fpath = os.path.join(root, fname)
                        matched = search in fname.lower()
                        if not matched and ext == ".png":
                            matched = check_png_prompt_match(fpath, search)

                        if matched:
                            rel_sub = os.path.relpath(root, output_dir).replace("\\", "/")
                            if rel_sub == ".":
                                rel_sub = ""
                            stat = os.stat(fpath)
                            files.append({
                                "filename": fname,
                                "subfolder": rel_sub,
                                "type": "output",
                                "mtime": stat.st_mtime,
                                "size": stat.st_size
                            })
        else:
            # Instant single-directory listing without reading files from disk
            with os.scandir(target_dir) as entries:
                for entry in entries:
                    if entry.name.startswith("."):
                        continue
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            rel_sub = os.path.relpath(entry.path, output_dir).replace("\\", "/")
                            folders.append({
                                "name": entry.name,
                                "subfolder": rel_sub,
                                "mtime": entry.stat().st_mtime
                            })
                        elif entry.is_file(follow_symlinks=False):
                            ext = os.path.splitext(entry.name)[1].lower()
                            if ext in supported_exts:
                                rel_sub = os.path.relpath(os.path.dirname(entry.path), output_dir).replace("\\", "/")
                                if rel_sub == ".":
                                    rel_sub = ""
                                stat = entry.stat()
                                files.append({
                                    "filename": entry.name,
                                    "subfolder": rel_sub,
                                    "type": "output",
                                    "mtime": stat.st_mtime,
                                    "size": stat.st_size
                                })
                    except (PermissionError, FileNotFoundError):
                        continue

        folders.sort(key=lambda x: x["name"].lower())
        files.sort(key=lambda x: x["mtime"], reverse=True)

        return web.json_response({
            "subfolder": subfolder.replace("\\", "/"),
            "folders": folders,
            "files": files
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


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