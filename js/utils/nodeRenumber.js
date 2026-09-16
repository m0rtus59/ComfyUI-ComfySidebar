import { app } from "/scripts/app.js";
import { syncAllNodeBadges } from "../comfy/nodes.js";

export function showNotification(message, type = "success") {
    const summary = type === "error" ? "Error" : type === "warn" ? "Warning" : "Node Renumber";
    
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

export async function renumberNodesTopologically() {
    if (!app.graph || !app.graph._nodes || app.graph._nodes.length === 0) {
        showNotification("No nodes found on canvas to renumber.", "warn");
        return;
    }

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

        const oldToNew = new Map();
        sortedNodes.forEach((node, index) => {
            const newId = index + 1;
            oldToNew.set(node.id, newId);
            oldToNew.set(String(node.id), newId);
        });

        // 1. Remap node IDs in-place on app.graph
        app.graph._nodes_by_id = {};
        sortedNodes.forEach(node => {
            const oldId = node.id;
            const newId = oldToNew.get(oldId);
            if (newId != null) {
                // Update internal widget IDs like "$2034-0" (PreviewBridge)
                if (Array.isArray(node.widgets)) {
                    for (const w of node.widgets) {
                        if (typeof w.value === "string" && w.value.startsWith(`$${oldId}-`)) {
                            w.value = w.value.replace(`$${oldId}-`, `$${newId}-`);
                        }
                    }
                }
                node.id = newId;
                app.graph._nodes_by_id[newId] = node;
            }
        });

        // 2. Remap links
        if (app.graph.links) {
            const links = app.graph.links instanceof Map 
                ? Array.from(app.graph.links.values()) 
                : Object.values(app.graph.links);

            links.forEach(link => {
                if (!link) return;
                if (oldToNew.has(link.origin_id)) link.origin_id = oldToNew.get(link.origin_id);
                if (oldToNew.has(link.target_id)) link.target_id = oldToNew.get(link.target_id);
            });
        }

        app.graph.last_node_id = sortedNodes.length;
        app.graph.setDirtyCanvas(true, true);
        if (app.canvas?.draw) {
            app.canvas.draw(true, true);
        }
        syncAllNodeBadges();

        const lastNode = sortedNodes[sortedNodes.length - 1];
        const lastNodeName = lastNode ? (lastNode.title || lastNode.type) : "SaveImage";
        showNotification(`Renumbered ${sortedNodes.length} nodes by execution order. Latest node: #${lastNode.id} (${lastNodeName}).`, "success");
    } catch (err) {
        console.error("ComfySidebar: Failed to renumber nodes", err);
        showNotification("Failed to renumber nodes: " + err.message, "error");
    }
}

export async function setManualNodeId(targetNode = null) {
    if (!app.graph) return;
    const node = targetNode || (app.canvas?.selected_nodes ? Object.values(app.canvas.selected_nodes)[0] : null);
    if (!node) {
        showNotification("Please select a node first to change its ID.", "warn");
        return;
    }

    const currentId = node.id;
    const input = prompt(`Enter new ID for node #${currentId} (${node.title || node.type}):`, String(currentId));
    if (!input) return;

    const newId = parseInt(input.trim(), 10);
    if (isNaN(newId) || newId <= 0) {
        showNotification("Please enter a valid positive number.", "error");
        return;
    }
    if (newId === currentId) return;

    try {
        const existingNode = app.graph.getNodeById ? app.graph.getNodeById(newId) : null;
        if (existingNode && existingNode !== node) {
            const confirmSwap = confirm(`Node ID #${newId} is already used by "${existingNode.title || existingNode.type}". Swap their IDs?`);
            if (!confirmSwap) return;
        }

        const oldToNew = new Map();
        if (existingNode && existingNode !== node) {
            oldToNew.set(currentId, newId);
            oldToNew.set(newId, currentId);
            existingNode.id = currentId;
        } else {
            oldToNew.set(currentId, newId);
        }
        node.id = newId;

        // Rebuild lookup map
        app.graph._nodes_by_id = {};
        for (const n of app.graph._nodes) {
            app.graph._nodes_by_id[n.id] = n;
        }

        // Remap links
        if (app.graph.links) {
            const links = app.graph.links instanceof Map 
                ? Array.from(app.graph.links.values()) 
                : Object.values(app.graph.links);

            links.forEach(link => {
                if (!link) return;
                if (oldToNew.has(link.origin_id)) link.origin_id = oldToNew.get(link.origin_id);
                if (oldToNew.has(link.target_id)) link.target_id = oldToNew.get(link.target_id);
            });
        }

        app.graph.last_node_id = Math.max(app.graph.last_node_id || 0, newId, app.graph._nodes.length);
        app.graph.setDirtyCanvas(true, true);
        if (app.canvas?.draw) {
            app.canvas.draw(true, true);
        }
        syncAllNodeBadges();
        showNotification(`Assigned node ID #${newId} to "${node.title || node.type}".`, "success");
    } catch (err) {
        console.error("ComfySidebar: Failed to set node ID", err);
        showNotification("Failed to set node ID: " + err.message, "error");
    }
}