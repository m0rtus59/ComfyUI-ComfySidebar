import { app } from "/scripts/app.js";
import { State } from "./state.js";

async function uploadDroppedImageToInput(imageObj) {
    const src = `/view?filename=${encodeURIComponent(imageObj.filename)}&type=${imageObj.type || 'output'}&subfolder=${encodeURIComponent(imageObj.subfolder || '')}`;
    try {
        const response = await fetch(src);
        if (!response.ok) return null;
        const blob = await response.blob();
        const file = new File([blob], imageObj.filename || "dropped_image.png", { type: blob.type });
        const formData = new FormData();
        formData.append("image", file);
        formData.append("overwrite", "true");
        formData.append("type", "input");
        const uploadRes = await fetch("/upload/image", { method: "POST", body: formData });
        if (!uploadRes.ok) return null;
        const uploadData = await uploadRes.json();
        return uploadData.name;
    } catch(e) {
        console.error("Comfy Sidebar: Failed to copy image to input.", e);
        return null;
    }
}

export function setupDragAndDrop() {
    document.addEventListener("dragover", (e) => {
        e.preventDefault(); 
        e.dataTransfer.dropEffect = "copy";
    });

    document.addEventListener("drop", async (e) => {
        const isSidebarDrop = e.target.closest('.comfyui-sidebar, .comfy-sidebar, [class*="sidebar"]') || 
                              (State.sidebarContainer && State.sidebarContainer.contains(e.target));
        if (isSidebarDrop) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const canvas = app.canvas;
        if (!canvas || !canvas.graph) return;

        // 1. Check for standard workflow JSON data drop
        const jsonStr = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
        if (jsonStr) {
            try {
                const workflow = JSON.parse(jsonStr);
                if (workflow && workflow.nodes) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (app.loadGraphData) {
                        app.loadGraphData(workflow);
                    } else if (app.handleFile) {
                        const file = new File([jsonStr], "workflow.json", { type: "application/json" });
                        await app.handleFile(file);
                    }
                    return;
                }
            } catch (err) {}
        }

        // 2. Check for native image URL drop
        const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
        if (url) {
            try {
                const urlObj = new URL(url, window.location.origin);
                if (urlObj.pathname === "/view") {
                    const filename = urlObj.searchParams.get("filename");
                    const type = urlObj.searchParams.get("type") || "output";
                    const subfolder = urlObj.searchParams.get("subfolder") || "";

                    if (filename) {
                        e.preventDefault();
                        e.stopPropagation();

                        let targetNode = null;
                        if (canvas.convertEventToCanvasOffset) {
                            const pos = canvas.convertEventToCanvasOffset(e);
                            targetNode = canvas.graph.getNodeOnPos(pos[0], pos[1]);
                        } else {
                            const rect = canvas.canvas.getBoundingClientRect();
                            targetNode = canvas.graph.getNodeOnPos((e.clientX - rect.left - canvas.ds.offset[0]) / canvas.ds.scale, (e.clientY - rect.top - canvas.ds.offset[1]) / canvas.ds.scale);
                        }

                        if (targetNode && (targetNode.type?.includes("LoadImage") || targetNode.widgets?.some(w => w.name === "image"))) {
                            const widget = targetNode.widgets?.find(w => w.name === "image");
                            if (widget) {
                                const newFilename = await uploadDroppedImageToInput({ filename, type, subfolder });
                                if (newFilename) {
                                    widget.value = newFilename;
                                    if (widget.callback) widget.callback(widget.value);
                                    targetNode.imgs = null;
                                    app.graph.setDirtyCanvas(true, true);
                                }
                            }
                        } else {
                            const src = `/view?filename=${encodeURIComponent(filename)}&type=${type}&subfolder=${encodeURIComponent(subfolder)}`;
                            const res = await fetch(src);
                            if (res.ok) {
                                const blob = await res.blob();
                                const file = new File([blob], filename || "workflow.png", { type: blob.type });

                                if (app.handleFile) await app.handleFile(file);
                                else if (app.canvas?.handleDropItem) app.canvas.handleDropItem({ getAsFile: () => file });
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Comfy Sidebar: Failed to handle dropped native URL:", err);
            }
        }
    }, true);
}