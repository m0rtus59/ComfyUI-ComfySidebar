import { app } from "/scripts/app.js";
import { applySidebarOverride } from "./adapter.js";

let nodeDOMObserver = null;

function findHeaderByText(parent, text) {
    if (!text) return null;
    const cleanText = text.trim();
    
    const elements = parent.querySelectorAll("span, div, h1, h2, h3, h4, p, [class*='title'], [class*='text']");
    for (const el of elements) {
        if (el.textContent.trim() === cleanText) {
            if (el.offsetWidth > 0 && el.offsetHeight > 0 && el.offsetWidth < parent.offsetWidth * 0.9) {
                return el;
            }
        }
    }
    return null;
}

export function syncNodeVueBadge(node, isIgnored) {
    const nodeEl = document.querySelector(
        `.comfy-node[data-node-id="${node.id}"], ` +
        `[data-node-id="${node.id}"], ` +
        `[data-id="${node.id}"]`
    );
    if (!nodeEl) return;

    const titleTextNode = findHeaderByText(nodeEl, node.title || node.type);
    if (!titleTextNode) {
        const badge = nodeEl.querySelector(".comfy-sidebar-ignore-badge");
        if (badge && !isIgnored) badge.remove();
        return;
    }

    const headerEl = titleTextNode.parentNode;
    let badge = headerEl.querySelector(".comfy-sidebar-ignore-badge");

    if (isIgnored) {
        if (!badge) {
            badge = document.createElement("div");
            badge.className = "comfy-sidebar-ignore-badge";
            badge.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
                    <path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
                    <line x1="2" y1="2" x2="22" y2="22"/>
                </svg>
            `;
            Object.assign(badge.style, {
                marginLeft: "auto",
                marginRight: "6px",
                float: "right",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "inherit",
                pointerEvents: "none"
            });
            headerEl.appendChild(badge);
        }
    } else {
        if (badge) badge.remove();
    }
}

export function syncAllNodeBadges() {
    applySidebarOverride();
    if (!app.graph || !app.graph._nodes) return;

    app.graph._nodes.forEach(node => {
        if (!node.properties) node.properties = {};
        const isIgnored = !!node.properties.ignoreInQueue;

        if (isIgnored) {
            if (node.boxcolor !== "#ff3333") {
                node._oldBoxcolor = node.boxcolor || "";
                node.boxcolor = "#ff3333";
                if (app.graph) app.graph.setDirtyCanvas(true, true);
            }
        } else {
            if (node.boxcolor === "#ff3333") {
                node.boxcolor = node._oldBoxcolor || "";
                delete node._oldBoxcolor;
                if (app.graph) app.graph.setDirtyCanvas(true, true);
            }
        }

        syncNodeVueBadge(node, isIgnored);
    });
}

export function setupVueNodeObserver() {
    if (nodeDOMObserver) nodeDOMObserver.disconnect();

    let timeoutId = null;
    nodeDOMObserver = new MutationObserver((mutations) => {
        let hasNodeMutation = false;
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1) {
                    if (node.hasAttribute?.("data-node-id") || 
                        node.classList?.contains("comfy-node") || 
                        node.querySelector?.('[data-node-id], .comfy-node')) {
                        hasNodeMutation = true;
                        break;
                    }
                }
            }
            if (hasNodeMutation) break;
        }

        if (hasNodeMutation) {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                syncAllNodeBadges();
            }, 50);
        }
    });

    nodeDOMObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    return () => {
        if (nodeDOMObserver) {
            nodeDOMObserver.disconnect();
            nodeDOMObserver = null;
        }
    };
}

export function toggleIgnoreActiveNode(onModified) {
    const canvas = app.canvas;
    if (!canvas) return;
    
    let nodes = [];
    if (canvas.selected_nodes && Object.keys(canvas.selected_nodes).length > 0) {
        nodes = Object.values(canvas.selected_nodes);
    } else if (canvas.current_active_node) {
        nodes = [canvas.current_active_node];
    }
    
    if (nodes.length === 0) return;
    
    nodes.forEach(node => {
        if (!node.properties) node.properties = {};
        node.properties.ignoreInQueue = !node.properties.ignoreInQueue;
        const isIgnored = !!node.properties.ignoreInQueue;

        if (isIgnored) {
            if (node.boxcolor !== "#ff3333") {
                node._oldBoxcolor = node.boxcolor || "";
                node.boxcolor = "#ff3333";
            }
        } else {
            if (node.boxcolor === "#ff3333") {
                node.boxcolor = node._oldBoxcolor || "";
                delete node._oldBoxcolor;
            }
        }

        syncNodeVueBadge(node, isIgnored);
    });
    
    if (app.graph) {
        if (app.graph.change) app.graph.change();
        app.graph.setDirtyCanvas(true, true);
    }
    if (app.canvas) app.canvas.setDirty(true, true);

    if (typeof onModified === "function") {
        onModified();
    }
}
