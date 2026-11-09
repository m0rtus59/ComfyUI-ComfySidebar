import { app } from "/scripts/app.js";
import { SettingIds } from "./core/constants.js";
import { injectStyles } from "./utils/styles.js";
import { setupDragAndDrop } from "./utils/dragdrop.js";
import { setupLatinHotkeys } from "./utils/latinHotkeys.js";
import { renumberNodesTopologically, setManualNodeId } from "./utils/nodeRenumber.js";
import { applySidebarOverride } from "./comfy/adapter.js";
import { syncAllNodeBadges, setupVueNodeObserver, toggleIgnoreActiveNode } from "./comfy/nodes.js";
import { applyClassicLayout, setupPropertiesPanelToggleFix, syncClassicLayout, syncStockHistoryAndProgressSettings, destroyLayoutFix } from "./comfy/layout.js";
import { initSessionAndHistory, syncQueue } from "./queue/queueService.js";
import { setupExecutionTracker } from "./queue/executionTracker.js";
import { setupSidebarView, renderSidebar, teardownSidebarView } from "./ui/sidebarView.js";
import { setupGalleryView, teardownGalleryView } from "./ui/galleryView.js";
import { initI18n, t } from "./core/i18n.js";
import { updateCardProgressTargeted, cardPool } from "./ui/cardRenderer.js";
import { getScrollContainer } from "./utils/utils.js";
import { store } from "./core/store.js";
import { getSetting, setSetting } from "./core/settings.js";

let isInitialized = false;
let activeKeydownHandler = null;
let cleanupFns = [];

function setupKeydownShortcuts() {
    activeKeydownHandler = (e) => {
        const activeEl = document.activeElement;
        if (activeEl && (
            activeEl.tagName === "INPUT" ||
            activeEl.tagName === "TEXTAREA" ||
            activeEl.isContentEditable ||
            activeEl.tagName === "SELECT"
        )) return;

        // Ctrl+Q / Cmd+Q: Toggle Ignore Selected Node
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

    const setGalleryButtonVisible = (visible) => {
        try {
            const buttons = document.querySelectorAll(".side-bar-button, [data-tab-id]");
            for (const btn of buttons) {
                if (btn.getAttribute("data-tab-id") === "classic-comfy-gallery" ||
                    btn.getAttribute("title")?.includes("Gallery") ||
                    btn.querySelector(".pi-folder")) {
                    btn.style.display = visible ? "" : "none";
                    break;
                }
            }
        } catch (e) {
            console.warn("[ComfySidebar] Error toggling gallery tab button:", e);
        }
    };

    app.ui.settings.addSetting({
        id: "Comfy Sidebar.Enable Gallery",
        name: t("Enable Output Gallery Sidebar"),
        type: "boolean",
        defaultValue: true,
        onChange: (val) => {
            setGalleryButtonVisible(val ?? true);
        }
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
            applySidebarOverride();
            setTimeout(() => {
                applySidebarOverride();
                syncClassicLayout();
            }, 50);
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
        id: SettingIds.LATIN_HOTKEYS,
        name: t("Fix non-ASCII keybinds (hotkeys on any keyboard layout)"),
        tooltip: t("Treats non-Latin letters (e.g. Cyrillic) as the Latin key in the same physical position, so hotkeys like Q or Ctrl+Z work while another layout is active. Typing in text fields is not affected."),
        type: "boolean",
        defaultValue: true
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

function setupWorkflowTabsPositionWatcher() {
    let isSyncing = false;
    const TARGET_SETTING = "Comfy.Workflow.WorkflowTabsPosition";

    const checkAndDisableIfSidebar = (val) => {
        if (isSyncing) return;
        if (val === "Sidebar") {
            const isClassicEnabled = getSetting(SettingIds.CLASSIC_LAYOUT, false);
            if (isClassicEnabled) {
                isSyncing = true;
                try {
                    setSetting(SettingIds.CLASSIC_LAYOUT, false);
                    applyClassicLayout(false, false);
                } finally {
                    isSyncing = false;
                }
            }
        }
    };

    const cleanups = [];

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

    attachNativeOnChange(app.ui?.settings?.settings?.[TARGET_SETTING]);
    attachNativeOnChange(app.extensionManager?.setting?.getSetting?.(TARGET_SETTING));
    attachNativeOnChange(app.extensionManager?.setting?.settings?.[TARGET_SETTING]);

    const settingStore = app.extensionManager?.setting?.settingStore;
    if (settingStore?.$subscribe) {
        const unsubscribe = settingStore.$subscribe(() => {
            const val = getSetting(TARGET_SETTING);
            checkAndDisableIfSidebar(val);
        });
        cleanups.push(unsubscribe);
    }

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

    // Plain Q toggles the Queue tab through the frontend keybinding system (rebindable in Settings > Keybinding).
    keybindings: [
        {
            combo: { key: "q" },
            commandId: "Workspace.ToggleSidebarTab.classic-comfy-sidebar"
        }
    ],

    commands: [
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

        const tabsPos = getSetting("Comfy.Workflow.WorkflowTabsPosition");
        let isClassicLayoutEnabled = getSetting(SettingIds.CLASSIC_LAYOUT, false);

        if (isClassicLayoutEnabled && tabsPos === "Sidebar") {
            isClassicLayoutEnabled = false;
            setSetting(SettingIds.CLASSIC_LAYOUT, false);
        }

        applyClassicLayout(isClassicLayoutEnabled, false);

        const isHistoryOverrideEnabled = getSetting(SettingIds.OVERRIDE_STOCK_HISTORY, false);
        if (isHistoryOverrideEnabled) {
            syncStockHistoryAndProgressSettings(true);
        }

        isInitialized = true;

        setupPropertiesPanelToggleFix();
        injectStyles();

        cleanupFns.push(setupWorkflowTabsPositionWatcher());
        cleanupFns.push(setupDragAndDrop());
        cleanupFns.push(setupLatinHotkeys());
        cleanupFns.push(setupVueNodeObserver());

        cleanupFns.push(setupExecutionTracker((pid, progress, nodeName) => {
            const cardObj = cardPool.get(pid);
            const state = store.getPrompt(pid);
            if (cardObj && state) {
                const showWorkingNode = getSetting(SettingIds.SHOW_WORKING_NODE_NAME, true);
                updateCardProgressTargeted(cardObj, progress, nodeName, showWorkingNode, state);
            } else {
                renderSidebar();
            }
        }));

        const sidebarContainer = setupSidebarView();

        await initSessionAndHistory();
        setupKeydownShortcuts();

        syncAllNodeBadges();

        let queueScrollPos = 0;
        let galleryScrollPos = 0;
        let activeSidebarTab = "queue";

        app.extensionManager.registerSidebarTab({
            id: "classic-comfy-sidebar",
            icon: "pi pi-images",
            title: t("Queue"),
            tooltip: `${t("Queue")} (Q)`,
            type: "custom",
            render: (el) => {
                document.querySelectorAll(".comfy-sidebar-scroll-top-btn").forEach(btn => { btn.style.display = "none"; });
                const scrollParent = getScrollContainer(el);
                if (activeSidebarTab === "gallery" && scrollParent) {
                    galleryScrollPos = scrollParent.scrollTop;
                }
                activeSidebarTab = "queue";
                el.replaceChildren(sidebarContainer);
                requestAnimationFrame(() => {
                    const sp = getScrollContainer(el);
                    if (sp) sp.scrollTop = queueScrollPos;
                });
            }
        });

        const galleryContainer = setupGalleryView();
        app.extensionManager.registerSidebarTab({
            id: "classic-comfy-gallery",
            icon: "pi pi-folder",
            title: t("Gallery"),
            tooltip: t("Gallery (Outputs)"),
            type: "custom",
            render: (el) => {
                document.querySelectorAll(".comfy-sidebar-scroll-top-btn").forEach(btn => { btn.style.display = "none"; });
                const scrollParent = getScrollContainer(el);
                if (activeSidebarTab === "queue" && scrollParent) {
                    queueScrollPos = scrollParent.scrollTop;
                }
                activeSidebarTab = "gallery";
                el.replaceChildren(galleryContainer);
                requestAnimationFrame(() => {
                    const sp = getScrollContainer(el);
                    if (sp) sp.scrollTop = galleryScrollPos;
                });
            }
        });

        const isGalleryEnabled = getSetting("Comfy Sidebar.Enable Gallery", true);
        if (!isGalleryEnabled) {
            setTimeout(() => setGalleryButtonVisible(false), 50);
        }

        requestAnimationFrame(() => {
            applySidebarOverride();
        });
    },

    destroy() {
        for (const fn of cleanupFns.splice(0)) {
            try { if (typeof fn === "function") fn(); } catch (e) {}
        }
        destroyLayoutFix();
        teardownSidebarView();
        teardownGalleryView();

        if (app.extensionManager?.unregisterSidebarTab) {
            app.extensionManager.unregisterSidebarTab("classic-comfy-gallery");
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