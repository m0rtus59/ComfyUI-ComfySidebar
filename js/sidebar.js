// sidebar.js
import { app } from "/scripts/app.js";
import { injectStyles } from "./styles.js";
import { setupDragAndDrop } from "./dragdrop.js";
import { setupSidebarUI, applySidebarOverride, findOurSidebarButton, setSyncQueue, updateSidebarBadge, renderDOM } from "./ui.js";
import { setupApiListeners, initSessionAndHistory, syncQueue, setUIDependencies } from "./queue.js";
import { applyClassicLayout, setupPropertiesPanelToggleFix } from "./layout.js"; // Import properties panel fix

app.registerExtension({
    name: "ComfySidebar.ClassicRestore",
    
    init() {
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Grid Columns Threshold", name: "Width Threshold for Queue Columns (px)", type: "number", defaultValue: 350 });
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Keep Object Aspect Ratio", name: "If disabled, cards in the queue will be cropped to the same size.", type: "boolean", defaultValue: true });
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Show Pending Count Only", name: "If disabled, each queued job will have a separate individual card", type: "boolean", defaultValue: true });
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Show Working Node Name", name: "Shows the name of the node which is currently in the process", type: "boolean", defaultValue: true });
        
        // Settings toggle for Auto-clear Interrupted runs
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Auto Clear Interrupted", name: "Auto-clear cancelled & failed jobs on new generation", type: "boolean", defaultValue: false });

        // Add settings to hide individual sidebar tabs under a shared sub-category group
        const sidebarTabs = ["Assets", "Nodes", "Models", "Workflows", "Apps", "NodesMap", "Templates"];
        sidebarTabs.forEach(tab => {
            app.ui.settings.addSetting({
                id: `Comfy Sidebar.Hide Sidebar Tabs.${tab}`,
                name: `Hide Tab: ${tab}`,
                type: "boolean",
                defaultValue: false
            });
        });

        // Group the Stock History Tab override into the same sub-category group
        app.ui.settings.addSetting({ 
            id: "Comfy Sidebar.Hide Sidebar Tabs.Override Stock Job History Tab", 
            name: "Replaces the stock Job History sidebar with Comfy Queue", 
            type: "boolean", 
            defaultValue: false 
        });

        // Add the toggle setting for Classic / Comfy Layout
        app.ui.settings.addSetting({
            id: "Comfy Sidebar.Comfy Layout",
            name: "Places the controls and the open workflow tabs on a single unified top bar",
            type: "boolean",
            defaultValue: false,
            onChange: (value) => {
                applyClassicLayout(value);
            }
        });
    },

    async setup() {
        if (!app.extensionManager || !app.extensionManager.registerSidebarTab) return;

        // Apply saved layout configuration on startup
        const isClassicLayoutEnabled = app.ui.settings.getSettingValue("Comfy Sidebar.Comfy Layout") ?? false;
        applyClassicLayout(isClassicLayoutEnabled);

        // Run properties panel toggle correction
        setupPropertiesPanelToggleFix();

        // Safely resolve circular dependencies using Dependency Injection Hooks
        setSyncQueue(syncQueue);
        setUIDependencies(renderDOM, updateSidebarBadge);

        // 1. Initialize DOM Independent Services
        injectStyles();
        setupDragAndDrop();

        // 2. Initialize UI Hierarchy
        const sidebarContainer = setupSidebarUI();
        
        // 3. Connect API Hooks
        setupApiListeners();
        
        // 4. Connect Storage and History Sync
        await initSessionAndHistory();

        // 5. Connect UI Keyboard & Override Hacks
        document.addEventListener("keydown", (e) => {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable || activeEl.tagName === "SELECT")) return;
            if (e.key.toLowerCase() === "q") {
                e.preventDefault(); e.stopPropagation();
                const ourBtn = findOurSidebarButton();
                if (ourBtn) ourBtn.click();
            }
        }, true);
        
        setInterval(() => applySidebarOverride(), 500);

        // 6. Final Registration
        app.extensionManager.registerSidebarTab({ 
            id: "classic-comfy-sidebar", 
            icon: "pi pi-images", 
            title: "Queue", 
            tooltip: "Comfy Queue (Q)", 
            type: "custom", 
            render: (el) => { el.appendChild(sidebarContainer); } 
        });
    }
});