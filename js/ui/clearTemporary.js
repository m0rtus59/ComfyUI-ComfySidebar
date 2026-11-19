import { store } from "../core/store.js";
import { PromptStatus } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { removeHistoryItems } from "../queue/queueService.js";
import { createDeleteTally, deleteFilesIntoTally, notifyDeleteTally, deleteTempEntryOnServer } from "./mediaActions.js";
import { showNotification } from "../utils/nodeRenumber.js";

/**
 * Number of cards "Clear Temporary" would remove right now.
 */
export function countTemporaryCards() {
    return store.getTemporaryPrompts().length;
}

/**
 * Removes every finished card that holds nothing saved (text-only cards and cards whose files
 * all live in the TEMP folder) together with those temp files.
 *
 * Files go to the Recycle Bin or are deleted permanently, depending on the same setting as the
 * per-card delete. If a file can't be deleted (for example the user cancelled the Recycle Bin
 * dialog) its card is kept, so a card never disappears while its files are still on disk.
 */
export async function clearTemporaryCards() {
    const candidates = store.getTemporaryPrompts();
    if (candidates.length === 0) return 0;

    const tally = createDeleteTally();
    const removable = [];
    for (const { pid, files } of candidates) {
        // The card may have been queued again or changed while earlier files were being deleted.
        const live = store.getPrompt(pid);
        if (!live || live.status === PromptStatus.PENDING || live.status === PromptStatus.ACTIVE) continue;

        if (await deleteFilesIntoTally(files, tally)) removable.push(pid);
    }

    await removeHistoryItems(removable);

    const title = t("Clear Temporary");
    if (removable.length > 0) {
        showNotification(t("Cleared {count} temporary card(s).", { count: removable.length }), "success", title);
    }
    notifyDeleteTally(tally, title, "Could not delete {count} file(s). Their cards were kept.");
    return removable.length;
}


/**
 * Clears the contents of ComfyUI's TEMP directory. Top-level directories are moved as single
 * entries, preserving their structure in the system trash. The TEMP root itself is retained.
 *
 * The server refuses both the initial listing and each deletion while a workflow is running or
 * pending, so a queue change during a large cleanup stops the remaining work.
 */
export async function clearTemporaryDirectory() {
    const title = t("Clear All History");
    let response;
    let data = {};
    try {
        response = await fetch("/comfy-sidebar/temp-items");
        data = await response.json().catch(() => ({}));
    } catch (err) {
        console.error("Comfy Sidebar: Failed to inspect TEMP directory", err);
        showNotification(t("Could not inspect the TEMP directory."), "error", title);
        return { ok: false, count: 0 };
    }

    if (!response.ok) {
        if (data.code === "queue_busy") {
            showNotification(t("Finish or cancel queued workflows before clearing history and TEMP."), "warn", title);
        } else {
            showNotification(t("Could not inspect the TEMP directory."), "error", title);
            console.error("Comfy Sidebar: Failed to inspect TEMP directory", data.error || response.statusText);
        }
        return { ok: false, count: 0, busy: data.code === "queue_busy" };
    }

    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (entries.length === 0) return { ok: true, count: 0 };

    const tally = createDeleteTally();
    let queueBecameBusy = false;

    for (let i = 0; i < entries.length; i++) {
        const action = await deleteTempEntryOnServer(entries[i], { suppressDialog: tally.cancelled });
        if (action === "trashed" || action === "deleted") {
            tally.deleted++;
            tally.lastAction = action;
        } else if (action === "missing") {
            continue;
        } else if (action === "busy") {
            tally.blocked += entries.length - i;
            queueBecameBusy = true;
            break;
        } else {
            tally.blocked++;
            tally.cancelled = true;
        }
    }

    if (tally.deleted > 0) {
        const message = tally.lastAction === "trashed"
            ? t("Moved {count} TEMP item(s) to Recycle Bin.", { count: tally.deleted })
            : t("Permanently deleted {count} TEMP item(s).", { count: tally.deleted });
        showNotification(message, "success", title);
    }
    if (tally.blocked > 0) {
        const message = queueBecameBusy
            ? t("TEMP cleanup stopped because a workflow entered the queue.")
            : t("Could not delete {count} TEMP item(s).", { count: tally.blocked });
        showNotification(message, "warn", title);
    }

    return { ok: tally.blocked === 0, count: tally.deleted, blocked: tally.blocked, busy: queueBecameBusy };
}
