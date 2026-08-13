import { app } from "/scripts/app.js";

export const isVideoFormat = (url) => {
    if (!url) return false;
    const s = String(url).toLowerCase();
    return s.includes(".mp4") || s.includes(".webm");
};

export const is3DFormat = (url) => {
    if (!url) return false;
    const s = String(url).toLowerCase();
    return s.includes(".glb") || s.includes(".gltf") || s.includes(".obj") || 
           s.includes(".ply") || s.includes(".stl") || s.includes(".splat") || 
           s.includes(".spz") || s.includes(".ksplat") || s.includes(".fbx");
};

export function parseWorkflow(workflow) {
    if (!workflow) return null;
    if (typeof workflow === "object") return workflow;
    if (typeof workflow === "string") {
        try { return JSON.parse(workflow); } catch (e) { return null; }
    }
    return null;
}

function isNodeIgnored(nodeId, rawWorkflow) {
    const workflow = parseWorkflow(rawWorkflow);
    if (!workflow || !Array.isArray(workflow.nodes)) {
        return false;
    }
    const node = workflow.nodes.find(n => String(n.id) === String(nodeId));
    return !!(node && node.properties && node.properties.ignoreInQueue);
}

export function findImagesInOutputs(outputs, rawWorkflow) {
    const list = [];
    if (!outputs) return list;

    const scan = (obj) => {
        if (!obj) return;
        if (Array.isArray(obj)) {
            obj.forEach(item => scan(item));
        } else if (typeof obj === "object") {
            if (obj.filename || obj.name) {
                const fname = obj.filename || obj.name;
                if (typeof fname === "string" && (fname.includes(".") || obj.type)) {
                    list.push({
                        filename: fname,
                        subfolder: obj.subfolder || "",
                        type: obj.type || "output"
                    });
                    return;
                }
            }
            for (const key in obj) {
                scan(obj[key]);
            }
        }
    };

    const workflow = parseWorkflow(rawWorkflow);
    for (const nodeId in outputs) {
        if (isNodeIgnored(nodeId, workflow)) continue;
        scan(outputs[nodeId]);
    }
    return list;
}

export function findTextsInOutputs(outputs, rawWorkflow) {
    const workflow = parseWorkflow(rawWorkflow);
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

export function getRunOutputs(nodeOutputs, rawWorkflow) {
    const workflow = parseWorkflow(rawWorkflow);
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

export function getPrimaryOutputImages(nodeOutputs, rawWorkflow) {
    if (!nodeOutputs) return [];
    const runOutputs = getRunOutputs(nodeOutputs, rawWorkflow);
    if (runOutputs.length === 0) return [];
    return runOutputs[runOutputs.length - 1].images || [];
}

export function matchesFilter(state, query) {
    if (!query) return true;
    const q = query.toLowerCase();

    if (state.pid && String(state.pid).toLowerCase().includes(q)) return true;
    if (state.texts && state.texts.some(t => String(t).toLowerCase().includes(q))) return true;
    if (state.images && state.images.some(img => (img.filename || "").toLowerCase().includes(q))) return true;
    if (state.activeNodeName && state.activeNodeName.toLowerCase().includes(q)) return true;

    const workflow = parseWorkflow(state.workflow);
    if (workflow && Array.isArray(workflow.nodes)) {
        for (const node of workflow.nodes) {
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