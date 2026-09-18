import { app } from "/scripts/app.js";
import { SettingIds } from "./core/constants.js";
import { injectStyles } from "./utils/styles.js";
import { setupDragAndDrop } from "./utils/dragdrop.js";
import { renumberNodesTopologically, setManualNodeId } from "./utils/nodeRenumber.js";
import { findOurSidebarButton } from "./comfy/adapter.js";
import { syncAllNodeBadges, setupVueNodeObserver, toggleIgnoreActiveNode } from "./comfy/nodes.js";
import { applyClassicLayout, setupPropertiesPanelToggleFix, syncClassicLayout, syncStockHistoryAndProgressSettings, destroyLayoutFix } from "./comfy/layout.js";
import { initSessionAndHistory, syncQueue } from "./queue/queueService.js";
import { setupExecutionTracker } from "./queue/executionTracker.js";
import { setupSidebarView, renderSidebar, teardownSidebarView } from "./ui/sidebarView.js";
import { updateCardProgressTargeted, cardPool } from "./ui/cardRenderer.js";
import { store } from "./core/store.js";

let isInitialized = false;
let activeKeydownHandler = null;
let cleanupFns = [];

function registerSettings() {
    app.ui.settings.addSetting({
        id: SettingIds.GRID_COLUMNS_THRESHOLD,
        name: "Width Threshold for Queue Columns (px)",
        type: "number",
        defaultValue: 350
    });

    app.ui.settings.addSetting({
        id: SettingIds.SHOW_PENDING_COUNT_ONLY,
        name: "If disabled, each queued job will have a separate individual card",
        type: "boolean",
        defaultValue: true
    });

    app.ui.settings.addSetting({
        id: SettingIds.SHOW_WORKING_NODE_NAME,
        name: "Shows the name of the node which is currently in the process",
        type: "boolean",
        defaultValue: true
    });

    app.ui.settings.addSetting({
        id: SettingIds.AUTO_CLEAR_INTERRUPTED,
        name: "Auto-clear cancelled & failed jobs on new generation",
        type: "boolean",
        defaultValue: false
    });
    app.ui.settings.addSetting({
        id: "Comfy Sidebar.Permanent Delete on Disk Deletion",
        name: "Permanently delete files on disk deletion (bypasses Recycle Bin / Trash)",
        type: "boolean",
        defaultValue: false
    });

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
        id: SettingIds.OVERRIDE_STOCK_HISTORY,
        name: "Replace the stock Job History sidebar with Comfy Queue",
        type: "boolean",
        defaultValue: false,
        onChange: (value) => {
            if (isInitialized && app.ui?.settings) {
                syncStockHistoryAndProgressSettings(value);
            }
            setTimeout(() => { syncClassicLayout(); }, 0);
        }
    });

    app.ui.settings.addSetting({
        id: SettingIds.HIDE_GRAPH_BUTTON,
        name: "Hide floating 'Graph' (Workflow/Node Map) button",
        type: "boolean",
        defaultValue: false,
        onChange: () => {
            setTimeout(() => { syncClassicLayout(); }, 0);
        }
    });

    app.ui.settings.addSetting({
        id: SettingIds.CLASSIC_LAYOUT,
        name: "Places the controls and the open workflow tabs on a single unified top bar",
        type: "boolean",
        defaultValue: false,
        onChange: (value) => {
            if (isInitialized) {
                applyClassicLayout(value, true);
            }
        }
    });
}

function setupKeydownShortcuts() {
    activeKeydownHandler = (e) => {
        const activeEl = document.activeElement;
        if (activeEl && (
            activeEl.tagName === "INPUT" ||
            activeEl.tagName === "TEXTAREA" ||
            activeEl.isContentEditable ||
            activeEl.tagName === "SELECT"
        )) return;

        if (e.key.toLowerCase() === "q" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            const ourBtn = findOurSidebarButton();
            if (ourBtn) ourBtn.click();
        }

        if (e.key.toLowerCase() === "q" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            toggleIgnoreActiveNode(() => renderSidebar());
        }

        // Alt+R: Renumber all nodes in execution order
        if (e.key.toLowerCase() === "r" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            renumberNodesTopologically();
        }
    };

    document.addEventListener("keydown", activeKeydownHandler, true);
}

app.registerExtension({
    name: "ComfySidebar.ClassicRestore",

    init() {
        registerSettings();
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
            function: () => toggleIgnoreActiveNode(() => renderSidebar())
        },
        {
            id: "ComfySidebar.RenumberNodes",
            label: "Renumber All Nodes (Execution Order)",
            function: () => renumberNodesTopologically()
        },
        {
            id: "ComfySidebar.SetNodeId",
            label: "Set Selected Node ID...",
            function: () => setManualNodeId()
        }
    ],

    getNodeMenuItems(node) {
        return [
            null,
            {
                content: "Set Node ID...",
                callback: () => setManualNodeId(node)
            }
        ];
    },

    getCanvasMenuItems() {
        return [
            null,
            {
                content: "Renumber All Nodes (Execution Order)",
                callback: () => renumberNodesTopologically()
            }
        ];
    },

    nodeCreated(node) {
        if (node && node.properties?.ignoreInQueue) {
            node.boxcolor = "#ff3333";
            syncAllNodeBadges();
        }
    },

    afterConfigureGraph() {
        requestAnimationFrame(() => {
            syncAllNodeBadges();
            renderSidebar();
        });
    },

    async setup() {
        if (!app.extensionManager || !app.extensionManager.registerSidebarTab) return;

        const isClassicLayoutEnabled = app.ui.settings.getSettingValue(SettingIds.CLASSIC_LAYOUT) ?? false;
        applyClassicLayout(isClassicLayoutEnabled, false);

        const isHistoryOverrideEnabled = app.ui.settings.getSettingValue(SettingIds.OVERRIDE_STOCK_HISTORY) ?? false;
        if (isHistoryOverrideEnabled) {
            syncStockHistoryAndProgressSettings(true);
        }

        isInitialized = true;

        setupPropertiesPanelToggleFix();
        injectStyles();

        cleanupFns.push(setupDragAndDrop());
        cleanupFns.push(setupVueNodeObserver());

        // Setup execution tracker with targeted fast-path update for active card
        cleanupFns.push(setupExecutionTracker((pid, progress, nodeName) => {
            const cardObj = cardPool.get(pid);
            const state = store.getPrompt(pid);
            if (cardObj && state) {
                const showWorkingNode = app.ui.settings.getSettingValue(SettingIds.SHOW_WORKING_NODE_NAME) ?? true;
                updateCardProgressTargeted(cardObj, progress, nodeName, showWorkingNode, state);
            } else {
                renderSidebar();
            }
        }));

        const sidebarContainer = setupSidebarView();

        await initSessionAndHistory();
        setupKeydownShortcuts();

        syncAllNodeBadges();

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
        for (const fn of cleanupFns.splice(0)) {
            try { if (typeof fn === "function") fn(); } catch (e) {}
        }
        destroyLayoutFix();
        teardownSidebarView();

        if (activeKeydownHandler) {
            document.removeEventListener("keydown", activeKeydownHandler, true);
            activeKeydownHandler = null;
        }

        if (app.extensionManager?.unregisterSidebarTab) {
            app.extensionManager.unregisterSidebarTab("classic-comfy-sidebar");
        }
    }
});
