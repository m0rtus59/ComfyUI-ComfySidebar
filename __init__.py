# Standard ComfyUI extension loader
from server import PromptServer
from aiohttp import web
import uuid

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Tells ComfyUI to serve and load the contents of the js/ folder
WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

# Create a unique session ID for this backend boot to track server restarts
server_session_id = str(uuid.uuid4())

# Register a custom route to check for backend restarts
@PromptServer.instance.routes.get("/classic-sidebar/session")
async def get_session_id(request):
    return web.json_response({"session_id": server_session_id})