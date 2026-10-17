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
import { initI18n, t } from "./core/i18n.js";
import { updateCardProgressTargeted, cardPool } from "./ui/cardRenderer.js";
import { store } from "./core/store.js";

let isInitialized = false;
let activeKeydownHandler = null;
let cleanupFns = [];

function registerSettings() {
    app.ui.settings.addSetting({
        id: SettingIds.GRID_COLUMNS_THRESHOLD,
        name: t("Width Threshold for Queue Columns (px)"),
        type: "number",
        defaultValue: 350
    });

    app.ui.settings.addSetting({
        id: SettingIds.SHOW_PENDING_COUNT_ONLY,
        name: t("If disabled, each queued job will have a separate individual card"),
        type: "boolean",
        defaultValue: true
    });

    app.ui.settings.addSetting({
        id: SettingIds.SHOW_WORKING_NODE_NAME,
        name: t("Shows the name of the node which is currently in the process"),
        type: "boolean",
        defaultValue: true
    });

    app.ui.settings.addSetting({
        id: SettingIds.AUTO_CLEAR_INTERRUPTED,
        name: t("Auto-clear cancelled & failed jobs on new generation"),
        type: "boolean",
        defaultValue: false
    });

    app.ui.settings.addSetting({
        id: "Comfy Sidebar.Permanent Delete on Disk Deletion",
        name: t("Permanently delete files on disk deletion (bypasses Recycle Bin / Trash)"),
        type: "boolean",
        defaultValue: false
    });

    const sidebarTabs = ["Assets", "Nodes", "Models", "Workflows", "Apps", "Templates"];
    sidebarTabs.forEach(tab => {
        app.ui.settings.addSetting({
            id: `Comfy Sidebar.Hide Junk.${tab}`,
            name: t("Hide Tab: {tab}", { tab: t(tab) }),
            type: "boolean",
            defaultValue: false,
            onChange: () => {
                setTimeout(() => { syncClassicLayout(); }, 0);
            }
        });
    });

    app.ui.settings.addSetting({
        id: SettingIds.OVERRIDE_STOCK_HISTORY,
        name: t("Replace the stock Job History sidebar with Comfy Queue"),
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
        name: t("Hide floating 'Graph' (Workflow/Node Map) button"),
        type: "boolean",
        defaultValue: false,
        onChange: () => {
            setTimeout(() => { syncClassicLayout(); }, 0);
        }
    });

    app.ui.settings.addSetting({
        id: "Comfy Sidebar.Hide Junk.Avatar",
        name: t("Hide Avatar"),
        type: "boolean",
        defaultValue: false,
        onChange: () => {
            setTimeout(() => { syncClassicLayout(); }, 0);
        }
    });

    app.ui.settings.addSetting({
        id: "Comfy Sidebar.Hide Junk.Floating Canvas Controls",
        name: t("Floating Canvas Controls"),
        type: "combo",
        options: ["Default", "Dock", "Hide"],
        defaultValue: "Default",
        onChange: () => {
            setTimeout(() => { syncClassicLayout(); }, 0);
        }
    });

    app.ui.settings.addSetting({
        id: SettingIds.CLASSIC_LAYOUT,
        name: t("Places the controls and the open workflow tabs on a single unified top bar"),
        type: "boolean",
        defaultValue: false,
        onChange: (value) => {
            if (isInitialized) {
                applyClassicLayout(value, true);
            }
        }
    });
}

function setupSettingsDialogObserver() {
    const targetTexts = [
        "Grid Columns Threshold",
        "Show Pending Count Only",
        "Show Working Node Name",
        "Auto Clear Interrupted",
        "Permanent Delete on Disk Deletion",
        "Hide Junk",
        "Override Stock History",
        "Hide Graph Button",
        "Hide Avatar",
        "Floating Canvas Controls",
        "Classic Layout",
        "Comfy Layout",
        "Default",
        "Dock",
        "Hide"
    ];

    const translateDOM = (rootEl) => {
        if (!rootEl) return;
        const walker = document.createTreeWalker(
            rootEl,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const text = node.nodeValue?.trim();
                    return targetTexts.includes(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        const nodesToTranslate = [];
        while (walker.nextNode()) {
            nodesToTranslate.push(walker.currentNode);
        }

        for (const textNode of nodesToTranslate) {
            const raw = textNode.nodeValue.trim();
            const translated = t(raw);
            if (translated && translated !== raw) {
                textNode.nodeValue = textNode.nodeValue.replace(raw, translated);
            }
        }
    };

    const observer = new MutationObserver(() => {
        // 1. Translate headers and selected value inside the Settings dialog
        const dialog = document.querySelector('.p-dialog, .comfy-settings-dialog, [role="dialog"]');
        if (dialog) {
            translateDOM(dialog);
        }

        // 2. Translate dropdown popup menu items (floated directly on document.body)
        const overlay = document.querySelector('.p-select-overlay, .p-dropdown-panel, .p-select-list, [data-pc-name="selectoverlay"]');
        if (overlay) {
            translateDOM(overlay);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
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

function setupWorkflowTabsPositionWatcher() {
    let isSyncing = false;
    const TARGET_SETTING = "Comfy.Workflow.WorkflowTabsPosition";

    const checkAndDisableIfSidebar = (val) => {
        if (isSyncing) return;
        if (val === "Sidebar") {
            const isClassicEnabled = app.ui?.settings?.getSettingValue(SettingIds.CLASSIC_LAYOUT) ?? false;
            if (isClassicEnabled) {
                isSyncing = true;
                try {
                    if (app.extensionManager?.setting) {
                        try { app.extensionManager.setting.set(SettingIds.CLASSIC_LAYOUT, false); } catch (e) {}
                    } else if (app.ui?.settings) {
                        try { app.ui.settings.setSettingValue(SettingIds.CLASSIC_LAYOUT, false); } catch (e) {}
                    }
                    applyClassicLayout(false, false);
                } finally {
                    isSyncing = false;
                }
            }
        }
    };

    const cleanups = [];

    // 1. Hook the setting's native onChange callback directly (instant execution on click)
    const attachNativeOnChange = (settingObj) => {
        if (!settingObj || settingObj._classicWatcherAttached) return;
        settingObj._classicWatcherAttached = true;
        const origOnChange = settingObj.onChange;
        settingObj.onChange = (val) => {
            if (origOnChange) origOnChange(val);
            checkAndDisableIfSidebar(val);
        };
        cleanups.push(() => {
            settingObj.onChange = origOnChange;
            delete settingObj._classicWatcherAttached;
        });
    };

    // Check existing registered setting in legacy UI and modern extension manager
    attachNativeOnChange(app.ui?.settings?.settings?.[TARGET_SETTING]);
    attachNativeOnChange(app.extensionManager?.setting?.getSetting?.(TARGET_SETTING));
    attachNativeOnChange(app.extensionManager?.setting?.settings?.[TARGET_SETTING]);

    // 2. Hook Vue/Pinia reactive store subscription if available (zero polling, synchronous)
    const settingStore = app.extensionManager?.setting?.settingStore;
    if (settingStore?.$subscribe) {
        const unsubscribe = settingStore.$subscribe(() => {
            const val = app.extensionManager?.setting?.get?.(TARGET_SETTING) ??
                        app.ui?.settings?.getSettingValue(TARGET_SETTING);
            checkAndDisableIfSidebar(val);
        });
        cleanups.push(unsubscribe);
    }

    // 3. Hook addSetting in case core registers/re-registers the setting later
    if (app.ui?.settings?.addSetting) {
        const origAdd = app.ui.settings.addSetting.bind(app.ui.settings);
        app.ui.settings.addSetting = (setting) => {
            if (setting?.id === TARGET_SETTING) {
                attachNativeOnChange(setting);
            }
            return origAdd(setting);
        };
        cleanups.push(() => {
            app.ui.settings.addSetting = origAdd;
        });
    }

    // 4. Hook API setters as fallback
    if (app.ui?.settings?.setSettingValue) {
        const origSetSettingValue = app.ui.settings.setSettingValue.bind(app.ui.settings);
        app.ui.settings.setSettingValue = (id, value) => {
            origSetSettingValue(id, value);
            if (id === TARGET_SETTING) checkAndDisableIfSidebar(value);
        };
        cleanups.push(() => {
            app.ui.settings.setSettingValue = origSetSettingValue;
        });
    }

    if (app.extensionManager?.setting?.set) {
        const origExtSet = app.extensionManager.setting.set.bind(app.extensionManager.setting);
        app.extensionManager.setting.set = (id, value) => {
            origExtSet(id, value);
            if (id === TARGET_SETTING) checkAndDisableIfSidebar(value);
        };
        cleanups.push(() => {
            app.extensionManager.setting.set = origExtSet;
        });
    }

    return () => {
        cleanups.forEach(fn => fn());
    };
}

app.registerExtension({
    name: "ComfySidebar.ClassicRestore",

    async init() {
        await initI18n();
        registerSettings();
    },

    commands: [
        {
            id: "ComfySidebar.ToggleSidebar",
            label: t("Toggle Comfy Queue Sidebar"),
            function: () => {
                const ourBtn = findOurSidebarButton();
                if (ourBtn) ourBtn.click();
            }
        },
        {
            id: "ComfySidebar.ToggleIgnoreNode",
            label: t("Toggle Ignore Selected Node(s) in Queue"),
            function: () => toggleIgnoreActiveNode(() => renderSidebar())
        },
        {
            id: "ComfySidebar.RenumberNodes",
            label: t("Renumber All Nodes (Execution Order)"),
            function: () => renumberNodesTopologically()
        },
        {
            id: "ComfySidebar.SetNodeId",
            label: t("Set Selected Node ID..."),
            function: () => setManualNodeId()
        }
    ],

    getNodeMenuItems(node) {
        return [
            null,
            {
                content: t("Set Node ID..."),
                callback: () => setManualNodeId(node)
            }
        ];
    },

    getCanvasMenuItems() {
        return [
            null,
            {
                content: t("Renumber All Nodes (Execution Order)"),
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
        await initI18n();

        const tabsPos = app.extensionManager?.setting?.get?.("Comfy.Workflow.WorkflowTabsPosition") ??
                        app.ui.settings.getSettingValue("Comfy.Workflow.WorkflowTabsPosition");
        let isClassicLayoutEnabled = app.ui.settings.getSettingValue(SettingIds.CLASSIC_LAYOUT) ?? false;

        // Startup safeguard: if workflows are set to Sidebar, disable Comfy Layout
        if (isClassicLayoutEnabled && tabsPos === "Sidebar") {
            isClassicLayoutEnabled = false;
            if (app.extensionManager?.setting) {
                try { app.extensionManager.setting.set(SettingIds.CLASSIC_LAYOUT, false); } catch (e) {}
            } else if (app.ui?.settings) {
                try { app.ui.settings.setSettingValue(SettingIds.CLASSIC_LAYOUT, false); } catch (e) {}
            }
        }

        applyClassicLayout(isClassicLayoutEnabled, false);

        const isHistoryOverrideEnabled = app.ui.settings.getSettingValue(SettingIds.OVERRIDE_STOCK_HISTORY) ?? false;
        if (isHistoryOverrideEnabled) {
            syncStockHistoryAndProgressSettings(true);
        }

        isInitialized = true;

        setupPropertiesPanelToggleFix();
        injectStyles();

        cleanupFns.push(setupWorkflowTabsPositionWatcher());
        cleanupFns.push(setupDragAndDrop());
        cleanupFns.push(setupVueNodeObserver());
        cleanupFns.push(setupSettingsDialogObserver());

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
            title: t("Queue"),
            tooltip: `${t("Queue")} (Q)`,
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
