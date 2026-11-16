import { api } from "/scripts/api.js";
import { store } from "../core/store.js";
import { PromptStatus, SettingIds } from "../core/constants.js";
import { getSetting } from "../core/settings.js";

/**
 * Cards whose output files no longer exist (for example the TEMP folder was cleared on restart).
 *
 * A failed image request alone is never treated as proof: it can be a race with "Move to Outputs",
 * a restart in progress or a path reused by a newer run. We ask the server whether the files are
 * really gone, and only then act.
 */

const CHUNK = 500;

const fileKey = (f) => `${f.type || "output"}/${f.subfolder || ""}/${f.filename}`;

/** Image/media files of a card that live on the server's disk (not live preview blobs). */
export function cardDiskFiles(state) {
    return (state?.images || []).filter(
        (img) => img && img.filename && !(img.url && img.url.startsWith("blob:"))
    );
}

/**
 * Resolves to a Map(key -> exists) for the given files, or null if the server could not answer
 * (older server, network error). Callers must treat null as "unknown", never as "missing".
 */
export async function checkFilesExist(files) {
    const unique = new Map();
    for (const f of files) unique.set(fileKey(f), { filename: f.filename, subfolder: f.subfolder || "", type: f.type || "output" });
    const entries = [...unique.entries()];
    const result = new Map();

    try {
        for (let i = 0; i < entries.length; i += CHUNK) {
            const chunk = entries.slice(i, i + CHUNK);
            const res = await api.fetchApi("/comfy-sidebar/files-exist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ files: chunk.map(([, f]) => f) })
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (!Array.isArray(data.exists) || data.exists.length !== chunk.length) return null;
            chunk.forEach(([key], idx) => result.set(key, data.exists[idx] !== false));
        }
    } catch (err) {
        console.warn("Comfy Sidebar: could not verify output files", err);
        return null;
    }
    return result;
}

function removeCards(pids) {
    if (pids.length === 0) return;
    for (const pid of pids) store.deletePrompt(pid);
    // Drop them from the server's history too, otherwise they come back on the next reload.
    api.fetchApi("/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete: pids })
    }).catch((err) => console.warn("Comfy Sidebar: failed to delete history entries", err));
}

/**
 * Checks every finished card once (single request) and removes the ones whose files are all gone.
 * Does nothing when the "remove cards with missing files" setting is off. Returns the removed count.
 *
 * Genuine text-only jobs (no files at all) are never touched.
 */
export async function sweepMissingCards() {
    if (!getSetting(SettingIds.REMOVE_MISSING_CARDS, true)) return 0;

    // Only completed jobs are cleaned up; cancelled/failed cards keep their error info.
    const finished = store.getAllPrompts().filter((s) => s.status === PromptStatus.COMPLETED);
    const allFiles = finished.flatMap(cardDiskFiles);
    const exists = allFiles.length > 0 ? await checkFilesExist(allFiles) : new Map();
    if (!exists) return 0; // couldn't verify: keep everything

    const doomed = [];
    for (const s of finished) {
        const files = cardDiskFiles(s);
        if (files.length > 0) {
            if (files.every((f) => exists.get(fileKey(f)) === false)) doomed.push(s.pid);
        } else if (!(s.texts && s.texts.length > 0)) {
            // Finished, no files, no text: an empty "No Outputs" shell left over from a missing-file cleanup.
            doomed.push(s.pid);
        }
    }
    removeCards(doomed);
    return doomed.length;
}

/**
 * Called when the last image of a card failed to load.
 * Resolves to:
 *  - "removed": the file is confirmed gone and the setting asks us to drop the card (already done)
 *  - "missing": the file is confirmed gone but the card is kept (setting off); show it text-only
 *  - "kept":    the file exists, or we couldn't tell: leave the card exactly as it is
 */
export async function handleMissingMedia(state, img) {
    if (!state || !img || !img.filename) return "kept";
    const exists = await checkFilesExist([img]);
    if (!exists || exists.get(fileKey(img)) !== false) return "kept";

    if (state.status === PromptStatus.COMPLETED && getSetting(SettingIds.REMOVE_MISSING_CARDS, true) && store.hasPrompt(state.pid)) {
        removeCards([String(state.pid)]);
        return "removed";
    }
    return "missing";
}
