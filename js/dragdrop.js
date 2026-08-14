import { app } from "/scripts/app.js";
import { State } from "./state.js";

async function promoteOrUploadToInput(imageObj) {
    // 1. Try server-side promotion first (no browser RAM/re-upload overhead)
    try {
        const promoteRes = await fetch("/comfy-sidebar/promote-output", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(imageObj)
        });
        if (promoteRes.ok) {
            const data = await promoteRes.json();
            if (data.name) return data.name;
        }
    } catch (e) {}

    // 2. Fallback to browser blob pipeline if backend promotion endpoint is unavailable
    const src = `/view?filename=${encodeURIComponent(imageObj.filename)}&type=${imageObj.type || 'output'}&subfolder=${encodeURIComponent(imageObj.subfolder || '')}`;
    try {
        const response = await fetch(src);
        if (!response.ok) return null;
        const blob = await response.blob();
        const file = new File([blob], imageObj.filename || "dropped_file", { type: blob.type });
        const formData = new FormData();
        formData.append("image", file);
        formData.append("overwrite", "true");
        formData.append("type", "input");
        const uploadRes = await fetch("/upload/image", { method: "POST", body: formData });
        if (!uploadRes.ok) return null;
        const uploadData = await uploadRes.json();
        return uploadData.name;
    } catch(e) {
        console.error("Comfy Sidebar: Failed to copy file to input.", e);
        return null;
    }
}

async function handleWorkflowDrop(e) {
    const jsonStr = e.dataTransfer.getData("application/json");
    if (!jsonStr) return false;
    try {
        const workflow = JSON.parse(jsonStr);
        if (workflow && workflow.nodes) {
            if (app.loadGraphData) {
                app.loadGraphData(workflow);
            } else if (app.handleFile) {
                const file = new File([jsonStr], "workflow.json", { type: "application/json" });
                await app.handleFile(file);
            }
            return true;
        }
    } catch (err) {}
    return false;
}

async function handleMediaDrop(e) {
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (!url) return false;

    try {
        const urlObj = new URL(url, window.location.origin);
        if (urlObj.pathname !== "/view") return false;

        const filename = urlObj.searchParams.get("filename");
        const type = urlObj.searchParams.get("type") || "output";
        const subfolder = urlObj.searchParams.get("subfolder") || "";
        if (!filename) return false;

        const canvas = app.canvas;
        if (!canvas || !canvas.graph) return false;

        let targetNode = null;
        if (canvas.convertEventToCanvasOffset) {
            const pos = canvas.convertEventToCanvasOffset(e);
            targetNode = canvas.graph.getNodeOnPos(pos[0], pos[1]);
        } else if (canvas.canvas) {
            const rect = canvas.canvas.getBoundingClientRect();
            targetNode = canvas.graph.getNodeOnPos((e.clientX - rect.left - canvas.ds.offset[0]) / canvas.ds.scale, (e.clientY - rect.top - canvas.ds.offset[1]) / canvas.ds.scale);
        }

        const widget = targetNode?.widgets?.find(w => 
            w.name === "image" || w.name === "video" || w.name === "audio" || w.name === "audio_file" ||
            w.name === "file" || w.name === "video_path" || w.name === "model_file" || w.name === "3d_file" ||
            w.type === "image" || w.type === "customtext"
        );

        const isLoadNode = targetNode && (
            widget || 
            targetNode.type?.includes("LoadImage") || 
            targetNode.type?.includes("LoadVideo") || 
            targetNode.type?.includes("VHS_LoadVideo") || 
            targetNode.type?.includes("Load3D") || 
            targetNode.type?.includes("Load 3D") || 
            targetNode.type?.includes("LoadAudio") || 
            targetNode.type?.includes("Load Audio") || 
            targetNode.type?.includes("VHS_LoadAudio") || 
            targetNode.type?.includes("Preview3D")
        );

        if (isLoadNode) {
            const targetWidget = widget || targetNode.widgets?.[0];
            if (targetWidget) {
                const newFilename = await promoteOrUploadToInput({ filename, type, subfolder });
                if (newFilename) {
                    if (targetWidget.options && Array.isArray(targetWidget.options.values)) {
                        if (!targetWidget.options.values.includes(newFilename)) {
                            targetWidget.options.values.push(newFilename);
                        }
                    }
                    targetWidget.value = newFilename;
                    if (targetWidget.callback) targetWidget.callback(targetWidget.value);
                    targetNode.imgs = null;
                    app.graph.setDirtyCanvas(true, true);
                    return true;
                }
            }
        } else {
            const src = `/view?filename=${encodeURIComponent(filename)}&type=${type}&subfolder=${encodeURIComponent(subfolder)}`;
            const res = await fetch(src);
            if (res.ok) {
                const blob = await res.blob();
                const file = new File([blob], filename, { type: blob.type });
                if (app.handleFile) await app.handleFile(file);
                else if (app.canvas?.handleDropItem) app.canvas.handleDropItem({ getAsFile: () => file });
                return true;
            }
        }
    } catch (err) {
        console.error("Comfy Sidebar: Failed to handle dropped native URL:", err);
    }
    return false;
}

const dropHandlers = [
    handleWorkflowDrop,
    handleMediaDrop
];

export function setupDragAndDrop() {
    const onDragOver = (e) => {
        e.preventDefault(); 
        e.dataTransfer.dropEffect = "copy";
    };

    const onDrop = async (e) => {
        const isSidebarDrop = e.target.closest('.comfyui-sidebar, .comfy-sidebar, [class*="sidebar"]') || 
                              (State.sidebarContainer && State.sidebarContainer.contains(e.target));
        if (isSidebarDrop) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        for (const handler of dropHandlers) {
            if (await handler(e)) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }
    };

    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop, true);

    return () => {
        document.removeEventListener("dragover", onDragOver);
        document.removeEventListener("drop", onDrop, true);
    };
}