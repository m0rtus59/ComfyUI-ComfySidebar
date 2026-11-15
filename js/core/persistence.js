import { PromptStatus } from "./constants.js";

const STORAGE_KEY = "comfy_sidebar_prompt_states";

export const PersistenceAdapter = {
    load() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (!data) return [];
            const list = JSON.parse(data);
            return Array.isArray(list) ? list : [];
        } catch (e) {
            console.warn("Comfy Sidebar: Failed to load states from localStorage", e);
            return [];
        }
    },

    save(promptsMap) {
        try {
            const serializable = [];

            for (const [pid, state] of promptsMap.entries()) {
                const cleanedImages = (state.images || []).map(img => {
                    if (img && img.url && img.url.startsWith("blob:")) return null;
                    return img;
                }).filter(Boolean);

                // The workflow is only dropped from storage when it can be read back from a saved PNG.
                // Text-only jobs, temp previews (the TEMP folder gets cleared), videos/webp and unfinished
                // jobs have no such copy, and ComfyUI's own history is gone after a server restart.
                const recoverableFromFile = cleanedImages.some(img =>
                    img.type === "output" && /\.png$/i.test(img.filename || ""));
                const includeWorkflow = !recoverableFromFile || state.status !== PromptStatus.COMPLETED;

                serializable.push({
                    pid: String(state.pid),
                    status: state.status,
                    images: cleanedImages,
                    texts: state.texts || [],
                    promptSearchText: state.promptSearchText,
                    nodeOutputs: state.nodeOutputs || {},
                    nodeTitles: state.nodeTitles || {}, // Always preserved across restarts
                    workflow: includeWorkflow ? state.workflow : null,
                    progress: state.progress || 0,
                    queueNumber: state.queueNumber,
                    progressText: state.progressText || "",
                    timestamp: state.timestamp,
                    activeNodeName: state.activeNodeName || "",
                    rendered: !!state.rendered,
                    startTime: state.startTime,
                    endTime: state.endTime,
                    duration: state.duration
                });
            }

            if (serializable.length === 0) {
                localStorage.removeItem(STORAGE_KEY);
                return;
            }

            serializable.sort((a, b) => a.timestamp - b.timestamp);

            while (serializable.length > 0) {
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
                    break;
                } catch (e) {
                    if (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014) {
                        // Storage is full. First shed workflows, oldest card first, and only drop
                        // whole cards once there is no workflow left to shed.
                        const withWorkflow = serializable.find(item => item.workflow);
                        if (withWorkflow) withWorkflow.workflow = null;
                        else serializable.shift();
                    } else {
                        console.warn("Comfy Sidebar: LocalStorage error", e);
                        break;
                    }
                }
            }
        } catch (e) {
            console.warn("Comfy Sidebar: Failed to serialize states", e);
        }
    },

    getPruneCandidates(promptsMap, maxItems = 64) {
        const finished = Array.from(promptsMap.entries())
            .filter(([_, state]) => state.status !== PromptStatus.PENDING && state.status !== PromptStatus.ACTIVE);

        finished.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));

        if (finished.length > maxItems) {
            const deleteCount = finished.length - maxItems;
            return finished.slice(0, deleteCount).map(([pid]) => pid);
        }
        return [];
    }
};