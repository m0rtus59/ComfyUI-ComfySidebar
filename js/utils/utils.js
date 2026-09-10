import { app } from "/scripts/app.js";

const FILE_EXT_REGEX = /\.(safetensors|ckpt|pt|pth|bin|latent|onnx|engine|gguf|lora|zip|tar|gz|7z|json|csv|parquet|txt|yaml|yml|xml|pdf|blend|fbx|obj|glb|gltf|stl|ply|splat|spz|ksplat|png|jpg|jpeg|webp|gif|bmp|tiff|svg|mp4|webm|wav|mp3|ogg|flac|m4a|aac|opus)$/i;

export function getFilenameFromUrl(url) {
    if (!url) return "";
    if (typeof url === "object") {
        url = url.filename || url.url || "";
    }
    const str = String(url);
    try {
        const origin = window.location?.origin && window.location.origin !== "null" ? window.location.origin : "http://localhost";
        const u = new URL(str, origin);
        if (u.searchParams && u.searchParams.get("filename")) {
            return u.searchParams.get("filename");
        }
        const pathname = u.pathname || "";
        return pathname.split("/").pop() || "";
    } catch (e) {
        const m = str.match(/[?&]filename=([^&#]+)/);
        if (m) {
            try { return decodeURIComponent(m[1]); } catch (err) { return m[1]; }
        }
        return str.split("?")[0].split("#")[0].split("/").pop() || "";
    }
}

const checkExt = (url, extensions) => {
    if (!url) return false;
    const name = getFilenameFromUrl(url).toLowerCase();
    const s = String(url).toLowerCase().split("?")[0].split("#")[0];
    return extensions.some(ext => name.endsWith(ext) || s.endsWith(ext));
};

export const isImageFormat = (url) => {
    if (!url) return false;
    if (String(url).startsWith("blob:") || String(url).startsWith("data:image/")) return true;
    return checkExt(url, [
        ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
        ".tiff", ".tif", ".svg", ".avif", ".ico", ".apng"
    ]);
};

export const isVideoFormat = (url) => {
    return checkExt(url, [".mp4", ".webm", ".mov", ".mkv"]);
};

export const is3DFormat = (url) => {
    return checkExt(url, [
        ".glb", ".gltf", ".obj", ".ply", ".stl",
        ".splat", ".spz", ".ksplat", ".fbx"
    ]);
};

export const isAudioFormat = (url) => {
    return checkExt(url, [
        ".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac", ".opus"
    ]);
};

export function parseWorkflow(workflow) {
    if (!workflow) return null;
    if (typeof workflow === "object") return workflow;
    if (typeof workflow === "string") {
        try { return JSON.parse(workflow); } catch (e) { return null; }
    }
    return null;
}

export function isNodeIgnored(nodeId, rawWorkflow) {
    const workflow = parseWorkflow(rawWorkflow);
    if (workflow && Array.isArray(workflow.nodes)) {
        const node = workflow.nodes.find(n => String(n.id) === String(nodeId));
        if (node?.properties?.ignoreInQueue !== undefined) {
            return !!node.properties.ignoreInQueue;
        }
    }

    if (!workflow && app.graph) {
        const canvasNode = app.graph.getNodeById ? (app.graph.getNodeById(Number(nodeId)) || app.graph.getNodeById(String(nodeId))) : null;
        if (canvasNode?.properties?.ignoreInQueue !== undefined) {
            return !!canvasNode.properties.ignoreInQueue;
        }
    }
    return false;
}

export function getNodeTitle(nodeId, rawWorkflow, promptGraph = null) {
    const idStr = String(nodeId);

    const workflow = parseWorkflow(rawWorkflow);
    if (workflow && Array.isArray(workflow.nodes)) {
        const node = workflow.nodes.find(n => String(n.id) === idStr);
        if (node) {
            return node.title || node.type || null;
        }
    }

    if (promptGraph && promptGraph[idStr]) {
        const pNode = promptGraph[idStr];
        if (pNode._meta?.title) return pNode._meta.title;
        if (pNode.class_type) return pNode.class_type;
    }

    if (app.graph) {
        const canvasNode = app.graph.getNodeById ? (app.graph.getNodeById(Number(nodeId)) || app.graph.getNodeById(idStr)) : null;
        if (canvasNode) {
            return canvasNode.title || canvasNode.type || null;
        }
    }

    return null;
}

function cleanSubfolder(subfolder) {
    if (!subfolder) return "";
    let s = String(subfolder).replace(/\\/g, "/").trim();
    s = s.replace(/^\/+|\/+$/g, ""); // Strip leading/trailing slashes
    if (s.toLowerCase() === "output") return "";
    if (s.toLowerCase().startsWith("output/")) {
        s = s.substring(7);
    }
    return s;
}

function extractFileCandidate(val, subfolder = "", type = "output", nodeType = "") {
    if (!val || typeof val !== "string") return null;
    let trimmed = val.replace(/\\/g, "/").trim();

    if (trimmed === "." || trimmed === ".." || trimmed === "./" || trimmed === "../" || trimmed === "") {
        return null;
    }
    if (!isNaN(Number(trimmed))) {
        return null;
    }

    // Extract any path ending with a known media or model extension from text messages
    const fileMatch = trimmed.match(/([a-zA-Z0-9_\-\.\/]+\.(?:safetensors|ckpt|pt|bin|latent|png|jpg|jpeg|webp|mp4|webm|wav|mp3|glb|gltf))/i);
    if (fileMatch) {
        trimmed = fileMatch[1];
    }

    // Auto-append .safetensors if this is a LoRA node/subfolder without an extension
    if (!trimmed.includes(".")) {
        const typeLower = (nodeType || "").toLowerCase();
        const subLower = (subfolder || "").toLowerCase();
        const isLora = typeLower.includes("lora") || subLower.includes("lora") || trimmed.includes("lora");
        const isLatent = typeLower.includes("latent");

        if (isLora) {
            trimmed += ".safetensors";
        } else if (isLatent) {
            trimmed += ".latent";
        } else {
            return null;
        }
    }

    const cleanName = trimmed.split("/").pop()?.trim() || "";
    if (!cleanName || cleanName === "." || cleanName === "..") return null;

    const dotIndex = cleanName.lastIndexOf(".");
    if (dotIndex <= 0 || dotIndex === cleanName.length - 1) {
        return null;
    }

    const ext = cleanName.substring(dotIndex + 1).toLowerCase();
    const base = cleanName.substring(0, dotIndex).trim();
    if (!base || !ext) return null;

    const isValidExt = FILE_EXT_REGEX.test("." + ext) || (/^[a-z0-9]{1,8}$/i.test(ext) && !trimmed.includes(" ") && trimmed.length < 100);
    if (!isValidExt) return null;

    let detectedSub = subfolder;
    if (trimmed.includes("/")) {
        detectedSub = trimmed.substring(0, trimmed.lastIndexOf("/"));
    }
    detectedSub = cleanSubfolder(detectedSub);

    return {
        filename: cleanName,
        subfolder: detectedSub,
        type: type || "output"
    };
}

export function findImagesInOutputs(outputs, rawWorkflow) {
    const list = [];
    const seen = new Set();
    const workflow = parseWorkflow(rawWorkflow);

    const addCandidate = (item) => {
        if (!item || !item.filename) return;
        const key = `${item.type || "output"}/${item.subfolder || ""}/${item.filename}`;
        if (!seen.has(key)) {
            seen.add(key);
            list.push(item);
        }
    };

    const scan = (obj, sub = "", typ = "output", nodeType = "") => {
        if (!obj) return;
        if (typeof obj === "string") {
            const cand = extractFileCandidate(obj, sub, typ, nodeType);
            if (cand) addCandidate(cand);
            return;
        }
        if (Array.isArray(obj)) {
            obj.forEach(item => scan(item, sub, typ, nodeType));
            return;
        }
        if (typeof obj === "object") {
            const targetSub = obj.subfolder !== undefined ? obj.subfolder : sub;
            const targetTyp = obj.type || typ || "output";

            const fname = obj.filename || obj.name || obj.file || obj.path || 
                          obj.lora_name || obj.model_name || obj.save_name || 
                          obj.saved_file || obj.output_path || obj.file_name ||
                          obj.output || obj.saved;

            if (fname && typeof fname === "string") {
                const cand = extractFileCandidate(fname, targetSub, targetTyp, nodeType);
                if (cand) {
                    addCandidate(cand);
                    return;
                }
            }

            for (const key in obj) {
                scan(obj[key], targetSub, targetTyp, nodeType || key);
            }
        }
    };

    if (outputs) {
        for (const nodeId in outputs) {
            if (isNodeIgnored(nodeId, workflow)) continue;
            const node = workflow?.nodes?.find(n => String(n.id) === String(nodeId));
            const nodeType = node ? (node.type || "") : "";
            scan(outputs[nodeId], "", "output", nodeType);
        }
    }

    if (list.length > 0) return list;

    // Fallback: Check workflow nodes for Save / Extract / Export nodes
    if (workflow && Array.isArray(workflow.nodes)) {
        const targetNodeIds = outputs ? Object.keys(outputs).map(String) : null;

        for (const node of workflow.nodes) {
            if (node && !node.properties?.ignoreInQueue) {
                if (targetNodeIds && targetNodeIds.length > 0 && !targetNodeIds.includes(String(node.id))) {
                    continue;
                }

                const typeStr = (node.type || "").toLowerCase();
                const isLoaderNode = typeStr.includes("load") || typeStr.includes("loader") || typeStr.includes("input");
                const isSaveNode = !isLoaderNode && (
                    typeStr.includes("save") || 
                    typeStr.includes("extract") || 
                    typeStr.includes("export") || 
                    typeStr.includes("writer")
                );

                if (isSaveNode && Array.isArray(node.widgets_values)) {
                    for (const val of node.widgets_values) {
                        if (typeof val === "string" && val.trim().length > 0) {
                            let defaultSub = "";
                            if (typeStr.includes("lora")) defaultSub = "loras";
                            const cand = extractFileCandidate(val, defaultSub, "output", typeStr);
                            if (cand) {
                                cand.isFallback = true;
                                addCandidate(cand);
                            }
                        }
                    }
                }
            }
        }
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
                    if (typeof item === 'string' && !FILE_EXT_REGEX.test(item.trim())) {
                        list.push(item);
                    } else if (item && typeof item === 'object' && item.text) {
                        if (Array.isArray(item.text)) list.push(...item.text);
                        else if (typeof item.text === 'string') list.push(item.text);
                    }
                });
            } else if (typeof val === 'string' && !FILE_EXT_REGEX.test(val.trim())) {
                list.push(val);
            } else if (val && typeof val === 'object' && val.text) {
                if (Array.isArray(val.text)) list.push(...val.text);
                else if (typeof val.text === 'string') list.push(val.text);
            }
        }
    }
    return list;
}

export function getRunOutputs(nodeOutputs, rawWorkflow, promptGraph = null) {
    const workflow = parseWorkflow(rawWorkflow);
    const list = [];
    if (!nodeOutputs) return list;
    for (const nodeId in nodeOutputs) {
        if (isNodeIgnored(nodeId, workflow)) continue;
        const nodeOut = nodeOutputs[nodeId];
        if (!nodeOut || (typeof nodeOut === "object" && Object.keys(nodeOut).length === 0)) {
            // Even if the output dict is empty, check if this node was a Save/Extract node
            const imgs = findImagesInOutputs({ [nodeId]: nodeOut }, workflow);
            if (imgs.length > 0) {
                const title = getNodeTitle(nodeId, workflow, promptGraph);
                list.push({ nodeId, images: imgs, nodeTitle: title });
            }
            continue;
        }
        const imgs = findImagesInOutputs({ [nodeId]: nodeOut }, workflow);
        if (imgs.length > 0) {
            const title = getNodeTitle(nodeId, workflow, promptGraph);
            list.push({ nodeId, images: imgs, nodeTitle: title });
        }
    }
    return list;
}

export function getPrimaryOutputImages(nodeOutputs, rawWorkflow) {
    if (!nodeOutputs) return findImagesInOutputs(null, rawWorkflow);
    const runOutputs = getRunOutputs(nodeOutputs, rawWorkflow);
    if (runOutputs.length === 0) return findImagesInOutputs(nodeOutputs, rawWorkflow);
    // Find the latest executed node that actually produced real output images
    for (let i = runOutputs.length - 1; i >= 0; i--) {
        const imgs = runOutputs[i].images || [];
        if (imgs.some(img => !img.isFallback)) {
            return imgs;
        }
    }
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

export async function extractWorkflowFromPng(imageUrl) {
    try {
        const res = await fetch(imageUrl);
        const buffer = await res.arrayBuffer();
        const view = new DataView(buffer);

        if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
            return null;
        }

        let offset = 8;
        const utf8Decoder = new TextDecoder("utf-8");

        while (offset < buffer.byteLength) {
            const length = view.getUint32(offset);
            const type = utf8Decoder.decode(new Uint8Array(buffer, offset + 4, 4));

            if (type === "tEXt") {
                const chunkData = new Uint8Array(buffer, offset + 8, length);
                const nullIdx = chunkData.indexOf(0);
                if (nullIdx !== -1) {
                    const keyword = utf8Decoder.decode(chunkData.subarray(0, nullIdx));
                    if (keyword === "workflow") {
                        const text = utf8Decoder.decode(chunkData.subarray(nullIdx + 1));
                        return JSON.parse(text);
                    }
                }
            } else if (type === "IEND") {
                break;
            }

            offset += 12 + length;
        }
    } catch (e) {
        console.warn("Comfy Sidebar: Could not extract workflow from PNG", e);
    }
    return null;
}