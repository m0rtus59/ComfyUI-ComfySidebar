import { store } from "../core/store.js";
import { PromptStatus } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { removeHistoryItems } from "../queue/queueService.js";
import { createDeleteTally, deleteFilesIntoTally, notifyDeleteTally } from "./mediaActions.js";
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
