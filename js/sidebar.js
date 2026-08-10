import { app } from "/scripts/app.js";
import { injectStyles } from "./styles.js";
import { setupDragAndDrop } from "./dragdrop.js";
import { setupSidebarUI, applySidebarOverride, findOurSidebarButton, setSyncQueue, updateSidebarBadge, renderDOM } from "./ui.js";
import { setupApiListeners, initSessionAndHistory, syncQueue, setUIDependencies } from "./queue.js";
import { applyClassicLayout, setupPropertiesPanelToggleFix, syncClassicLayout, syncStockHistoryAndProgressSettings } from "./layout.js";

let isInitialized = false;
let activeKeydownHandler = null;
let nodeDOMObserver = null;

// Helper to scan node container for the exact text element rendering the title (Vue Mode)
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

function syncNodeVueBadge(node, isIgnored) {
    // Robust multi-selector search for Vue node containers across different frontend versions
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

function setupVueNodeObserver() {
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
}

function toggleIgnoreActiveNode() {
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
    
    if (app.graph) app.graph.setDirtyCanvas(true, true);
    if (app.canvas) app.canvas.setDirty(true, true);
}

app.registerExtension({
    name: "ComfySidebar.ClassicRestore",
    
    init() {
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Grid Columns Threshold", name: "Width Threshold for Queue Columns (px)", type: "number", defaultValue: 350 });
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Keep Object Aspect Ratio", name: "If disabled, cards in the queue will be cropped to the same size.", type: "boolean", defaultValue: true });
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Show Pending Count Only", name: "If disabled, each queued job will have a separate individual card", type: "boolean", defaultValue: true });
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Show Working Node Name", name: "Shows the name of the node which is currently in the process", type: "boolean", defaultValue: true });
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Auto Clear Interrupted", name: "Auto-clear cancelled & failed jobs on new generation", type: "boolean", defaultValue: false });

        const sidebarTabs = ["Assets", "Nodes", "Models", "Workflows", "Apps", "Templates"];
        sidebarTabs.forEach(tab => {
            app.ui.settings.addSetting({
                id: `Comfy Sidebar.Hide Junk.${tab}`,
                name: `Hide Tab: ${tab}`,
                type: "boolean",
                defaultValue: false,
                onChange: () => {
                    setTimeout(() => { syncClassicLayout(); }, 0);
                }
            });
        });

        app.ui.settings.addSetting({ 
            id: "Comfy Sidebar.Hide Junk.Override Stock Job History Tab", 
            name: "Replace the stock Job History sidebar with Comfy Queue", 
            type: "boolean", 
            defaultValue: false,
            onChange: (value) => {
                if (isInitialized && app.ui && app.ui.settings) {
                    syncStockHistoryAndProgressSettings(value);
                }
                setTimeout(() => { syncClassicLayout(); }, 0);
            }
        });

        app.ui.settings.addSetting({ 
            id: "Comfy Sidebar.Hide Junk.Graph Button", 
            name: "Hide floating 'Graph' (Workflow/Node Map) button", 
            type: "boolean", 
            defaultValue: false,
            onChange: () => {
                setTimeout(() => { syncClassicLayout(); }, 0);
            }
        });

        app.ui.settings.addSetting({
            id: "Comfy Sidebar.Comfy Layout",
            name: "Places the controls and the open workflow tabs on a single unified top bar",
            type: "boolean",
            defaultValue: false,
            onChange: (value) => {
                if (isInitialized) {
                    applyClassicLayout(value, true);
                }
            }
        });
    },

    commands: [
        {
            id: "ComfySidebar.ToggleSidebar",
            label: "Toggle Comfy Queue Sidebar",
            function: () => {
                const ourBtn = findOurSidebarButton();
                if (ourBtn) ourBtn.click();
            }
        },
        {
            id: "ComfySidebar.ToggleIgnoreNode",
            label: "Toggle Ignore Selected Node(s) in Queue",
            function: () => toggleIgnoreActiveNode()
        }
    ],

    nodeCreated(node) {
        if (node && node.properties?.ignoreInQueue) {
            node.boxcolor = "#ff3333";
            syncNodeVueBadge(node, true);
        }
    },

    afterConfigureGraph() {
        requestAnimationFrame(() => syncAllNodeBadges());
    },

    async setup() {
        if (!app.extensionManager || !app.extensionManager.registerSidebarTab) return;

        const isClassicLayoutEnabled = app.ui.settings.getSettingValue("Comfy Sidebar.Comfy Layout") ?? false;
        applyClassicLayout(isClassicLayoutEnabled, false);

        const isHistoryOverrideEnabled = app.ui.settings.getSettingValue("Comfy Sidebar.Hide Junk.Override Stock Job History Tab") ?? false;
        if (isHistoryOverrideEnabled) {
            syncStockHistoryAndProgressSettings(true);
        }
        
        isInitialized = true;

        setupPropertiesPanelToggleFix();

        setSyncQueue(syncQueue);
        setUIDependencies(renderDOM, updateSidebarBadge);

        injectStyles();
        setupDragAndDrop();

        const sidebarContainer = setupSidebarUI();
        
        setupApiListeners();
        
        await initSessionAndHistory();

        // Watch for Vue DOM node mounting events (e.g. LiteGraph ↔ Vue mode switches)
        setupVueNodeObserver();

        // Remove any existing keydown listener from previous hot-reload
        if (activeKeydownHandler) {
            document.removeEventListener("keydown", activeKeydownHandler, true);
            activeKeydownHandler = null;
        }

        // Clean, direct keyboard listener
        activeKeydownHandler = (e) => {
            const activeEl = document.activeElement;
            if (activeEl && (
                activeEl.tagName === "INPUT" || 
                activeEl.tagName === "TEXTAREA" || 
                activeEl.isContentEditable || 
                activeEl.tagName === "SELECT"
            )) return;
            
            // Toggle sidebar with Q
            if (e.key.toLowerCase() === "q" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                const ourBtn = findOurSidebarButton();
                if (ourBtn) ourBtn.click();
            }

            // Toggle ignore node with Ctrl+Q or Cmd+Q (Mac)
            if (e.key.toLowerCase() === "q" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                toggleIgnoreActiveNode();
            }
        };

        document.addEventListener("keydown", activeKeydownHandler, true);

        // Apply sidebar override when initializing
        applySidebarOverride();

        app.extensionManager.registerSidebarTab({ 
            id: "classic-comfy-sidebar", 
            icon: "pi pi-images", 
            title: "Queue", 
            tooltip: "Comfy Queue (Q)", 
            type: "custom", 
            render: (el) => { el.appendChild(sidebarContainer); } 
        });
    },

    destroy() {
        if (nodeDOMObserver) {
            nodeDOMObserver.disconnect();
            nodeDOMObserver = null;
        }

        if (activeKeydownHandler) {
            document.removeEventListener("keydown", activeKeydownHandler, true);
            activeKeydownHandler = null;
        }

        if (app.extensionManager?.unregisterSidebarTab) {
            app.extensionManager.unregisterSidebarTab("classic-comfy-sidebar");
        }
    }
});