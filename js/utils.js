import { app } from "/scripts/app.js";

const FILE_EXT_REGEX = /\.(safetensors|ckpt|pt|pth|bin|latent|onnx|engine|gguf|lora|zip|tar|gz|7z|json|csv|parquet|txt|yaml|yml|xml|pdf|blend|fbx|obj|glb|gltf|stl|ply|splat|spz|ksplat|png|jpg|jpeg|webp|gif|bmp|tiff|svg|mp4|webm|wav|mp3|ogg|flac|m4a|aac|opus)$/i;

export const isImageFormat = (url) => {
    if (!url) return false;
    if (String(url).startsWith("blob:") || String(url).startsWith("data:image/")) return true;
    const s = String(url).toLowerCase().split("?")[0];
    return s.endsWith(".png") || s.endsWith(".jpg") || s.endsWith(".jpeg") || 
           s.endsWith(".webp") || s.endsWith(".gif") || s.endsWith(".bmp") || 
           s.endsWith(".tiff") || s.endsWith(".tif") || s.endsWith(".svg") || 
           s.endsWith(".avif") || s.endsWith(".ico") || s.endsWith(".apng");
};

export const isVideoFormat = (url) => {
    if (!url) return false;
    const s = String(url).toLowerCase().split("?")[0];
    return s.endsWith(".mp4") || s.endsWith(".webm") || s.endsWith(".mov") || s.endsWith(".mkv");
};

export const is3DFormat = (url) => {
    if (!url) return false;
    const s = String(url).toLowerCase().split("?")[0];
    return s.endsWith(".glb") || s.endsWith(".gltf") || s.endsWith(".obj") || 
           s.endsWith(".ply") || s.endsWith(".stl") || s.endsWith(".splat") || 
           s.endsWith(".spz") || s.endsWith(".ksplat") || s.endsWith(".fbx");
};

export const isAudioFormat = (url) => {
    if (!url) return false;
    const s = String(url).toLowerCase().split("?")[0];
    return s.endsWith(".wav") || s.endsWith(".mp3") || s.endsWith(".ogg") || 
           s.endsWith(".flac") || s.endsWith(".m4a") || s.endsWith(".aac") || 
           s.endsWith(".opus");
};

export function getFilenameFromUrl(url) {
    if (!url) return "";
    try {
        const u = new URL(url, window.location.origin);
        if (u.searchParams && u.searchParams.get("filename")) {
            return u.searchParams.get("filename");
        }
        const pathname = u.pathname || "";
        return pathname.split("/").pop() || "";
    } catch (e) {
        return String(url).split("?")[0].split("/").pop() || "";
    }
}

export function parseWorkflow(workflow) {
    if (!workflow) return null;
    if (typeof workflow === "object") return workflow;
    if (typeof workflow === "string") {
        try { return JSON.parse(workflow); } catch (e) { return null; }
    }
    return null;
}

function isNodeIgnored(nodeId, rawWorkflow) {
    // 1. Check live canvas node property first
    if (app.graph) {
        const canvasNode = app.graph.getNodeById ? (app.graph.getNodeById(Number(nodeId)) || app.graph.getNodeById(String(nodeId))) : null;
        if (canvasNode?.properties?.ignoreInQueue !== undefined) {
            return !!canvasNode.properties.ignoreInQueue;
        }
    }
    // 2. Fallback to historical workflow snapshot
    const workflow = parseWorkflow(rawWorkflow);
    if (!workflow || !Array.isArray(workflow.nodes)) {
        return false;
    }
    const node = workflow.nodes.find(n => String(n.id) === String(nodeId));
    return !!(node && node.properties && node.properties.ignoreInQueue);
}

function extractFileCandidate(val, subfolder = "", type = "output") {
    if (!val || typeof val !== "string") return null;
    const trimmed = val.trim();

    // 1. Ignore directory dots, floats/numbers, and empty strings
    if (trimmed === "." || trimmed === ".." || trimmed === "./" || trimmed === "../" || trimmed === "") {
        return null;
    }
    if (!isNaN(Number(trimmed))) {
        return null;
    }

    // 2. Extract base file name
    const cleanName = trimmed.split("/").pop()?.split("\\").pop()?.trim() || "";
    if (!cleanName || cleanName === "." || cleanName === "..") return null;

    // 3. Must have a dot with real name before and after (e.g. "model.safetensors")
    const dotIndex = cleanName.lastIndexOf(".");
    if (dotIndex <= 0 || dotIndex === cleanName.length - 1) {
        return null;
    }

    const ext = cleanName.substring(dotIndex + 1).toLowerCase();
    const base = cleanName.substring(0, dotIndex).trim();
    if (!base || !ext) return null;

    // 4. Must match a known extension or a valid 1-8 char alphanumeric extension without whitespace
    const isValidExt = FILE_EXT_REGEX.test("." + ext) || (/^[a-z0-9]{1,8}$/i.test(ext) && !trimmed.includes(" ") && trimmed.length < 100);

    if (isValidExt) {
        return {
            filename: cleanName,
            subfolder: subfolder || (trimmed.includes("/") ? trimmed.substring(0, trimmed.lastIndexOf("/")) : ""),
            type: type || "output"
        };
    }
    return null;
}

export function findImagesInOutputs(outputs, rawWorkflow) {
    const list = [];
    const seen = new Set();

    const addCandidate = (item) => {
        if (!item || !item.filename) return;
        const key = `${item.subfolder || ""}/${item.filename}`;
        if (!seen.has(key)) {
            seen.add(key);
            list.push(item);
        }
    };

    const scan = (obj, sub = "", typ = "output") => {
        if (!obj) return;
        if (typeof obj === "string") {
            const cand = extractFileCandidate(obj, sub, typ);
            if (cand) addCandidate(cand);
            return;
        }
        if (Array.isArray(obj)) {
            obj.forEach(item => scan(item, sub, typ));
            return;
        }
        if (typeof obj === "object") {
            const targetSub = obj.subfolder || sub || "";
            const targetTyp = obj.type || typ || "output";

            const fname = obj.filename || obj.name || obj.file || obj.path || 
                          obj.lora_name || obj.model_name || obj.save_name || 
                          obj.saved_file || obj.output_path || obj.file_name;

            if (fname && typeof fname === "string") {
                const cand = extractFileCandidate(fname, targetSub, targetTyp);
                if (cand) {
                    addCandidate(cand);
                    return;
                }
            }

            for (const key in obj) {
                scan(obj[key], targetSub, targetTyp);
            }
        }
    };

    const workflow = parseWorkflow(rawWorkflow);

    if (outputs) {
        for (const nodeId in outputs) {
            if (isNodeIgnored(nodeId, workflow)) continue;
            scan(outputs[nodeId]);
        }
    }

    if (list.length > 0) return list;

    // Fallback: If scanning a specific node ID, only look at that matching node in the workflow
    if (workflow && Array.isArray(workflow.nodes)) {
        const targetNodeIds = outputs ? Object.keys(outputs).map(String) : null;

        for (const node of workflow.nodes) {
            if (node && !node.properties?.ignoreInQueue) {
                if (targetNodeIds && !targetNodeIds.includes(String(node.id))) {
                    continue;
                }

                const typeStr = (node.type || "").toLowerCase();
                const isLoaderNode = typeStr.includes("load") || typeStr.includes("loader") || typeStr.includes("input");
                const isSaveNode = !isLoaderNode && (typeStr.includes("save") || typeStr.includes("extract") || 
                                   typeStr.includes("export") || typeStr.includes("writer"));
                
                if (isSaveNode && Array.isArray(node.widgets_values)) {
                    for (const val of node.widgets_values) {
                        if (typeof val === "string" && val.trim().length > 0) {
                            let fname = val.trim();
                            if (typeStr.includes("lora") && !fname.includes(".")) {
                                fname += ".safetensors";
                            } else if (typeStr.includes("latent") && !fname.includes(".")) {
                                fname += ".latent";
                            }
                            const cand = extractFileCandidate(fname, typeStr.includes("lora") ? "loras" : "", "output");
                            if (cand) addCandidate(cand);
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

export function getRunOutputs(nodeOutputs, rawWorkflow) {
    const workflow = parseWorkflow(rawWorkflow);
    const list = [];
    if (!nodeOutputs) return list;
    for (const nodeId in nodeOutputs) {
        const nodeOut = nodeOutputs[nodeId];
        // Ignore empty node outputs
        if (!nodeOut || (typeof nodeOut === "object" && Object.keys(nodeOut).length === 0)) {
            continue;
        }
        const imgs = findImagesInOutputs({ [nodeId]: nodeOut }, workflow);
        if (imgs.length > 0) {
            list.push({ nodeId, images: imgs });
        }
    }
    return list;
}

export function getPrimaryOutputImages(nodeOutputs, rawWorkflow) {
    if (!nodeOutputs) return findImagesInOutputs(null, rawWorkflow);
    const runOutputs = getRunOutputs(nodeOutputs, rawWorkflow);
    if (runOutputs.length === 0) return findImagesInOutputs(nodeOutputs, rawWorkflow);
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

        // Verify PNG signature (89 50 4E 47 0D 0A 1A 0A)
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

            offset += 12 + length; // 4 (length) + 4 (type) + length (data) + 4 (crc)
        }
    } catch (e) {
        console.warn("Comfy Sidebar: Could not extract workflow from PNG", e);
    }
    return null;
}