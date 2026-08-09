# ComfyUI-ComfySidebar

A compact sidebar for ComfyUI that replaces the stock queue/history UI with a faster way to browse, preview, compare, and manage generation results.

> ⚠️ **Note:** This repository was developed collaboratively with AI. While it is fully functional and has been tested, there is always room for optimization. If you have ideas for improvements, contributions via Pull Requests are highly welcome!

## ✨ Features

* Browse generation results in a compact grid.
* Drag results back onto the canvas to restore workflows.
* Drag images directly into `LoadImage` and compatible input nodes.
* Preview images, videos, and text outputs.
* Compare two results side by side with `Shift+Click`.
* Download generated files or workflow JSON directly from result cards.
* Show queue progress and the node currently being executed.
* Hide sidebar tabs and UI elements you don't use.
* Optionally replace the stock Job History sidebar.
* Optional unified top bar for workflow tabs and controls.
* Exclude selected nodes from sidebar results with `Ctrl+Q`.

<img width="385" height="336" alt="image" src="https://github.com/user-attachments/assets/743fbf85-9281-4561-9dd0-cd9af4d8c0e4" />


## 🛠️ Installation

Clone the repository directly into your ComfyUI custom nodes directory:

```bash
cd /path/to/ComfyUI/custom_nodes
git clone https://github.com/m0rtus59/ComfyUI-ComfySidebar.git

```

Restart your ComfyUI server and refresh the browser tab.

## ⚙️ Configuration

Open **Settings → Comfy Sidebar** to configure:

* Queue grid layout
* Result aspect ratio
* Queue display mode
* Working node display
* Automatic cleanup of cancelled/failed jobs
* Sidebar tabs to hide
* Stock Job History replacement
* Graph button visibility
* Unified top bar layout

## ⌨️ Shortcuts

| Shortcut      | Action                                             |
| ------------- | -------------------------------------------------- |
| `Q`           | Toggle ComfySidebar                                |
| `Ctrl+Q`      | Toggle sidebar output filtering for selected nodes |
| `Click`       | Open result preview                                |
| `Shift+Click` | Compare another result                             |

## 📝 Notes

ComfySidebar integrates with the ComfyUI frontend and therefore depends on parts of its UI structure. Frontend changes in ComfyUI may require corresponding updates to this extension.

## License

See [LICENSE](LICENSE).