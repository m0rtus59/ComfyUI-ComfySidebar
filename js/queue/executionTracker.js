import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { store } from "../core/store.js";
import { PromptStatus } from "../core/constants.js";
import { createPromptState, activatePrompt, updatePromptProgress } from "../core/promptState.js";
import { syncQueue, concludeRun, initSessionAndHistory, clearCancelledOrFailed } from "./queueService.js";
import { findImagesInOutputs, findTextsInOutputs } from "../utils/utils.js";
import { updateActiveComparisonPreview } from "../utils/comparison.js";

export function setupExecutionTracker(onTargetedProgressUpdate) {
    const onStatus = () => syncQueue();

    const onReconnected = async () => {
        console.log("Comfy Sidebar: Server reconnected, syncing state and history");
        await initSessionAndHistory();
        await syncQueue();
    };

    const onExecutionStart = (e) => {
        const autoClear = app.ui?.settings?.getSettingValue?.("Comfy Sidebar.Auto Clear Interrupted") ?? false;
        if (autoClear) {
            clearCancelledOrFailed();
        }

        const pid = String(e.detail.prompt_id);
        store.setActivePromptId(pid);

        const activeWorkspaceWorkflow = app.graph?.serialize ? app.graph.serialize() : null;
        const existing = store.getPrompt(pid);

        if (existing) {
            activatePrompt(existing, { workflow: activeWorkspaceWorkflow });
            store.updatePrompt(pid, existing);
        } else {
            const seq = store.nextSequence();
            const newState = createPromptState(pid, {
                status: PromptStatus.ACTIVE,
                images: [],
                progress: 0,
                progressText: "Processing...",
                timestamp: seq,
                workflow: activeWorkspaceWorkflow,
                startTime: Date.now()
            });
            store.setPrompt(pid, newState);
        }

        syncQueue();
    };

    const onProgress = (e) => {
        const pid = e.detail.prompt_id ? String(e.detail.prompt_id) : null;
        if (pid && store.hasPrompt(pid)) {
            const prompt = store.getPrompt(pid);
            const percent = Math.round((e.detail.value / e.detail.max) * 100);
            updatePromptProgress(prompt, percent);
            store.updatePrompt(pid, prompt);

            if (typeof onTargetedProgressUpdate === "function") {
                onTargetedProgressUpdate(pid, percent, prompt.activeNodeName);
            }
        } else if (pid && !store.hasPrompt(pid)) {
            syncQueue();
        }
    };

    const onExecuting = (e) => {
        const nodeId = e.detail;
        const showWorkingNode = app.ui?.settings?.getSettingValue?.("Comfy Sidebar.Show Working Node Name") ?? true;
        const activePid = store.ui.currentlyActivePromptId;

        if (activePid && store.hasPrompt(activePid)) {
            const prompt = store.getPrompt(activePid);
            if (nodeId) {
                prompt.activeNodeId = String(nodeId);
                const node = app.graph?.getNodeById ? app.graph.getNodeById(nodeId) : null;
                prompt.activeNodeName = node ? (node.title || node.type) : `Node #${nodeId}`;
            } else {
                prompt.activeNodeName = "Finishing...";
            }
            store.updatePrompt(activePid, prompt);

            if (showWorkingNode && typeof onTargetedProgressUpdate === "function") {
                onTargetedProgressUpdate(activePid, prompt.progress, prompt.activeNodeName);
            }
        }
    };

    const onBPreview = (e) => {
        const activeTasks = store.getAllPrompts().filter(t => t.status === PromptStatus.ACTIVE);
        if (activeTasks.length > 0) {
            const prompt = activeTasks[0];
            const newBlobUrl = URL.createObjectURL(e.detail);

            prompt._oldPreviewBlobUrl = prompt._previewBlobUrl;
            prompt._previewBlobUrl = newBlobUrl;
            prompt.images = [{ url: newBlobUrl }];
            store.updatePrompt(prompt.pid, prompt);

            // Update live fullscreen preview if currently open
            updateActiveComparisonPreview(prompt.pid, newBlobUrl);

            // Update the active card in the sidebar
            if (typeof onTargetedProgressUpdate === "function") {
                onTargetedProgressUpdate(prompt.pid, prompt.progress, prompt.activeNodeName);
            }
        }
    };

    const onExecuted = (e) => {
        const pid = e.detail.prompt_id ? String(e.detail.prompt_id) : null;
        if (pid && store.hasPrompt(pid)) {
            const prompt = store.getPrompt(pid);
            const nodeImgs = findImagesInOutputs({ [e.detail.node]: e.detail.output }, prompt.workflow);
            // Only update prompt.images if this node actually produced real output images
            const hasRealNewImgs = nodeImgs.some(img => !img.isFallback);
            if (hasRealNewImgs) {
                prompt.images = nodeImgs;
                // If fullscreen is open, smoothly transition to the final saved image
                const finalImg = nodeImgs[0];
                const finalSrc = finalImg.url || (window.location.origin + `/view?filename=${encodeURIComponent(finalImg.filename)}&type=${finalImg.type || 'output'}&subfolder=${encodeURIComponent(finalImg.subfolder || '')}&rand=${encodeURIComponent(pid)}`);
                updateActiveComparisonPreview(pid, finalSrc);
            }
            const nodeTexts = findTextsInOutputs({ [e.detail.node]: e.detail.output }, prompt.workflow);
            if (nodeTexts.length > 0) {
                prompt.texts = nodeTexts;
            }

            if (!prompt.nodeOutputs) prompt.nodeOutputs = {};
            prompt.nodeOutputs[e.detail.node] = e.detail.output;

            store.updatePrompt(pid, prompt);
        }
    };

    const onExecutionSuccess = (e) => concludeRun(e.detail.prompt_id, PromptStatus.COMPLETED);
    const onExecutionError = (e) => {
        const pid = e.detail?.prompt_id;
        const nodeId = e.detail?.node_id;
        if (pid && nodeId && store.hasPrompt(String(pid))) {
            const prompt = store.getPrompt(String(pid));
            prompt.activeNodeId = String(nodeId);
            store.updatePrompt(String(pid), prompt);
        }
        concludeRun(e.detail.prompt_id, PromptStatus.ERROR);
    };
    const onExecutionInterrupted = () => {
        store.getAllPrompts()
            .filter(t => t.status === PromptStatus.ACTIVE)
            .forEach(t => concludeRun(t.pid, PromptStatus.CANCELLED));
        syncQueue();
    };

    api.addEventListener("status", onStatus);
    api.addEventListener("reconnected", onReconnected);
    api.addEventListener("execution_start", onExecutionStart);
    api.addEventListener("progress", onProgress);
    api.addEventListener("executing", onExecuting);
    api.addEventListener("b_preview", onBPreview);
    api.addEventListener("executed", onExecuted);
    api.addEventListener("execution_success", onExecutionSuccess);
    api.addEventListener("execution_error", onExecutionError);
    api.addEventListener("execution_interrupted", onExecutionInterrupted);

    return () => {
        api.removeEventListener("status", onStatus);
        api.removeEventListener("reconnected", onReconnected);
        api.removeEventListener("execution_start", onExecutionStart);
        api.removeEventListener("progress", onProgress);
        api.removeEventListener("executing", onExecuting);
        api.removeEventListener("b_preview", onBPreview);
        api.removeEventListener("executed", onExecuted);
        api.removeEventListener("execution_success", onExecutionSuccess);
        api.removeEventListener("execution_error", onExecutionError);
        api.removeEventListener("execution_interrupted", onExecutionInterrupted);
    };
}
