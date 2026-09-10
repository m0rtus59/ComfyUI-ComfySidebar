import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { store } from "../core/store.js";
import { PromptStatus, StoreEvents } from "../core/constants.js";
import { createPromptState, activatePrompt, finalizePrompt } from "../core/promptState.js";
import { normalizeQueueItem, normalizeHistoryItem } from "./queueNormalizer.js";
import { findImagesInOutputs, findTextsInOutputs, getPrimaryOutputImages, getNodeTitle } from "../utils/utils.js";

function extractNodeTitles(outputs, workflow, promptGraph = null) {
    const titles = {};
    if (!outputs) return titles;
    for (const nodeId in outputs) {
        const title = getNodeTitle(nodeId, workflow, promptGraph);
        if (title) {
            titles[nodeId] = title;
        }
    }
    return titles;
}

export async function syncQueue() {
    try {
        const q = await api.getQueue();
        const runningList = q.Running || q.queue_running || [];
        const pendingList = q.Pending || q.queue_pending || [];

        const runningIds = new Set();
        const pendingIds = new Set();

        runningList.forEach((raw, idx) => {
            const item = normalizeQueueItem(raw, idx);
            if (!item.pid) return;

            runningIds.add(item.pid);
            store.setActivePromptId(item.pid);

            const existing = store.getPrompt(item.pid);
            const activeWorkflow = item.workflow || (app.graph?.serialize?.() || null);
            const titles = extractNodeTitles(item.outputs, activeWorkflow);

            if (!existing) {
                const seq = store.nextSequence();
                const images = getPrimaryOutputImages(item.outputs, activeWorkflow);
                const texts = findTextsInOutputs(item.outputs, activeWorkflow);

                const newState = createPromptState(item.pid, {
                    status: PromptStatus.ACTIVE,
                    images,
                    texts,
                    nodeOutputs: item.outputs,
                    nodeTitles: titles,
                    progress: 0,
                    progressText: "Processing...",
                    timestamp: seq,
                    workflow: activeWorkflow,
                    startTime: Date.now()
                });
                store.setPrompt(item.pid, newState);
            } else {
                if (existing.status !== PromptStatus.ACTIVE) {
                    activatePrompt(existing, { workflow: activeWorkflow, nodeTitles: titles });
                    store.updatePrompt(item.pid, existing);
                } else {
                    if (!existing.workflow && activeWorkflow) existing.workflow = activeWorkflow;
                    if (Object.keys(titles).length > 0) Object.assign(existing.nodeTitles, titles);
                    store.updatePrompt(item.pid, existing);
                }
            }
        });

        const normalizedPending = pendingList
            .map((raw, idx) => normalizeQueueItem(raw, idx))
            .filter(item => Boolean(item.pid))
            .sort((a, b) => a.seq - b.seq);

        normalizedPending.forEach((item, index) => {
            const number = index + 1;
            pendingIds.add(item.pid);

            const existing = store.getPrompt(item.pid);
            if (!existing) {
                const seq = store.nextSequence();
                const newState = createPromptState(item.pid, {
                    status: PromptStatus.PENDING,
                    images: [],
                    progress: 0,
                    queueNumber: number,
                    progressText: `Pending... (#${number})`,
                    timestamp: seq,
                    workflow: app.graph?.serialize ? app.graph.serialize() : null
                });
                store.setPrompt(item.pid, newState);
            } else if (existing.status === PromptStatus.PENDING) {
                if (existing.queueNumber !== number) {
                    store.updatePrompt(item.pid, {
                        queueNumber: number,
                        progressText: `Pending... (#${number})`
                    });
                }
            }
        });

        for (const prompt of store.getAllPrompts()) {
            if (prompt.status === PromptStatus.PENDING && !pendingIds.has(prompt.pid)) {
                store.deletePrompt(prompt.pid);
            } else if (prompt.status === PromptStatus.ACTIVE && !runningIds.has(prompt.pid)) {
                concludeRun(prompt.pid, PromptStatus.CANCELLED);
            }
        }

        store.emit(StoreEvents.QUEUE_SYNCED, {
            pendingCount: pendingIds.size,
            runningCount: runningIds.size
        });
    } catch (err) {
        console.error("Comfy Sidebar: Failed to sync queue state", err);
    }
}

export async function concludeRun(pid, fallbackStatus = PromptStatus.CANCELLED) {
    const key = String(pid);
    if (!key || !store.hasPrompt(key)) return;

    if (store.ui.currentlyActivePromptId === key) {
        store.setActivePromptId(null);
    }

    const state = store.getPrompt(key);
    finalizePrompt(state, fallbackStatus);

    // If cancelled while actively sampling, preserve the exact step preview where it was cancelled
    const isCancelled = fallbackStatus === PromptStatus.CANCELLED || state.status === PromptStatus.CANCELLED;
    const hasActivePreviewBlob = Boolean(state._previewBlobUrl || state.images?.some(img => img.url?.startsWith("blob:")));

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(`/history/${key}`);
            const hItem = await res.json();
            if (hItem && hItem[key]) {
                const norm = normalizeHistoryItem(key, hItem[key]);

                state.workflow = norm.workflow || state.workflow;
                state.nodeOutputs = norm.outputs || state.nodeOutputs;
                state.status = norm.status;

                const promptGraph = hItem[key].prompt?.[2] || null;
                const titles = extractNodeTitles(state.nodeOutputs, state.workflow, promptGraph);
                Object.assign(state.nodeTitles, titles);

                const primaryImgs = getPrimaryOutputImages(norm.outputs, state.workflow);
                const hasActualSavedOutputs = primaryImgs.some(img => !img.isFallback);

                // If cancelled while sampling, do NOT overwrite with older nodes; keep the exact step preview!
                if (!isCancelled || !hasActivePreviewBlob) {
                    if (hasActualSavedOutputs || (state.status === PromptStatus.COMPLETED && primaryImgs.length > 0)) {
                        state.images = primaryImgs;
                    }
                }

                const fetchedTexts = findTextsInOutputs(norm.outputs, state.workflow);
                if (fetchedTexts.length > 0) state.texts = fetchedTexts;
                break;
            }
        } catch (err) {}
        await new Promise(r => setTimeout(r, 200));
    }

    // Ensure cancelled prompt keeps its preview blob if it had one
    if (isCancelled && hasActivePreviewBlob) {
        if (state._previewBlobUrl && (!state.images || state.images.length === 0 || !state.images[0].url?.startsWith("blob:"))) {
            state.images = [{ url: state._previewBlobUrl }];
        }
    }

    const maxItems = app.ui?.settings?.getSettingValue?.("Comfy.Queue.MaxHistoryItems") ?? 64;
    store.pruneHistory(maxItems);
    store.updatePrompt(key, state);
    syncQueue();
}

export async function initSessionAndHistory() {
    try {
        const historyData = await api.getHistory();
        if (!historyData) return;

        const rawEntries = [];
        if (Array.isArray(historyData.History)) {
            historyData.History.forEach(item => {
                if (item && item.prompt_id) {
                    rawEntries.push({ pid: String(item.prompt_id), data: item });
                }
            });
        } else if (typeof historyData === "object") {
            Object.keys(historyData).forEach(pidKey => {
                rawEntries.push({ pid: String(pidKey), data: historyData[pidKey] });
            });
        }

        const normalized = rawEntries.map(e => ({
            norm: normalizeHistoryItem(e.pid, e.data),
            promptGraph: e.data.prompt?.[2] || null
        }));
        normalized.sort((a, b) => a.norm.queueNumber - b.norm.queueNumber);

        normalized.forEach(({ norm: item, promptGraph }) => {
            const images = getPrimaryOutputImages(item.outputs, item.workflow);
            const texts = findTextsInOutputs(item.outputs, item.workflow);
            const titles = extractNodeTitles(item.outputs, item.workflow, promptGraph);

            if (images.length === 0 && texts.length === 0 && item.status === PromptStatus.COMPLETED) {
                return;
            }

            const existing = store.getPrompt(item.pid);
            if (existing) {
                if (existing.status === PromptStatus.ACTIVE || existing.status === PromptStatus.PENDING) {
                    existing.status = item.status;
                    existing.images = images;
                    existing.texts = texts;
                    existing.nodeOutputs = item.outputs;
                    existing.workflow = item.workflow || existing.workflow;
                    Object.assign(existing.nodeTitles, titles);
                    existing.progressText = "";
                    existing.rendered = false;
                    store.updatePrompt(item.pid, existing);
                } else {
                    if (!existing.workflow && item.workflow) existing.workflow = item.workflow;
                    if ((!existing.images || existing.images.length === 0) && images.length > 0) existing.images = images;
                    if (!existing.nodeOutputs || Object.keys(existing.nodeOutputs).length === 0) {
                        existing.nodeOutputs = item.outputs;
                    }
                    if (!existing.nodeTitles) existing.nodeTitles = {};
                    Object.assign(existing.nodeTitles, titles);
                    if ((!existing.texts || existing.texts.length === 0) && texts && texts.length > 0) existing.texts = texts;
                    store.updatePrompt(item.pid, existing);
                }
                return;
            }

            const seq = store.nextSequence();
            const newState = createPromptState(item.pid, {
                status: item.status,
                images,
                texts,
                nodeOutputs: item.outputs,
                nodeTitles: titles,
                workflow: item.workflow,
                progressText: "",
                timestamp: seq,
                rendered: true
            });
            store.setPrompt(item.pid, newState);
        });

        const maxItems = app.ui?.settings?.getSettingValue?.("Comfy.Queue.MaxHistoryItems") ?? 64;
        store.pruneHistory(maxItems);
        await syncQueue();
    } catch (err) {
        console.error("Comfy Sidebar: Failed to initialize history from server API", err);
    }
}

export async function cancelPendingTask(pid) {
    try {
        await api.fetchApi("/queue", { method: "POST", body: JSON.stringify({ delete: [pid] }) });
        await syncQueue();
    } catch (e) {
        console.error("Comfy Sidebar: Failed to cancel pending task", e);
    }
}

export async function cancelAllPending() {
    try {
        await api.fetchApi("/queue", { method: "POST", body: JSON.stringify({ clear: true }) });
        await syncQueue();
    } catch (e) {
        console.error("Comfy Sidebar: Failed to cancel all pending tasks", e);
    }
}

export async function interruptActive() {
    try {
        await api.interrupt();
        await syncQueue();
    } catch (e) {
        console.error("Comfy Sidebar: Failed to interrupt active run", e);
    }
}

export async function deleteHistoryItem(pid) {
    try {
        store.deletePrompt(pid);
        await api.fetchApi("/history", { method: "POST", body: JSON.stringify({ delete: [pid] }) });
        await syncQueue();
    } catch (e) {
        console.error("Comfy Sidebar: Failed to delete history item", e);
    }
}

export async function clearAllHistory() {
    try {
        store.clearFinished();
        await api.fetchApi("/history", { method: "POST", body: JSON.stringify({ clear: true }) });
        await syncQueue();
    } catch (e) {
        console.error("Comfy Sidebar: Failed to clear all history", e);
    }
}

export async function clearCancelledOrFailed() {
    try {
        const toDelete = store.clearCancelledOrFailed();
        if (toDelete.length > 0) {
            await api.fetchApi("/history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ delete: toDelete })
            });
        }
        await syncQueue();
    } catch (e) {
        console.error("Comfy Sidebar: Failed to clear cancelled or failed tasks", e);
    }
}