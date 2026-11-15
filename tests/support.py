"""Test harness: loads the extension's __init__.py with ComfyUI's `server` / `folder_paths` stubbed.

Run from the repository root:  python -m unittest discover -s tests -v
Requires only `aiohttp` (already a ComfyUI dependency).
"""
import asyncio
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class _Routes:
    def __init__(self):
        self.handlers = {}

    def _decorator(self, method):
        def with_path(path):
            def register(fn):
                self.handlers[(method, path)] = fn
                return fn
            return register
        return with_path

    @property
    def get(self):
        return self._decorator("GET")

    @property
    def post(self):
        return self._decorator("POST")


class FakeRequest:
    def __init__(self, body=None, query=None, match_info=None, content_type="application/json"):
        self._body = body
        self.query = query or {}
        self.match_info = match_info or {}
        self.content_type = content_type

    async def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class Env:
    """A throw-away ComfyUI-like directory layout plus the loaded extension module."""

    def __init__(self):
        self.base = os.path.realpath(tempfile.mkdtemp(prefix="comfysidebar-test-"))
        self.dirs = {name: os.path.join(self.base, name) for name in ("output", "input", "temp")}
        for d in self.dirs.values():
            os.makedirs(d)

        routes = _Routes()
        server = types.ModuleType("server")
        server.PromptServer = type("PromptServer", (), {"instance": types.SimpleNamespace(routes=routes)})

        dirs = self.dirs
        folder_paths = types.ModuleType("folder_paths")
        folder_paths.get_output_directory = lambda: dirs["output"]
        folder_paths.get_input_directory = lambda: dirs["input"]
        folder_paths.get_temp_directory = lambda: dirs["temp"]
        folder_paths.folder_names_and_paths = {}
        folder_paths.get_folder_paths = lambda name: []

        self._saved = {k: sys.modules.get(k) for k in ("server", "folder_paths", "comfysidebar", "comfysidebar.prompt_search")}
        sys.modules["server"] = server
        sys.modules["folder_paths"] = folder_paths

        spec = importlib.util.spec_from_file_location(
            "comfysidebar", os.path.join(ROOT, "__init__.py"), submodule_search_locations=[ROOT])
        self.module = importlib.util.module_from_spec(spec)
        sys.modules["comfysidebar"] = self.module
        spec.loader.exec_module(self.module)
        self.routes = routes

    def write(self, kind, relpath, data=b"x"):
        path = os.path.join(self.dirs[kind], *relpath.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return path

    def call(self, method, path, request):
        handler = self.routes.handlers[(method, path)]
        response = asyncio.run(handler(request))
        text = getattr(response, "text", None)
        payload = json.loads(text) if text else None
        return response.status, payload

    def post(self, path, body, **kw):
        return self.call("POST", path, FakeRequest(body, **kw))

    def close(self):
        for key, value in self._saved.items():
            if value is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = value
        shutil.rmtree(self.base, ignore_errors=True)
