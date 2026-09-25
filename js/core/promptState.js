import { PromptStatus } from "./constants.js";

export function createPromptState(pid, initial = {}) {
    return {
        pid: String(pid),
        status: initial.status || PromptStatus.PENDING,
        images: Array.isArray(initial.images) ? [...initial.images] : [],
        texts: Array.isArray(initial.texts) ? [...initial.texts] : [],
        nodeOutputs: initial.nodeOutputs ? { ...initial.nodeOutputs } : {},
        nodeTitles: initial.nodeTitles ? { ...initial.nodeTitles } : {},
        progress: typeof initial.progress === "number" ? initial.progress : 0,
        progressText: initial.progressText || "",
        queueNumber: initial.queueNumber || null,
        timestamp: typeof initial.timestamp === "number" ? initial.timestamp : Date.now(),
        workflow: initial.workflow || null,
        activeNodeName: initial.activeNodeName || "",
        startTime: initial.startTime || null,
        endTime: initial.endTime || null,
        duration: typeof initial.duration === "number" ? initial.duration : null,
        rendered: !!initial.rendered,
        _previewBlobUrl: initial._previewBlobUrl || null,
        _oldPreviewBlobUrl: initial._oldPreviewBlobUrl || null
    };
}

export function revokePromptBlobs(state) {
    if (!state) return;
    if (state._previewBlobUrl) {
        try { URL.revokeObjectURL(state._previewBlobUrl); } catch (e) {}
        state._previewBlobUrl = null;
    }
    if (state._oldPreviewBlobUrl) {
        try { URL.revokeObjectURL(state._oldPreviewBlobUrl); } catch (e) {}
        state._oldPreviewBlobUrl = null;
    }
}

export function activatePrompt(state, patch = {}) {
    state.status = PromptStatus.ACTIVE;
    state.progress = 0;
    state.progressText = "Processing...";
    state.rendered = false;
    state.startTime = state.startTime || Date.now();
    state.duration = null;
    state._hasValidatedIntermediates = true; // New live prompt; files are fresh
    if (patch.workflow) state.workflow = patch.workflow;
    if (patch.activeNodeName !== undefined) state.activeNodeName = patch.activeNodeName;
    if (patch.nodeTitles) Object.assign(state.nodeTitles, patch.nodeTitles);
    if (typeof patch.timestamp === "number") state.timestamp = patch.timestamp;
    return state;
}

export function updatePromptProgress(state, progress, activeNodeName = null) {
    state.progress = Math.max(0, Math.min(100, Math.round(progress)));
    if (activeNodeName !== null) {
        state.activeNodeName = activeNodeName;
    }
    return state;
}

export function finalizePrompt(state, targetStatus, patch = {}) {
    // Only revoke blobs if not cancelled; preserve the preview so the user can inspect the cancelled step
    if (targetStatus !== PromptStatus.CANCELLED && state.status !== PromptStatus.CANCELLED) {
        revokePromptBlobs(state);
    }
    state.status = targetStatus;
    state.progressText = "";
    state.rendered = false;
    state._hasValidatedIntermediates = true; // Live session generation; files are fresh
    state.endTime = patch.endTime || Date.now();
    if (state.startTime) {
        state.duration = (state.endTime - state.startTime) / 1000;
    }
    if (patch.workflow) state.workflow = patch.workflow;
    if (patch.nodeOutputs) state.nodeOutputs = patch.nodeOutputs;
    if (patch.nodeTitles) Object.assign(state.nodeTitles, patch.nodeTitles);
    if (patch.images && patch.images.length > 0) state.images = patch.images;
    if (patch.texts && patch.texts.length > 0) state.texts = patch.texts;
    return state;
}