import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { State, promptStates, pruneHistory, loadStatesFromLocalStorage } from "./state.js";
import { findImagesInOutputs, findTextsInOutputs } from "./utils.js";

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
            return { pid, seq, original: p };
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
    if (!pid || !promptStates.has(pid)) return;
    if (State.currentlyActivePromptId === pid) State.currentlyActivePromptId = null;
    
    const st = promptStates.get(pid);
    st.status = statusStr;
    st.progressText = "";
    st.rendered = false;
    st.endTime = Date.now();
    if (st.startTime) st.duration = (st.endTime - st.startTime) / 1000;
    
    try {
        const res = await fetch(`/history/${pid}`);
        const hItem = await res.json();
        if (hItem && hItem[pid]) {
            if (!st.workflow) st.workflow = hItem[pid].extra_data?.extra_pnginfo?.workflow || null;
            st.nodeOutputs = hItem[pid].outputs; // Store full outputs dictionary!
            if (st.images.length === 0) st.images = findImagesInOutputs(hItem[pid].outputs, st.workflow);
            st.texts = findTextsInOutputs(hItem[pid].outputs, st.workflow);
        }
    } catch (err) {}
    pruneHistory(app);
    syncQueue();
};

export function setupApiListeners() {
    api.addEventListener("status", syncQueue);
    
    api.addEventListener("execution_start", (e) => {
        // Auto-sweep cancelled and errored jobs if setting is enabled
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
            }
        }

        const pid = e.detail.prompt_id;
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
        renderDOMFn(); // Render immediately to prevent pop-in delay!
        syncQueue();
    });

    api.addEventListener("progress", (e) => {
        const pid = e.detail.prompt_id;
        if (pid && promptStates.has(pid)) {
            promptStates.get(pid).progress = Math.round((e.detail.value / e.detail.max) * 100);
            renderDOMFn();
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
            if (st._previewBlobUrl) try { URL.revokeObjectURL(st._previewBlobUrl); } catch(e){}
            st._previewBlobUrl = URL.createObjectURL(e.detail);
            st.images = [{ url: st._previewBlobUrl }];
            renderDOMFn();
        }
    });

    api.addEventListener("executed", (e) => {
        if (promptStates.has(e.detail.prompt_id)) {
            const st = promptStates.get(e.detail.prompt_id);
            const finalImgs = findImagesInOutputs({ [e.detail.node]: e.detail.output }, st.workflow);
            if (finalImgs.length > 0) {
                // Overwrite with latest images to avoid accumulation across sequential nodes
                st.images = finalImgs;
            }
            const finalTexts = findTextsInOutputs({ [e.detail.node]: e.detail.output }, st.workflow);
            if (finalTexts.length > 0) {
                // Overwrite with latest texts to avoid clearing previously set text outputs
                st.texts = finalTexts;
            }

            // Dynamically capture each executed node's individual outputs
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
    let backendSessionId = null;
    try {
        const res = await fetch("/classic-sidebar/session");
        const data = await res.json();
        backendSessionId = data.session_id;
    } catch (err) {
        console.warn("Comfy Sidebar: Custom session endpoint not found. Queue persistence will fall back to cache.");
    }

    const storedSessionId = localStorage.getItem("comfy_sidebar_backend_session_id");
    if (backendSessionId && backendSessionId === storedSessionId) {
        loadStatesFromLocalStorage();
    } else {
        localStorage.removeItem("comfy_sidebar_prompt_states");
        if (backendSessionId) localStorage.setItem("comfy_sidebar_backend_session_id", backendSessionId);
    }

    const historyData = await api.getHistory();
    const ids = Object.keys(historyData).sort((a,b) => Number(a)-Number(b));
    ids.forEach(id => {
        if (promptStates.has(id)) return;
        const workflow = historyData[id].extra_data?.extra_pnginfo?.workflow || null;
        const images = findImagesInOutputs(historyData[id].outputs, workflow);
        const texts = findTextsInOutputs(historyData[id].outputs, workflow);
        if (images.length === 0 && texts.length === 0) return;

        State.globalOrderCounter++;
        promptStates.set(id, {
            pid: id, status: "completed", images, texts,
            nodeOutputs: historyData[id].outputs, // Store full outputs dictionary!
            workflow: workflow,
            progressText: "", timestamp: State.globalOrderCounter, rendered: true
        });
    });
    pruneHistory(app);
    await syncQueue();
}