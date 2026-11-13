import asyncio
import os
import platform
import subprocess
import threading
from aiohttp import web
from server import PromptServer
import folder_paths

from . import prompt_search

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


def resolve_existing_path(filename="", subfolder="", folder_type="output", candidate_roots=None, strict=False):
    """Finds the actual location of a file or folder across all candidate root directories.

    strict=True is for destructive operations: the file must exist at exactly
    <root>/<subfolder>/<filename> (no fallback to a same-named file in the root),
    and only the root matching `folder_type` (output/input/temp) is considered.
    """
    candidates = candidate_roots if candidate_roots is not None else get_all_candidate_roots(subfolder, folder_type)

    if strict:
        type_dirs = {
            "output": folder_paths.get_output_directory(),
            "input": folder_paths.get_input_directory(),
            "temp": folder_paths.get_temp_directory(),
        }
        wanted = type_dirs.get(folder_type)
        if wanted is None:
            return None, None
        wanted = os.path.realpath(wanted)
        if not filename:
            return None, None
        for root in candidates:
            if os.path.realpath(root) != wanted:
                continue
            p = os.path.join(root, subfolder, filename) if subfolder else os.path.join(root, filename)
            if os.path.isfile(p) and is_path_safe(root, p):
                return p, root
        return None, None

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


_GALLERY_EXTS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif",
    ".mp4", ".webm", ".mov", ".mkv",
    ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac",
    ".glb", ".gltf", ".obj", ".fbx", ".stl",
    ".json"
}


def _relative_subfolder(directory, output_dir):
    rel_sub = os.path.relpath(directory, output_dir).replace("\\", "/")
    return "" if rel_sub == "." else rel_sub


def _list_gallery(subfolder, search, cancel):
    """Blocking directory listing / prompt search. Runs in a worker thread.

    Returns (http_status, json_payload).
    """
    output_dir = folder_paths.get_output_directory()
    target_dir = os.path.realpath(os.path.join(output_dir, subfolder)) if subfolder else os.path.realpath(output_dir)

    if not is_path_safe(output_dir, target_dir):
        return 403, {"error": "Unsafe path"}

    if not os.path.exists(target_dir) or not os.path.isdir(target_dir):
        return 200, {"subfolder": subfolder, "folders": [], "files": []}

    folders = []
    files = []

    if search:
        # Recursive filename + prompt-text search. Prompt metadata is only read for PNGs.
        for root, dirs, fnames in os.walk(target_dir):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for fname in fnames:
                if cancel.is_set():
                    return 200, {
                        "subfolder": subfolder.replace("\\", "/"),
                        "folders": folders,
                        "files": files
                    }
                if fname.startswith("."):
                    continue
                ext = os.path.splitext(fname)[1].lower()
                if ext not in _GALLERY_EXTS:
                    continue

                fpath = os.path.join(root, fname)
                matched = search in fname.lower()
                if not matched and ext == ".png":
                    matched = search in prompt_search.get_prompt_search_text(fpath)
                if matched:
                    try:
                        stat = os.stat(fpath)
                    except (PermissionError, FileNotFoundError):
                        continue
                    files.append({
                        "filename": fname,
                        "subfolder": _relative_subfolder(root, output_dir),
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
                        folders.append({
                            "name": entry.name,
                            "subfolder": os.path.relpath(entry.path, output_dir).replace("\\", "/"),
                            "mtime": entry.stat().st_mtime
                        })
                    elif entry.is_file(follow_symlinks=False):
                        if os.path.splitext(entry.name)[1].lower() in _GALLERY_EXTS:
                            stat = entry.stat()
                            files.append({
                                "filename": entry.name,
                                "subfolder": _relative_subfolder(os.path.dirname(entry.path), output_dir),
                                "type": "output",
                                "mtime": stat.st_mtime,
                                "size": stat.st_size
                            })
                except (PermissionError, FileNotFoundError):
                    continue

    folders.sort(key=lambda x: x["name"].lower())
    files.sort(key=lambda x: x["mtime"], reverse=True)

    return 200, {
        "subfolder": subfolder.replace("\\", "/"),
        "folders": folders,
        "files": files
    }


_LOCALES_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), "locales")
_ALLOWED_LOCALE_FILES = {"main.json", "settings.json"}


@PromptServer.instance.routes.get("/comfy-sidebar/locales/{lang}/{filename}")
async def locale_file_handler(request):
    lang = request.match_info.get("lang", "").strip()
    filename = request.match_info.get("filename", "").strip()
    if not lang or filename not in _ALLOWED_LOCALE_FILES:
        return web.json_response({"error": "Not found"}, status=404)

    target_file = os.path.join(_LOCALES_DIR, lang, filename)
    if not is_path_safe(_LOCALES_DIR, target_file) or not os.path.isfile(target_file):
        return web.json_response({"error": "Not found"}, status=404)

    return web.FileResponse(target_file)


@PromptServer.instance.routes.get("/comfy-sidebar/gallery/list")
async def gallery_list_handler(request):
    try:
        subfolder = request.query.get("subfolder", "").strip().strip("/\\")
        search = request.query.get("search", "").strip().lower()

        # Scanning can touch thousands of files: keep it off the event loop so
        # ComfyUI's server (websocket, queue updates) stays responsive.
        cancel = threading.Event()
        loop = asyncio.get_running_loop()
        try:
            status, payload = await loop.run_in_executor(None, _list_gallery, subfolder, search, cancel)
        except asyncio.CancelledError:
            cancel.set()  # client went away / sent a newer search: stop scanning
            raise
        return web.json_response(payload, status=status)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.post("/comfy-sidebar/queue/prompt-search")
async def queue_prompt_search_handler(request):
    """Extract searchable prompt text from Queue API-format prompt graphs."""
    try:
        data = await request.json()
        prompts = data.get("prompts", [])
        if not isinstance(prompts, list) or len(prompts) > 32:
            return web.json_response({"error": "Expected up to 32 prompt graphs"}, status=400)

        texts = {}
        for item in prompts:
            if not isinstance(item, dict):
                continue
            pid = item.get("pid")
            graph = item.get("prompt")
            if pid is None or not isinstance(graph, dict):
                continue
            texts[str(pid)] = prompt_search.get_prompt_search_text_from_graph(graph)

        return web.json_response({"texts": texts})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


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

        target_file, root = resolve_existing_path(filename, subfolder, folder_type, candidate_roots=delete_roots, strict=True)

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