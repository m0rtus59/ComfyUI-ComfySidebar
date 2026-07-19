import { app } from "/scripts/app.js";

export const isVideoFormat = (url) => {
    const s = url.toLowerCase();
    return s.includes(".mp4") || s.includes(".webm");
};

function isNodeIgnored(nodeId, workflow) {
    if (!workflow || !workflow.nodes) {
        // Fallback to active graph if workflow is missing (e.g. during live execution)
        const liveNode = app.graph?.getNodeById(Number(nodeId));
        if (liveNode) {
            return !!(liveNode.properties && liveNode.properties.ignoreInQueue);
        }
        return false;
    }
    const node = workflow.nodes.find(n => String(n.id) === String(nodeId));
    return !!(node && node.properties && node.properties.ignoreInQueue);
}

// Robust media output scanner supporting both arrays and single objects (gifs, mp4s, etc.)
export function findImagesInOutputs(outputs, workflow) {
    const list = [];
    if (!outputs) return list;
    for (const nodeId in outputs) {
        if (isNodeIgnored(nodeId, workflow)) continue;
        for (const key in outputs[nodeId]) {
            const val = outputs[nodeId][key];
            if (Array.isArray(val)) {
                val.forEach(item => {
                    if (item && typeof item === 'object' && item.filename) list.push(item);
                });
            } else if (val && typeof val === 'object' && val.filename) {
                list.push(val);
            }
        }
    }
    return list;
}

export function findTextsInOutputs(outputs, workflow) {
    const list = [];
    if (!outputs) return list;
    for (const nodeId in outputs) {
        if (isNodeIgnored(nodeId, workflow)) continue;
        for (const key in outputs[nodeId]) {
            const val = outputs[nodeId][key];
            if (Array.isArray(val)) {
                val.forEach(item => {
                    if (typeof item === 'string') {
                        list.push(item);
                    } else if (item && typeof item === 'object' && item.text) {
                        if (Array.isArray(item.text)) list.push(...item.text);
                        else if (typeof item.text === 'string') list.push(item.text);
                    }
                });
            } else if (typeof val === 'string') {
                list.push(val);
            } else if (val && typeof val === 'object' && val.text) {
                if (Array.isArray(val.text)) list.push(...val.text);
                else if (typeof val.text === 'string') list.push(val.text);
            }
        }
    }
    return list;
}

// Organizes raw outputs dictionaries into lists of individual node-level output blocks (ignoring text-only outputs)
export function getRunOutputs(nodeOutputs, workflow) {
    const list = [];
    if (!nodeOutputs) return list;
    for (const nodeId in nodeOutputs) {
        const imgs = findImagesInOutputs({ [nodeId]: nodeOutputs[nodeId] }, workflow);
        if (imgs.length > 0) {
            list.push({ nodeId, images: imgs });
        }
    }
    return list;
}

export function matchesFilter(state, query) {
    if (!query) return true;
    const q = query.toLowerCase();

    if (state.pid && String(state.pid).toLowerCase().includes(q)) return true;
    if (state.texts && state.texts.some(t => String(t).toLowerCase().includes(q))) return true;
    if (state.images && state.images.some(img => (img.filename || "").toLowerCase().includes(q))) return true;
    if (state.activeNodeName && state.activeNodeName.toLowerCase().includes(q)) return true;

    if (state.workflow && Array.isArray(state.workflow.nodes)) {
        for (const node of state.workflow.nodes) {
            if (node.title && node.title.toLowerCase().includes(q)) return true;
            if (node.type && node.type.toLowerCase().includes(q)) return true;
            if (Array.isArray(node.widgets)) {
                for (const w of node.widgets) {
                    if (w && w.value !== undefined && w.value !== null) {
                        if (String(w.value).toLowerCase().includes(q)) return true;
                    }
                }
            }
        }
    }
    return false;
}