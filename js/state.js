export const promptStates = new Map();
export const cardElements = new Map();

export const State = {
    currentSearchQuery: "",
    sequenceNumber: 0,
    sidebarContainer: null,
    cardStack: null,
    submenuStack: null,
    currentlyActivePromptId: null,
    activeSubmenuPromptId: null,
    activeSubmenuBatchImages: null
};

let saveTimer = null;
export function scheduleStateSave(delay = 250) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveStatesToLocalStorage();
    }, delay);
}

export function deletePromptState(pid) {
    const key = String(pid);
    const state = promptStates.get(key);
    if (state) {
        if (state._previewBlobUrl) {
            try { URL.revokeObjectURL(state._previewBlobUrl); } catch (e) {}
        }
        if (state._oldPreviewBlobUrl) {
            try { URL.revokeObjectURL(state._oldPreviewBlobUrl); } catch (e) {}
        }
    }
    promptStates.delete(key);
    cardElements.delete(key);
}

export function pruneHistory(app) {
    const maxItems = app.ui.settings.getSettingValue("Comfy.Queue.MaxHistoryItems") ?? 64;
    const tasks = Array.from(promptStates.entries())
        .filter(([pid, state]) => state.status !== "pending" && state.status !== "active");
    
    tasks.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
    
    if (tasks.length > maxItems) {
        const deleteCount = tasks.length - maxItems;
        for (let i = 0; i < deleteCount; i++) {
            const [pid] = tasks[i];
            deletePromptState(pid);
        }
    }
}

export function saveStatesToLocalStorage() {
    try {
        let serializable = [];
        for (const [pid, state] of promptStates.entries()) {
            const cleanedImages = (state.images || []).map(img => {
                if (img.url && img.url.startsWith("blob:")) return null;
                return img;
            }).filter(Boolean);

            const includeWorkflow = cleanedImages.length === 0 || state.status !== "completed";

            serializable.push({
                pid: String(state.pid), 
                status: state.status, 
                images: cleanedImages, 
                texts: state.texts || [],
                nodeOutputs: state.nodeOutputs,
                workflow: includeWorkflow ? state.workflow : null,
                progress: state.progress || 0, 
                queueNumber: state.queueNumber,
                progressText: state.progressText || "", 
                timestamp: state.timestamp,
                activeNodeName: state.activeNodeName || "", 
                rendered: state.rendered || false,
                startTime: state.startTime, 
                endTime: state.endTime, 
                duration: state.duration
            });
        }

        if (serializable.length === 0) {
            localStorage.removeItem("comfy_sidebar_prompt_states");
            return;
        }

        serializable.sort((a, b) => a.timestamp - b.timestamp);

        while (serializable.length > 0) {
            try {
                localStorage.setItem("comfy_sidebar_prompt_states", JSON.stringify(serializable));
                break;
            } catch (e) {
                if (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014) {
                    serializable.shift();
                } else {
                    break;
                }
            }
        }
    } catch (e) {}
}

export function loadStatesFromLocalStorage() {
    try {
        const data = localStorage.getItem("comfy_sidebar_prompt_states");
        if (data) {
            const list = JSON.parse(data);
            list.forEach(state => {
                const key = String(state.pid);
                promptStates.set(key, state);
                if (state.timestamp > State.sequenceNumber) State.sequenceNumber = state.timestamp;
            });
        }
    } catch (e) {}
}

loadStatesFromLocalStorage();