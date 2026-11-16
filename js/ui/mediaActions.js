import { getSetting, setSetting } from "../core/settings.js";
import { SettingIds } from "../core/constants.js";
import { askTrashFallback } from "./deleteFallbackDialog.js";
import { showNotification } from "../utils/nodeRenumber.js";
import { t } from "../core/i18n.js";

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

/**
 * Deletes a generated file on the server.
 * Resolves to "trashed" / "deleted" on success, "missing" if the file was already gone,
 * or null if it could not be deleted (error, or the user cancelled the trash-failed dialog).
 *
 * If the Recycle Bin can't be used the server refuses to delete (HTTP 409) rather than silently
 * deleting permanently; we then ask the user whether to turn on direct deletion or retry
 * after fixing send2trash.
 */
export async function deleteFileOnServer(fileItem, { suppressDialog = false } = {}) {
    if (!fileItem || !fileItem.filename) return null;
    let permanent = !!getSetting(SettingIds.PERMANENT_DELETE, false);

    for (let attempt = 0; attempt < 5; attempt++) {
        let res;
        let data = {};
        try {
            res = await fetch("/comfy-sidebar/delete-file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: fileItem.filename,
                    subfolder: fileItem.subfolder || "",
                    type: fileItem.type || "output",
                    permanent
                })
            });
            data = await res.json().catch(() => ({}));
        } catch (e) {
            console.error("Comfy Sidebar: Failed to delete file on server", e);
            return null;
        }

        if (res.ok) return data.action || (permanent ? "deleted" : "trashed");
        if (res.status === 404) return "missing"; // already gone (e.g. temp folder was cleared)

        const trashProblem = !permanent && (data.code === "trash_unavailable" || data.code === "trash_failed");
        if (!trashProblem) {
            console.error("Comfy Sidebar: Failed to delete file on server", data.error || res.statusText);
            return null;
        }
        if (suppressDialog) return null; // the user already said "cancel" for this batch

        const choice = await askTrashFallback({
            filename: fileItem.filename,
            code: data.code,
            error: data.error,
            python: data.python
        });

        if (choice === "permanent") {
            setSetting(SettingIds.PERMANENT_DELETE, true);
            permanent = true;
        } else if (choice !== "retry") {
            return null;
        }
    }
    return null;
}

/**
 * Deletes several files from disk and tells the user what happened.
 * Returns true when nothing was left undeleted. Files that were already gone count as done.
 * Callers must keep their card when this returns false (e.g. the user cancelled the dialog),
 * otherwise the card would vanish while its files are still on disk.
 */
export async function deleteFilesWithFeedback(files, title = "Delete Files") {
    let deleted = 0;
    let blocked = 0;
    let lastAction = "trashed";
    let cancelled = false;
    for (const file of files) {
        // After one cancelled dialog, don't ask again for the rest of this batch.
        const action = await deleteFileOnServer(file, { suppressDialog: cancelled });
        if (action === "trashed" || action === "deleted") {
            deleted++;
            lastAction = action;
        } else if (action !== "missing") {
            blocked++;
            cancelled = true;
        }
    }
    if (deleted > 0) {
        const msg = lastAction === "trashed"
            ? t("Moved {count} file(s) to Recycle Bin.", { count: deleted })
            : t("Permanently deleted {count} file(s).", { count: deleted });
        showNotification(msg, "success", title);
    }
    if (blocked > 0) {
        showNotification(t("Could not delete {count} file(s). The card was kept.", { count: blocked }), "warn", title);
    }
    return blocked === 0;
}

export async function moveTempImageToOutput(fileItem) {
    if (!fileItem || !fileItem.filename || fileItem.type !== "temp") return null;
    try {
        const res = await fetch("/comfy-sidebar/move-temp-to-output", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filename: fileItem.filename,
                subfolder: fileItem.subfolder || "",
                type: fileItem.type
            })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            console.error("Comfy Sidebar: Failed to move temp image", data.error || res.statusText);
            return null;
        }
        return await res.json();
    } catch (err) {
        console.error("Comfy Sidebar: Failed to move temp image", err);
        return null;
    }
}

export function updateMovedImageReferences(value, oldImage, moved) {
    const oldFilename = oldImage?.filename;
    const oldSubfolder = oldImage?.subfolder || "";
    if (!value || !oldFilename || !moved?.filename) return;

    const visit = (obj) => {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
            obj.forEach(visit);
            return;
        }
        if (obj.filename === oldFilename &&
            (obj.subfolder || "") === oldSubfolder &&
            (obj.type || "temp") === "temp") {
            obj.filename = moved.filename;
            obj.subfolder = moved.subfolder || "";
            obj.type = moved.type || "output";
            if (obj.url && !obj.url.startsWith("blob:")) delete obj.url;
        }
        Object.values(obj).forEach(visit);
    };

    visit(value);
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
                if (val.some(i => i && typeof i === "object" && i.filename === img.filename && (i.subfolder || "") === (img.subfolder || ""))) {
                    return nodeId;
                }
            } else if (val && typeof val === "object" && val.filename === img.filename && (val.subfolder || "") === (img.subfolder || "")) {
                return nodeId;
            }
        }
    }
    return null;
}