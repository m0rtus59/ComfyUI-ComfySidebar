export const promptStates = new Map();
export const cardElements = new Map();

export const State = {
    currentSearchQuery: "",
    globalOrderCounter: 0,
    sidebarContainer: null,
    cardStack: null,                  // Main queue scroll container
    submenuStack: null,               // Submenu scroll container
    currentlyActivePromptId: null,
    activeSubmenuPromptId: null,      // Active run/outputs explorer pointer
    activeSubmenuBatchImages: null    // Active batch images explorer pointer
};

/**
 * Safely removes a prompt state from memory and revokes any active preview blob URLs.
 */
export function deletePromptState(pid) {
    const state = promptStates.get(pid);
    if (state && state._previewBlobUrl) {
        try {
            URL.revokeObjectURL(state._previewBlobUrl);
        } catch (e) {}
    }
    promptStates.delete(pid);
    cardElements.delete(pid);
}

/**
 * Prunes completed/cancelled history when total items exceed user setting.
 */
export function pruneHistory(app) {
    const maxItems = app.ui.settings.getSettingValue("Comfy.Queue.MaxHistoryItems") ?? 64;
    const tasks = Array.from(promptStates.entries())
        .filter(([pid, state]) => state.status !== "pending" && state.status !== "active");
    
    tasks.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    if (tasks.length > maxItems) {
        const deleteCount = tasks.length - maxItems;
        for (let i = 0; i < deleteCount; i++) {
            const [pid] = tasks[i];
            deletePromptState(pid);
        }
    }
}

/**
 * Saves all prompt states (including workflows, text outputs, video runs, and failed tasks) to localStorage.
 * Uses FIFO eviction if browser storage quota (5MB) is reached.
 */
export function saveStatesToLocalStorage() {
    try {
        let serializable = [];
        for (const [pid, state] of promptStates.entries()) {
            const cleanedImages = (state.images || []).map(img => {
                if (img.url && img.url.startsWith("blob:")) return null;
                return img;
            }).filter(Boolean);

            serializable.push({
                pid: state.pid, 
                status: state.status, 
                images: cleanedImages, 
                texts: state.texts || [],
                nodeOutputs: state.nodeOutputs,
                workflow: state.workflow,
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

        serializable.sort((a, b) => a.timestamp - b.timestamp);

        while (serializable.length > 0) {
            try {
                localStorage.setItem("comfy_sidebar_prompt_states", JSON.stringify(serializable));
                break;
            } catch (e) {
                if (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014) {
                    serializable.shift();
                } else {
                    console.error("Comfy Sidebar: Failed to save state to localStorage", e);
                    break;
                }
            }
        }
    } catch (e) {
        console.error("Comfy Sidebar: Error preparing localStorage data", e);
    }
}

/**
 * Loads cached card states on extension initialization.
 */
export function loadStatesFromLocalStorage() {
    try {
        const data = localStorage.getItem("comfy_sidebar_prompt_states");
        if (data) {
            const list = JSON.parse(data);
            list.forEach(state => {
                promptStates.set(state.pid, state);
                if (state.timestamp > State.globalOrderCounter) State.globalOrderCounter = state.timestamp;
            });
        }
    } catch (e) {
        console.error("Comfy Sidebar: Failed to load state from localStorage", e);
    }
}

loadStatesFromLocalStorage();