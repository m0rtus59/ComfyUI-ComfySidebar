# ComfyUI-ComfySidebar

A lightweight, high-performance ComfyUI extension that replaces the cluttered stock Job History/Queue interface with a compact drag&drop queue panel, inspired by the pre-vue ComfyUI frontend design. 

> ⚠️ **Note:** This repository was developed collaboratively with AI. While it is fully functional and has been tested, there is always room for optimization. If you have ideas for improvements, contributions via Pull Requests are highly welcome!

## ✨ Features

* **Advanced Drag & Drop Support**: Designed specifically for precise mouse pointer controls. Easily drag previous generations back to the empty canvas to restore workflows, or drop images directly into `LoadImage` and input nodes to hot-swap them.
* **High-Visibility Preview Cards**: Keep your past runs instantly recognizable. Supports aspect-ratio locked thumbnails for images and auto-playing muted loops for video formats, as well as clean rendering for multi-line text outputs.
* **Quick Save Buttons**: Dedicated interactive shortcuts appear on hover, allowing you to instantly download generation outputs or export exact workflow JSON files with a single click.
* **Compact Adaptive Design**: A clean, smart layout that automatically balances single or multi-column grids based on your sidebar width. It maximizes viewable content and respects your active screen area without wasting precious space.
* **Live Queue Tracking**: Stay informed on your server state. Includes a visual progress bar that tracks generations dynamically and displays the exact node title currently being executed.
* A compact topbar layout displaying both workflow tabs and the control panel on a single unified top bar. See the 'Comfy Layout' toggle in the settings.
* Toggles to hide buttons you don't need from the side panel.
* **[NEW]** Preview compare slider - just click the result image preview in the sidebar, and then `Shift+Click` another to load it alongside the first one for pixel by pixel comparison. 
* **[NEW]** Prevent certain nodes from showing the output in the queue bar and intermediate results. `Ctrl+Q` to toggle. 

<img width="385" height="336" alt="image" src="https://github.com/user-attachments/assets/743fbf85-9281-4561-9dd0-cd9af4d8c0e4" />


## 🛠️ Installation

Clone the repository directly into your ComfyUI custom nodes directory:

```bash
cd /path/to/ComfyUI/custom_nodes
git clone https://github.com/m0rtus59/ComfyUI-ComfySidebar.git

```

Restart your ComfyUI server and refresh the browser tab.

## ⚙️ Configuration

Additional tweaks are seamlessly integrated into the standard ComfyUI Settings panel. From there, you can adjust thresholds or fully replace the stock V2 panel by enabling options like **"Override Stock Job History Tab"**.

## ⌨️ Shortcuts

* **`Q`**: Instantly toggles the sidebar panel open or closed. Safely ignores inputs if you are currently typing inside a text field, input area, or combo box.
