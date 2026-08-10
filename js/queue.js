import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { State, promptStates, pruneHistory, cardElements, saveStatesToLocalStorage } from "./state.js";
import { findImagesInOutputs, findTextsInOutputs, parseWorkflow, getPrimaryOutputImages } from "./utils.js";

export let renderDOMFn = () => {};
export let updateSidebarBadgeFn = () => {};
export function setUIDependencies(renderFn, badgeFn) {
    renderDOMFn = renderFn;
    updateSidebarBadgeFn = badgeFn;
}

export async function syncQueue() {
    try {
        const q = await api.getQueue();
        
        const runningList = q.Running || q.queue_running || [];
        const pendingList = q.Pending || q.queue_pending || [];
        const pendingIds = new Set();
        
        const normalizedPending = pendingList.map((p, idx) => {
            let pid = null, seq = idx; 
            if (Array.isArray(p)) {
                seq = typeof p[0] === 'number' ? p[0] : idx;
                pid = p[1];
            } else if (p && typeof p === "object") {
                pid = p.prompt_id || p.id || p.uuid;
                seq = typeof p.number === 'number' ? p.number : (typeof p.prompt_number === 'number' ? p.prompt_number : idx);
            }
            return { pid: pid ? String(pid) : null, seq, original: p };
        });

        normalizedPending.sort((a, b) => a.seq - b.seq);
        normalizedPending.forEach((item, index) => {
            const pid = item.pid;
            const number = index + 1;

            if (pid) {
                pendingIds.add(pid);
                if (!promptStates.has(pid)) {
                    State.globalOrderCounter++;
                    promptStates.set(pid, {
                        pid: pid, status: "pending", images: [], progress: 0, queueNumber: number,
                        progressText: `Pending... (#${number})`, timestamp: State.globalOrderCounter,
                        workflow: app.graph.serialize() 
                    });
                } else {
                    const st = promptStates.get(pid);
                    if (st.status === "pending") {
                        st.queueNumber = number;
                        st.progressText = `Pending... (#${number})`;
                    }
                }
            }
        });

        for (const [pid, state] of promptStates.entries()) {
            if (state.status === "pending" && !pendingIds.has(pid)) promptStates.delete(pid);
        }

        updateSidebarBadgeFn(pendingIds.size + (runningList.length > 0 ? 1 : 0));
        renderDOMFn();
    } catch (err) {
        console.error("Comfy Sidebar: Failed to sync queue state", err);
    }
}

const concludeRun = async (pid, statusStr) => {
    const key = String(pid);
    if (!key || !promptStates.has(key)) return;
    if (State.currentlyActivePromptId === key) State.currentlyActivePromptId = null;
    
    const st = promptStates.get(key);

    if (st._previewBlobUrl) {
        try { URL.revokeObjectURL(st._previewBlobUrl); } catch(e){}
        delete st._previewBlobUrl;
    }
    if (st._oldPreviewBlobUrl) {
        try { URL.revokeObjectURL(st._oldPreviewBlobUrl); } catch(e){}
        delete st._oldPreviewBlobUrl;
    }

    st.status = statusStr;
    st.progressText = "";
    st.rendered = false;
    st.endTime = Date.now();
    if (st.startTime) st.duration = (st.endTime - st.startTime) / 1000;
    
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(`/history/${key}`);
            const hItem = await res.json();
            if (hItem && hItem[key]) {
                const rawWf = hItem[key].extra_data?.extra_pnginfo?.workflow || hItem[key].prompt?.[3]?.extra_pnginfo?.workflow || null;
                st.workflow = parseWorkflow(rawWf) || st.workflow;
                st.nodeOutputs = hItem[key].outputs;
                
                const primaryImgs = getPrimaryOutputImages(hItem[key].outputs, st.workflow);
                if (primaryImgs.length > 0) st.images = primaryImgs;
                
                const fetchedTexts = findTextsInOutputs(hItem[key].outputs, st.workflow);
                if (fetchedTexts.length > 0) st.texts = fetchedTexts;
                break;
            }
        } catch (err) {}
        await new Promise(r => setTimeout(r, 200));
    }
    
    pruneHistory(app);
    saveStatesToLocalStorage();
    syncQueue();
};

export function setupApiListeners() {
    api.addEventListener("status", syncQueue);
    
    api.addEventListener("reconnected", async () => {
        console.log("Comfy Sidebar: Server reconnected, syncing state and history");
        await initSessionAndHistory();
        await syncQueue();
    });
    
    api.addEventListener("execution_start", (e) => {
        if (app.ui.settings.getSettingValue("Comfy Sidebar.Auto Clear Interrupted") ?? false) {
            const toDelete = [];
            for (const [p, s] of promptStates.entries()) {
                if (s.status === "cancelled" || s.status === "error") {
                    toDelete.push(p);
                    promptStates.delete(p);
                }
            }
            if (toDelete.length > 0) {
                api.fetchApi("/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: toDelete }) }).catch(()=>{});
                saveStatesToLocalStorage();
            }
        }

        const pid = String(e.detail.prompt_id);
        State.currentlyActivePromptId = pid; 
        const activeWorkspaceWorkflow = app.graph.serialize();

        if (promptStates.has(pid)) {
            const st = promptStates.get(pid);
            st.status = "active"; st.progressText = "Sampling..."; st.workflow = activeWorkspaceWorkflow;
            st.rendered = false; st.startTime = Date.now(); st.duration = null;
        } else {
            State.globalOrderCounter++;
            promptStates.set(pid, {
                pid: pid, status: "active", images: [], progress: 0,
                progressText: "Sampling...", timestamp: State.globalOrderCounter,
                workflow: activeWorkspaceWorkflow, startTime: Date.now(), duration: null
            });
        }
        renderDOMFn();
        syncQueue();
    });

    api.addEventListener("progress", (e) => {
        const pid = e.detail.prompt_id ? String(e.detail.prompt_id) : null;
        if (pid && promptStates.has(pid)) {
            const st = promptStates.get(pid);
            st.progress = Math.round((e.detail.value / e.detail.max) * 100);
            
            const cardObj = cardElements.get(pid);
            if (cardObj && cardObj.progressBar) {
                cardObj.progressBar.style.width = `${st.progress}%`;
                if (cardObj.statusText && cardObj.statusText.style.display !== "none") {
                    const nodeName = st.activeNodeName ? (st.activeNodeName === "Finishing..." ? "Finishing..." : `[${st.activeNodeName}]`) : "Sampling...";
                    cardObj.statusText.textContent = `${nodeName} ${st.progress}%`;
                }
            } else {
                renderDOMFn();
            }
        }
    });

    api.addEventListener("executing", (e) => {
        const nodeId = e.detail;
        const showWorkingNode = app.ui.settings.getSettingValue("Comfy Sidebar.Show Working Node Name") ?? true;
        
        if (showWorkingNode && State.currentlyActivePromptId && promptStates.has(State.currentlyActivePromptId)) {
            const st = promptStates.get(State.currentlyActivePromptId);
            if (nodeId) {
                const node = app.graph.getNodeById(nodeId);
                st.activeNodeName = node ? (node.title || node.type) : `Node #${nodeId}`;
            } else {
                st.activeNodeName = "Finishing...";
            }
            renderDOMFn();
        }
    });

    api.addEventListener("b_preview", (e) => {
        const activeTasks = Array.from(promptStates.values()).filter(t => t.status === "active");
        if (activeTasks.length > 0) {
            const st = activeTasks[0];
            const newBlobUrl = URL.createObjectURL(e.detail);
            
            st._oldPreviewBlobUrl = st._previewBlobUrl;
            st._previewBlobUrl = newBlobUrl;
            st.images = [{ url: newBlobUrl }];
            renderDOMFn();
        }
    });

    api.addEventListener("executed", (e) => {
        const pid = e.detail.prompt_id ? String(e.detail.prompt_id) : null;
        if (pid && promptStates.has(pid)) {
            const st = promptStates.get(pid);
            const nodeImgs = findImagesInOutputs({ [e.detail.node]: e.detail.output }, st.workflow);
            if (nodeImgs.length > 0) {
                st.images = nodeImgs;
            }
            const nodeTexts = findTextsInOutputs({ [e.detail.node]: e.detail.output }, st.workflow);
            if (nodeTexts.length > 0) {
                st.texts = nodeTexts;
            }

            if (!st.nodeOutputs) st.nodeOutputs = {};
            st.nodeOutputs[e.detail.node] = e.detail.output;

            renderDOMFn();
        }
    });

    api.addEventListener("execution_success", (e) => concludeRun(e.detail.prompt_id, "completed"));
    api.addEventListener("execution_error", (e) => concludeRun(e.detail.prompt_id, "error"));
    api.addEventListener("execution_interrupted", () => {
        Array.from(promptStates.values()).filter(t => t.status === "active").forEach(t => concludeRun(t.pid, "cancelled"));
        syncQueue();
    });
}

export async function initSessionAndHistory() {
    try {
        const historyData = await api.getHistory();
        if (!historyData) return;

        const rawItems = [];
        if (Array.isArray(historyData.History)) {
            historyData.History.forEach(item => {
                if (item && item.prompt_id) rawItems.push({ pid: String(item.prompt_id), data: item });
            });
        } else if (typeof historyData === 'object') {
            Object.keys(historyData).forEach(pidKey => {
                const item = historyData[pidKey];
                rawItems.push({ pid: String(pidKey), data: Array.isArray(item) ? { prompt: item[0], outputs: item[1], status: item[2] } : item });
            });
        }

        rawItems.sort((a, b) => {
            const numA = a.data.prompt?.[0] ?? 0;
            const numB = b.data.prompt?.[0] ?? 0;
            return numA - numB;
        });

        rawItems.forEach(({ pid, data }) => {
            if (promptStates.has(pid)) return;

            const extraData = data.extra_data || data.prompt?.[3] || {};
            const workflow = parseWorkflow(extraData.extra_pnginfo?.workflow || extraData.workflow);
            const outputs = data.outputs || {};
            
            const images = getPrimaryOutputImages(outputs, workflow);
            const texts = findTextsInOutputs(outputs, workflow);
            
            const statusStr = data.status?.status_str || "completed";
            const status = (statusStr === "success" || statusStr === "completed") ? "completed" : 
                           (statusStr === "error" ? "error" : "cancelled");

            // Filter out empty records from history so dummy "No Outputs" cards don't pollute queue
            if (images.length === 0 && texts.length === 0 && status === "completed") return;

            State.globalOrderCounter++;
            promptStates.set(pid, {
                pid: pid, 
                status: status, 
                images: images, 
                texts: texts,
                nodeOutputs: outputs,
                workflow: workflow,
                progressText: "", 
                timestamp: State.globalOrderCounter, 
                rendered: true
            });
        });

        pruneHistory(app);
        saveStatesToLocalStorage();
        await syncQueue();
    } catch (err) {
        console.error("Comfy Sidebar: Failed to initialize history from server API", err);
    }
}