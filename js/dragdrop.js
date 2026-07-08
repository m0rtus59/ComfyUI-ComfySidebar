import { app } from "/scripts/app.js";
import { State } from "./state.js";

async function uploadDroppedImageToInput(imageObj) {
    const src = `/view?filename=${encodeURIComponent(imageObj.filename)}&type=${imageObj.type || 'output'}&subfolder=${encodeURIComponent(imageObj.subfolder || '')}`;
    try {
        const response = await fetch(src);
        const blob = await response.blob();
        const file = new File([blob], imageObj.filename || "dropped_image.png", { type: blob.type });
        const formData = new FormData();
        formData.append("image", file);
        formData.append("overwrite", "true");
        formData.append("type", "input");
        const uploadRes = await fetch("/upload/image", { method: "POST", body: formData });
        const uploadData = await uploadRes.json();
        return uploadData.name;
    } catch(e) {
        console.error("Comfy Sidebar: Failed to copy image to input.", e);
        return null;
    }
}

export function setupDragAndDrop() {
    document.addEventListener("dragover", (e) => {
        if (State.currentDraggedImgData) {
            e.preventDefault(); 
            e.dataTransfer.dropEffect = "copy";
        }
    });

    document.addEventListener("drop", async (e) => {
        if (!State.currentDraggedImgData) return;
        
        const canvas = app.canvas;
        if (canvas && canvas.graph) {
            let targetNode = null;
            if (canvas.convertEventToCanvasOffset) {
                const pos = canvas.convertEventToCanvasOffset(e);
                targetNode = canvas.graph.getNodeOnPos(pos[0], pos[1]);
            } else {
                const rect = canvas.canvas.getBoundingClientRect();
                targetNode = canvas.graph.getNodeOnPos((e.clientX - rect.left - canvas.ds.offset[0]) / canvas.ds.scale, (e.clientY - rect.top - canvas.ds.offset[1]) / canvas.ds.scale);
            }

            let droppedOnImageNode = false;

            if (targetNode && (targetNode.type.includes("LoadImage") || targetNode.widgets?.some(w => w.name === "image"))) {
                if (State.currentDraggedImgData.filename) {
                    e.preventDefault();
                    e.stopPropagation();
                    droppedOnImageNode = true;
                    const widget = targetNode.widgets.find(w => w.name === "image");
                    if (widget) {
                        const newFilename = await uploadDroppedImageToInput(State.currentDraggedImgData);
                        if (newFilename) {
                            widget.value = newFilename;
                            if (widget.callback) widget.callback(widget.value);
                            targetNode.imgs = null;
                            app.graph.setDirtyCanvas(true, true);
                        }
                    }
                }
            }

            if (!droppedOnImageNode) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    if (State.currentDraggedImgData.workflow) {
                        if (app.loadGraphData) {
                            app.loadGraphData(State.currentDraggedImgData.workflow);
                        } else if (app.handleFile) {
                            const jsonStr = JSON.stringify(State.currentDraggedImgData.workflow);
                            const file = new File([jsonStr], "workflow.json", { type: "application/json" });
                            await app.handleFile(file);
                        }
                    } else if (State.currentDraggedImgData.filename) {
                        const src = State.currentDraggedImgData.url || `/view?filename=${encodeURIComponent(State.currentDraggedImgData.filename)}&type=${State.currentDraggedImgData.type || 'output'}&subfolder=${encodeURIComponent(State.currentDraggedImgData.subfolder || '')}`;
                        const res = await fetch(src);
                        const blob = await res.blob();
                        const file = new File([blob], State.currentDraggedImgData.filename || "workflow.png", { type: blob.type });

                        if (app.handleFile) await app.handleFile(file);
                        else if (app.canvas?.handleDropItem) app.canvas.handleDropItem({ getAsFile: () => file });
                    }
                } catch (err) {
                    console.error("Comfy Sidebar: Failed to synthesize workflow file drop:", err);
                }
            }
        }
        State.currentDraggedImgData = null;
    }, true);
}