export async function copyImageToClipboard(src) {
    try {
        const res = await fetch(src);
        let blob = await res.blob();
        if (blob.type !== "image/png") {
            const img = new Image();
            img.crossOrigin = "anonymous";
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = src;
            });
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            canvas.getContext("2d").drawImage(img, 0, 0);
            blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        }
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return true;
    } catch (err) {
        console.error("Comfy Sidebar: Failed to copy image to clipboard", err);
        return false;
    }
}

export async function openFileOrFolder(img) {
    if (!img) return;

    try {
        const res = await fetch("/comfy-sidebar/open-folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filename: img.filename,
                subfolder: img.subfolder || "",
                type: img.type || "output"
            })
        });
        if (res.ok) return;
    } catch (e) {}

    const src = img.url || `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
    const a = document.createElement("a");
    a.href = src;
    a.target = "_blank";
    a.download = img.filename || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
}

import { app } from "/scripts/app.js";

export async function deleteFileOnServer(fileItem) {
    if (!fileItem || !fileItem.filename) return null;
    const isPermanent = app.ui?.settings?.getSettingValue?.("Comfy Sidebar.Permanent Delete on Disk Deletion") ?? false;
    try {
        const res = await fetch("/comfy-sidebar/delete-file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filename: fileItem.filename,
                subfolder: fileItem.subfolder || "",
                type: fileItem.type || "output",
                permanent: isPermanent
            })
        });
        if (res.ok) {
            const data = await res.json();
            return data.action || (isPermanent ? "deleted" : "trashed");
        }
        return null;
    } catch (e) {
        console.error("Comfy Sidebar: Failed to delete file on server", e);
        return null;
    }
}

export function removeImageFromNodeOutputs(nodeOutputs, targetImg) {
    if (!nodeOutputs || !targetImg || !targetImg.filename) return;

    const scanAndRemove = (obj) => {
        if (!obj || typeof obj !== "object") return;
        for (const key in obj) {
            const val = obj[key];
            if (Array.isArray(val)) {
                for (let i = val.length - 1; i >= 0; i--) {
                    const item = val[i];
                    if (item && typeof item === "object") {
                        if (item.filename === targetImg.filename && (item.subfolder || "") === (targetImg.subfolder || "")) {
                            val.splice(i, 1);
                        } else {
                            scanAndRemove(item);
                        }
                    } else if (typeof item === "string" && (item === targetImg.filename || item.endsWith("/" + targetImg.filename))) {
                        val.splice(i, 1);
                    }
                }
            } else if (typeof val === "object") {
                scanAndRemove(val);
            }
        }
    };

    for (const nodeId in nodeOutputs) {
        scanAndRemove(nodeOutputs[nodeId]);
    }
}

export function findNodeIdForImage(state, img) {
    if (!state || !state.nodeOutputs || !img) return null;
    for (const nodeId in state.nodeOutputs) {
        const out = state.nodeOutputs[nodeId];
        for (const key in out) {
            const val = out[key];
            if (Array.isArray(val)) {
                if (val.some(i => i && typeof i === "object" && i.filename === img.filename)) {
                    return nodeId;
                }
            } else if (val && typeof val === "object" && val.filename === img.filename) {
                return nodeId;
            }
        }
    }
    return null;
}
