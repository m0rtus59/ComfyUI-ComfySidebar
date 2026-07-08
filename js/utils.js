export const isVideoFormat = (url) => {
    const s = url.toLowerCase();
    return s.includes(".mp4") || s.includes(".webm");
};

export function findImagesInOutputs(outputs) {
    const list = [];
    if (!outputs) return list;
    for (const nodeId in outputs) {
        for (const key in outputs[nodeId]) {
            const val = outputs[nodeId][key];
            if (Array.isArray(val)) {
                val.forEach(item => {
                    if (item && typeof item === 'object' && item.filename) list.push(item);
                });
            }
        }
    }
    return list;
}

export function findTextsInOutputs(outputs) {
    const list = [];
    if (!outputs) return list;
    for (const nodeId in outputs) {
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