import { app } from "/scripts/app.js";
import { t } from "../core/i18n.js";
import { syncAllNodeBadges } from "../comfy/nodes.js";

export function showNotification(message, type = "success", title = null) {
    const summary = title || (type === "error" ? t("Error") : type === "warn" ? t("Warning") : "Comfy Sidebar");
    
    if (app.extensionManager?.toast?.add) {
        app.extensionManager.toast.add({
            severity: type === "error" ? "error" : type === "warn" ? "warn" : "success",
            summary,
            detail: message,
            life: 4000
        });
        return;
    }

    // Elegant non-blocking fallback if native toast is unavailable
    const id = "comfy-sidebar-toast";
    let toast = document.getElementById(id);
    if (!toast) {
        toast = document.createElement("div");
        toast.id = id;
        document.body.appendChild(toast);
    }
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #18181b;
        color: #f4f4f5;
        padding: 12px 18px;
        border-radius: 8px;
        border-left: 4px solid ${type === "error" ? "#ef4444" : type === "warn" ? "#f59e0b" : "#10b981"};
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        max-width: 380px;
        transition: opacity 0.25s ease, transform 0.25s ease;
        opacity: 0;
        transform: translateY(10px);
        pointer-events: none;
    `;
    toast.innerHTML = `<strong style="color:${type === "error" ? "#f87171" : type === "warn" ? "#fbbf24" : "#34d399"}">${summary}</strong><div style="margin-top:2px;">${message}</div>`;
    requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    });
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function remapWidgetValue(val, oldToNew) {
    if (typeof val === "string") {
        const match = val.match(/^\$([^-]+)-(.*)$/);
        if (match) {
            const mapped = oldToNew.get(match[1]) ?? oldToNew.get(Number(match[1]));
            if (mapped != null) {
                return `$${mapped}-${match[2]}`;
            }
        }
    }
    return val;
}

function applyIdMappingToGraph(oldToNew) {
    if (!app.graph) return;
    const graphData = app.graph.serialize();
    if (!graphData) return;

    // 1. Remap node IDs and internal widget references
    if (Array.isArray(graphData.nodes)) {
        for (const node of graphData.nodes) {
            const oldId = node.id;
            const newId = oldToNew.get(oldId) ?? oldToNew.get(String(oldId)) ?? oldToNew.get(Number(oldId));
            if (newId != null) {
                node.id = newId;
            }
            if (Array.isArray(node.widgets_values)) {
                node.widgets_values = node.widgets_values.map(val => remapWidgetValue(val, oldToNew));
            } else if (node.widgets_values && typeof node.widgets_values === "object") {
                for (const key of Object.keys(node.widgets_values)) {
                    node.widgets_values[key] = remapWidgetValue(node.widgets_values[key], oldToNew);
                }
            }
        }
    }

    // 2. Remap link endpoints (both array tuples and object representations)
    const linkList = Array.isArray(graphData.links)
        ? graphData.links
        : (graphData.links && typeof graphData.links === "object" ? Object.values(graphData.links) : []);

    for (const link of linkList) {
        if (!link) continue;
        if (Array.isArray(link)) {
            // [id, origin_id, origin_slot, target_id, target_slot, type]
            const originId = link[1];
            const targetId = link[3];
            const newOrigin = oldToNew.get(originId) ?? oldToNew.get(String(originId)) ?? oldToNew.get(Number(originId));
            if (newOrigin != null) link[1] = newOrigin;
            const newTarget = oldToNew.get(targetId) ?? oldToNew.get(String(targetId)) ?? oldToNew.get(Number(targetId));
            if (newTarget != null) link[3] = newTarget;
        } else if (typeof link === "object") {
            const originId = link.origin_id;
            const targetId = link.target_id;
            const newOrigin = oldToNew.get(originId) ?? oldToNew.get(String(originId)) ?? oldToNew.get(Number(originId));
            if (newOrigin != null) link.origin_id = newOrigin;
            const newTarget = oldToNew.get(targetId) ?? oldToNew.get(String(targetId)) ?? oldToNew.get(Number(targetId));
            if (newTarget != null) link.target_id = newTarget;
        }
    }

    // 3. Remap group membership if defined
    if (Array.isArray(graphData.groups)) {
        for (const group of graphData.groups) {
            if (Array.isArray(group.nodes)) {
                group.nodes = group.nodes.map(id => oldToNew.get(id) ?? oldToNew.get(String(id)) ?? oldToNew.get(Number(id)) ?? id);
            }
        }
    }

    // 4. Update graph last_node_id counter
    let maxId = 0;
    for (const val of oldToNew.values()) {
        const num = Number(val);
        if (!isNaN(num) && num > maxId) maxId = num;
    }
    graphData.last_node_id = Math.max(graphData.last_node_id || 0, maxId, graphData.nodes?.length || 0);

    // 5. Preserve canvas pan/zoom coordinates so the screen doesn't jump
    const currentScale = app.canvas?.ds?.scale;
    const currentOffset = app.canvas?.ds?.offset ? [...app.canvas.ds.offset] : null;

    app.graph.configure(graphData);

    if (app.canvas?.ds && currentScale != null && currentOffset != null) {
        app.canvas.ds.scale = currentScale;
        app.canvas.ds.offset[0] = currentOffset[0];
        app.canvas.ds.offset[1] = currentOffset[1];
    }

    if (typeof app.graph.afterChange === "function") {
        app.graph.afterChange();
    }
    app.graph.setDirtyCanvas(true, true);
    if (app.canvas?.draw) {
        app.canvas.draw(true, true);
    }
    syncAllNodeBadges();
}

export async function renumberNodesTopologically() {
    if (!app.graph || !app.graph._nodes || app.graph._nodes.length === 0) {
        showNotification(t("No nodes found on canvas to renumber."), "warn");
        return;
    }

    const confirmed = confirm(
        t("Renumbering will rewrite all node IDs on the canvas in topological execution order.\n\nThis will fix intermediate node outputs showing as the final result, but may break external scripts that rely on specific node IDs\n\nDo you want to proceed?")
    );
    if (!confirmed) return;

    try {
        // Compute LiteGraph's topological execution order
        if (typeof app.graph.computeExecutionOrder === "function") {
            app.graph.computeExecutionOrder(false);
        }

        // Sort nodes by order (lowest executes first; highest executes last)
        const sortedNodes = [...app.graph._nodes].sort((a, b) => {
            const orderA = typeof a.order === "number" ? a.order : Infinity;
            const orderB = typeof b.order === "number" ? b.order : Infinity;
            if (orderA !== orderB) return orderA - orderB;

            const posXA = Array.isArray(a.pos) ? a.pos[0] : 0;
            const posXB = Array.isArray(b.pos) ? b.pos[0] : 0;
            if (posXA !== posXB) return posXA - posXB;

            const posYA = Array.isArray(a.pos) ? a.pos[1] : 0;
            const posYB = Array.isArray(b.pos) ? b.pos[1] : 0;
            return posYA - posYB;
        });

        const isStringId = typeof sortedNodes[0]?.id === "string";
        const oldToNew = new Map();
        sortedNodes.forEach((node, index) => {
            const newId = isStringId ? String(index + 1) : (index + 1);
            oldToNew.set(node.id, newId);
            oldToNew.set(String(node.id), newId);
            oldToNew.set(Number(node.id), newId);
        });

        applyIdMappingToGraph(oldToNew);

        const lastNode = sortedNodes[sortedNodes.length - 1];
        const lastNodeName = lastNode ? (lastNode.title || lastNode.type) : "SaveImage";
        const lastNewId = lastNode ? oldToNew.get(lastNode.id) : "";
        showNotification(t("Renumbered {count} nodes by execution order. Latest node: #{id} ({name}).", { count: sortedNodes.length, id: lastNewId, name: lastNodeName }), "success");
    } catch (err) {
        console.error("ComfySidebar: Failed to renumber nodes", err);
        showNotification(t("Failed to renumber nodes: ") + err.message, "error");
    }
}

export async function setManualNodeId(targetNode = null) {
    if (!app.graph) return;
    const rawSelected = app.canvas?.selected_nodes;
    const selectedList = rawSelected instanceof Map || rawSelected instanceof Set
        ? Array.from(rawSelected.values())
        : (Array.isArray(rawSelected) ? rawSelected : (rawSelected && typeof rawSelected === "object" ? Object.values(rawSelected) : []));
    const node = targetNode || selectedList[0] || app.canvas?.current_active_node || null;
    if (!node) {
        showNotification(t("Please select a node first to change its ID."), "warn");
        return;
    }

    const currentId = node.id;
    const input = prompt(t("Enter new ID for node #{id} ({name}):", { id: currentId, name: node.title || node.type }), String(currentId));
    if (!input) return;

    const newIdNum = parseInt(input.trim(), 10);
    if (isNaN(newIdNum) || newIdNum <= 0) {
        showNotification(t("Please enter a valid positive number."), "error");
        return;
    }
    if (String(newIdNum) === String(currentId)) return;

    try {
        const existingNode = app.graph.getNodeById ? (app.graph.getNodeById(newIdNum) || app.graph.getNodeById(String(newIdNum))) : null;
        if (existingNode && existingNode !== node) {
            const confirmSwap = confirm(t("Node ID #{id} is already used by \"{name}\". Swap their IDs?", { id: newIdNum, name: existingNode.title || existingNode.type }));
            if (!confirmSwap) return;
        }

        const isStringId = typeof currentId === "string";
        const newId = isStringId ? String(newIdNum) : newIdNum;
        const oldId = currentId;

        const oldToNew = new Map();
        if (existingNode && existingNode !== node) {
            const existingId = existingNode.id;
            oldToNew.set(oldId, newId);
            oldToNew.set(String(oldId), newId);
            oldToNew.set(Number(oldId), newId);

            oldToNew.set(existingId, oldId);
            oldToNew.set(String(existingId), oldId);
            oldToNew.set(Number(existingId), oldId);
        } else {
            oldToNew.set(oldId, newId);
            oldToNew.set(String(oldId), newId);
            oldToNew.set(Number(oldId), newId);
        }

        applyIdMappingToGraph(oldToNew);

        const updatedNode = app.graph.getNodeById ? (app.graph.getNodeById(newId) || app.graph.getNodeById(String(newId))) : null;
        if (updatedNode && app.canvas?.selectNode) {
            app.canvas.selectNode(updatedNode);
        }

        showNotification(t("Assigned node ID #{id} to \"{name}\".", { id: newId, name: node.title || node.type }), "success");
    } catch (err) {
        console.error("ComfySidebar: Failed to set node ID", err);
        showNotification(t("Failed to set node ID: ") + err.message, "error");
    }
}