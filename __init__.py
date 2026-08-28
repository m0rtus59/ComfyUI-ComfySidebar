import os
import platform
import subprocess
from aiohttp import web
from server import PromptServer
import folder_paths

# Standard ComfyUI extension loader
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


def is_path_safe(base_dir, target_path):
    """Prevents Path Traversal attacks by verifying the target stays inside base_dir."""
    real_base = os.path.realpath(base_dir)
    real_target = os.path.realpath(target_path)
    return real_target == real_base or real_target.startswith(real_base + os.sep)


def open_file_in_os(target_path):
    """Fast, native cross-platform explorer launch with zero latency."""
    system = platform.system()

    if system == "Windows":
        norm_path = os.path.normpath(target_path)
        if not os.path.exists(norm_path):
            raise FileNotFoundError(f"Path not found: {norm_path}")
        
        # Opens immediately and highlights the file if it exists, or opens the folder
        if os.path.isfile(norm_path):
            subprocess.Popen(["explorer", "/select,", norm_path])
        else:
            os.startfile(norm_path)

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
            subprocess.Popen(["xdg-open", folder])
        else:
            raise RuntimeError("Headless Linux server detected (no desktop GUI available).")


@PromptServer.instance.routes.post("/comfy-sidebar/open-folder")
async def open_folder_handler(request):
    try:
        data = await request.json()
        filename = (data.get("filename") or "").strip()
        subfolder = (data.get("subfolder") or "").strip()
        folder_type = (data.get("type") or "output").strip()

        # 1. Resolve base directory from ComfyUI settings / CLI arguments
        if folder_type == "input":
            candidate_bases = [folder_paths.get_input_directory()]
        elif folder_type == "temp":
            candidate_bases = [folder_paths.get_temp_directory()]
        elif subfolder in folder_paths.folder_names_and_paths:
            # Handles model categories (e.g. 'loras', 'checkpoints') and extra_model_paths.yaml
            candidate_bases = folder_paths.get_folder_paths(subfolder)
            subfolder = ""
        else:
            candidate_bases = [folder_paths.get_output_directory()]

        # 2. Find the existing path across valid candidates
        target_path = None
        for base_dir in candidate_bases:
            if not base_dir or not os.path.exists(base_dir):
                continue

            test_dir = os.path.join(base_dir, subfolder) if subfolder else base_dir
            if not is_path_safe(base_dir, test_dir):
                continue

            # Check if file exists inside test_dir
            if filename:
                test_file = os.path.join(test_dir, filename)
                if is_path_safe(base_dir, test_file) and os.path.exists(test_file):
                    target_path = test_file
                    break

            if os.path.exists(test_dir):
                target_path = test_dir

        if not target_path:
            # Fallback to the first base directory if specific path not found
            target_path = candidate_bases[0] if candidate_bases else folder_paths.get_output_directory()

        # 3. Open in native file explorer
        open_file_in_os(target_path)
        return web.json_response({"success": True, "path": target_path})

    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


@PromptServer.instance.routes.post("/comfy-sidebar/promote-output")
async def promote_output_handler(request):
    """Server-side copy of output files into the input folder without re-uploading."""
    try:
        import shutil
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "")
        folder_type = data.get("type", "output")

        base_output = folder_paths.get_output_directory() if folder_type == "output" else folder_paths.get_temp_directory()
        src_path = os.path.join(base_output, subfolder, filename) if subfolder else os.path.join(base_output, filename)

        if not os.path.exists(src_path) or not is_path_safe(base_output, src_path):
            return web.json_response({"error": "File not found"}, status=404)

        input_dir = folder_paths.get_input_directory()
        dest_filename = filename
        dest_path = os.path.join(input_dir, dest_filename)

        shutil.copy2(src_path, dest_path)
        return web.json_response({"name": dest_filename})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)