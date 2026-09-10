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
    return real_target == real_base or real_target.startswith(real_base + os.sep)


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


def resolve_existing_path(filename="", subfolder="", folder_type="output"):
    """Finds the actual location of a file or folder across all candidate root directories."""
    candidates = get_all_candidate_roots(subfolder, folder_type)

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

        target_file, root = resolve_existing_path(filename, subfolder, folder_type)

        if not target_file or not os.path.isfile(target_file) or not is_path_safe(root, target_file):
            return web.json_response({"error": "File not found or unsafe path"}, status=404)

        # Try moving to Recycle Bin / Trash first, fallback to os.remove
        try:
            import send2trash
            send2trash.send2trash(target_file)
        except Exception:
            os.remove(target_file)

        return web.json_response({"success": True, "deleted": target_file})
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


# ============================================================================
# Local Three.js Proxy & Offline Cache (Bypasses CSP & --disable-api-nodes)
# ============================================================================
SIDEBAR_CACHE_DIR = os.path.join(os.path.dirname(__file__), "js", "vendor", "cache")

@PromptServer.instance.routes.get("/comfy-sidebar/three-proxy/{path:.*}")
async def three_proxy_handler(request):
    raw_path = request.match_info.get("path", "").lstrip("/")
    if not raw_path:
        return web.Response(status=404)

    query = request.query_string
    full_req = f"{raw_path}?{query}" if query else raw_path
    
    os.makedirs(SIDEBAR_CACHE_DIR, exist_ok=True)
    import re
    safe_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', full_req)
    if not any(safe_name.endswith(ext) for ext in [".js", ".mjs", ".wasm", ".bin", ".json"]):
        safe_name += ".js"
    cache_file = os.path.join(SIDEBAR_CACHE_DIR, safe_name)

    # 1. Serve immediately from disk cache if present
    if os.path.isfile(cache_file) and os.path.getsize(cache_file) > 0:
        content_type = "application/wasm" if raw_path.endswith(".wasm") else "application/javascript"
        return web.FileResponse(cache_file, headers={"Content-Type": content_type})

    # 2. Otherwise download via Python (not blocked by browser CSP)
    url = f"https://esm.sh/{full_req}"
    try:
        import urllib.request
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw_data = resp.read()

            if raw_path.endswith((".wasm", ".bin", ".png", ".jpg")):
                with open(cache_file, "wb") as f:
                    f.write(raw_data)
                return web.Response(body=raw_data, content_type="application/octet-stream")

            content = raw_data.decode("utf-8", errors="replace")
            # Rewrite absolute esm.sh paths to route through our local 'self' proxy
            content = content.replace("https://esm.sh/", "/comfy-sidebar/three-proxy/")
            # Rewrite root-relative module paths (e.g. from "/v135/...")
            content = re.sub(
                r'((?:from|import)\s*["\'])/(v\d+|[a-zA-Z0-9@_.~-]+/)',
                r'\1/comfy-sidebar/three-proxy/\2',
                content
            )

            with open(cache_file, "w", encoding="utf-8") as f:
                f.write(content)

            return web.Response(text=content, content_type="application/javascript")
    except Exception as e:
        return web.Response(text=f"/* Proxy error fetching {url}: {e} */", status=502, content_type="application/javascript")