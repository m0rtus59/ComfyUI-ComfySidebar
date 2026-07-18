// layout.js - Fully Fixed & Renamed to 'Hide Junk'
import { app } from "/scripts/app.js";

const STYLE_ID = "comfy-sidebar-classic-layout-override";

const CLASSIC_LAYOUT_CSS_MEDIA = `
/* Style and align the custom plugins bar (Manager, LoRA, etc.) */
[class*="actionbar"]:not(.actionbar),
[class*="actionbar-buttons"],
.actionbar-buttons {
    position: fixed !important;
    top: -5px !important; 
    right: 4px !important; 
    left: auto !important;
    transform: none !important;
    z-index: 1010 !important;

    /* Nuke the background rectangle, border, and shadows */
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    margin: 0 !important;
    display: flex !important;
    align-items: center !important;
}

/* Base rules: Large/Wide desktop screens (>= 1600px width) */
.p-tabview-nav-content,
[class*="tabview"] {
    padding-left: 150px !important;
    padding-right: 580px !important; 
}

/* Medium desktop screens (between 1200px and 1599px width) */
@media (max-width: 1599px) {
    .p-tabview-nav-content,
    [class*="tabview"] {
        padding-left: 100px !important;
        padding-right: 420px !important; 
    }
}

/* Standard laptops / small monitors (between 900px and 1199px width) */
@media (max-width: 1199px) {
    .p-tabview-nav-content,
    [class*="tabview"] {
        padding-left: 40px !important;
        padding-right: 280px !important; 
    }
}

/* Very narrow or heavily zoomed displays (< 900px width) */
@media (max-width: 899px) {
    .p-tabview-nav-content,
    [class*="tabview"] {
        padding-left: 10px !important;
        padding-right: 180px !important; 
    }
}
`;

export function applyClassicLayout(enable) {
    let styleEl = document.getElementById(STYLE_ID);
    
    if (enable) {
        if (app.ui && app.ui.settings) {
            app.ui.settings.setSettingValue("Comfy.Workflow.WorkflowTabsPosition", "Topbar");
        }

        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = STYLE_ID;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = CLASSIC_LAYOUT_CSS_MEDIA;

    } else {
        if (styleEl) styleEl.remove();
        
        if (app.ui && app.ui.settings) {
            app.ui.settings.setSettingValue("Comfy.Workflow.WorkflowTabsPosition", "Sidebar");
        }
    }
}

/* --- Properties Panel Toggle Corrections --- */

let savedButtonData = null;
let domObserver = null;

function findOriginalButton() {
    const icon = document.querySelector('[class*="lucide--panel-right"], [class*="lucide--panel-left"]');
    if (icon) {
        const btn = icon.closest('button, [role="button"], .comfyui-menu-item, .p-button');
        if (btn && !btn.classList.contains("comfy-sidebar-custom-properties-toggle")) {
            return btn;
        }
    }
    return null;
}

function findTopbarContainer() {
    const container = document.querySelector('[class*="actionbar-buttons"], .actionbar-buttons, [class*="actionbar"]');
    if (container) return container;
    
    const orig = findOriginalButton();
    if (orig && orig.parentNode) return orig.parentNode;
    
    const buttons = document.querySelectorAll("button, .p-button");
    for (const btn of buttons) {
        if (btn.classList.contains("comfy-sidebar-custom-properties-toggle")) continue;
        const title = (btn.getAttribute("title") || btn.getAttribute("aria-label") || "").toLowerCase();
        if (title.includes("run") || title.includes("queue") || title.includes("manager")) {
            if (btn.parentNode) return btn.parentNode;
        }
    }
    return null;
}

function isPropertiesPanelOpen() {
    const icon = document.querySelector('[class*="lucide--panel-right"], [class*="lucide--panel-left"]');
    return !!(icon && icon.className.includes("lucide--panel-left"));
}

function findActiveQueueIndicator() {
    const container = findTopbarContainer();
    if (!container) return null;
    
    const buttons = container.querySelectorAll("button, .p-button, .comfyui-menu-item");
    for (const btn of buttons) {
        if (btn.classList.contains("comfy-sidebar-custom-properties-toggle")) continue;
        
        const text = (btn.textContent || "").toLowerCase();
        if (text.includes("active") || text.includes("queued") || text.includes("running") || text.includes("pending")) {
            return btn;
        }
    }
    return null;
}

function updateSidebarTabsVisibility() {
    const sidebar = document.querySelector('.comfyui-sidebar, .comfy-sidebar, .sidebar, [class*="sidebar-nav"], [class*="sidebar"]');
    if (!sidebar) return;

    // Direct mapping from tab settings to their unique class-based HTML icon tags
    const tabIconSelectors = {
        "Assets": '[class*="comfy--image-ai-edit"]',
        "Nodes": '[class*="comfy--node"]',
        "Models": '[class*="comfy--ai-model"]',
        "Workflows": '[class*="comfy--workflow"]',
        "Apps": '[class*="lucide--panels-top-left"]',
        "NodesMap": '[class*="pi-sitemap"]',
        "Templates": '[class*="comfy--template"]'
    };

    Object.entries(tabIconSelectors).forEach(([tab, selector]) => {
        // Read from renamed "Hide Junk" path
        const shouldHide = app.ui?.settings?.getSettingValue(`Comfy Sidebar.Hide Junk.${tab}`) ?? false;
        
        const icon = sidebar.querySelector(selector);
        if (icon) {
            const tabBtn = icon.closest('.comfyui-sidebar-tab, button, [role="tab"], li, a, .comfyui-sidebar-item') || icon;
            
            if (shouldHide) {
                if (tabBtn.style.display !== "none") {
                    tabBtn.style.setProperty("display", "none", "important");
                }
            } else {
                if (tabBtn.style.display === "none") {
                    tabBtn.style.removeProperty("display");
                }
            }
        }
    });

    // Handle "Override Stock Job History Tab" using its renamed setting path
    const hideStockHistory = app.ui?.settings?.getSettingValue("Comfy Sidebar.Hide Junk.Override Stock Job History Tab") ?? false;
    const historyIcon = sidebar.querySelector('[class*="lucide--history"]');
    if (historyIcon) {
        const historyBtn = historyIcon.closest('.comfyui-sidebar-tab, button, [role="tab"], li, a, .comfyui-sidebar-item') || historyIcon;
        if (hideStockHistory) {
            if (historyBtn.style.display !== "none") {
                historyBtn.style.setProperty("display", "none", "important");
            }
        } else {
            if (historyBtn.style.display === "none") {
                historyBtn.style.removeProperty("display");
            }
        }
    }
}

function findGraphButton() {
    // 1. Target elements with Tailwind classes, but IGNORE those inside modal settings/sidebars
    const elements = document.querySelectorAll('.bg-secondary-background.rounded-lg.items-center.inline-flex.pointer-events-auto');
    for (const el of elements) {
        // Filter out dialogs, sidebar overlays, settings drawers, and modals
        if (el.closest('.p-dialog, .comfy-modal, [role="dialog"], .p-sidebar, .comfy-settings')) {
            continue;
        }
        return el;
    }

    // 2. Same fallback logic, excluding modals
    const fallbacks = document.querySelectorAll('button, .bg-secondary-background');
    for (const el of fallbacks) {
        if (el.closest('.p-dialog, .comfy-modal, [role="dialog"], .p-sidebar, .comfy-settings')) {
            continue;
        }
        const text = (el.textContent || el.getAttribute("title") || "").toLowerCase();
        if (text.includes("graph") || text.includes("workflow") || el.querySelector('[class*="sitemap"], [class*="workflow"]')) {
            return el;
        }
    }
    return null;
}

export function syncClassicLayout() {
    const isClassicLayoutEnabled = app.ui?.settings?.getSettingValue("Comfy Sidebar.Comfy Layout") ?? false;

    // 1. Handle "Hide Graph Button" Toggle under the renamed "Hide Junk" path
    const hideGraphBtn = app.ui?.settings?.getSettingValue("Comfy Sidebar.Hide Junk.Graph Button") ?? false;
    const graphBtn = findGraphButton();
    if (graphBtn) {
        if (hideGraphBtn) {
            if (graphBtn.style.display !== "none") {
                graphBtn.style.setProperty("display", "none", "important");
            }
        } else {
            if (graphBtn.style.display === "none") {
                graphBtn.style.removeProperty("display");
            }
        }
    }

    // 2. Exit early and clean up overrides if Classic Topbar layout is off
    if (!isClassicLayoutEnabled) {
        const originalBtn = findOriginalButton();
        if (originalBtn && originalBtn.classList.contains("comfy-sidebar-hide-original-properties-btn")) {
            originalBtn.classList.remove("comfy-sidebar-hide-original-properties-btn");
        }

        const customBtn = document.querySelector(".comfy-sidebar-custom-properties-toggle");
        if (customBtn) {
            customBtn.remove();
        }

        const indicator = findActiveQueueIndicator();
        if (indicator && indicator.style.display === "none") {
            indicator.style.removeProperty("display");
        }

        updateSidebarTabsVisibility();
        return;
    }

    // 3. Handle Active Layout elements synchronization
    const originalBtn = findOriginalButton();
    const container = findTopbarContainer();
    const openState = isPropertiesPanelOpen();

    if (originalBtn) {
        if (!originalBtn.classList.contains("comfy-sidebar-hide-original-properties-btn")) {
            originalBtn.classList.add("comfy-sidebar-hide-original-properties-btn");
        }

        savedButtonData = {
            className: originalBtn.className.replace("comfy-sidebar-hide-original-properties-btn", "").trim(),
            innerHTML: originalBtn.innerHTML,
            tagName: originalBtn.tagName,
            attributes: Array.from(originalBtn.attributes).map(attr => ({
                name: attr.name,
                value: attr.value
            }))
        };
    }

    let customBtn = document.querySelector(".comfy-sidebar-custom-properties-toggle");

    if (!customBtn && savedButtonData && container) {
        customBtn = document.createElement(savedButtonData.tagName);
        
        customBtn.className = savedButtonData.className + " comfy-sidebar-custom-properties-toggle";
        customBtn.innerHTML = savedButtonData.innerHTML;

        for (const attr of savedButtonData.attributes) {
            if (attr.name !== "class" && attr.name !== "id" && attr.name !== "style") {
                customBtn.setAttribute(attr.name, attr.value);
            }
        }

        Object.assign(customBtn.style, {
            position: "relative",
            zIndex: "1000", 
            margin: "0",
            boxSizing: "border-box",
            opacity: "1",
            pointerEvents: "auto",
            display: "inline-flex"
        });

        customBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const nativeBtn = findOriginalButton();
            if (nativeBtn) nativeBtn.click();
        });

        container.appendChild(customBtn);
    } else if (customBtn && container && container.lastChild !== customBtn) {
        container.appendChild(customBtn);
    }

    if (customBtn) {
        customBtn.classList.toggle("comfy-panel-open", openState);
        customBtn.style.display = "inline-flex";
    }

    // 4. Handle "0 active" indicator visibility based on history tab settings
    const hideQueueIndicator = app.ui?.settings?.getSettingValue("Comfy Sidebar.Hide Junk.Override Stock Job History Tab") ?? false;
    const indicator = findActiveQueueIndicator();
    if (indicator) {
        if (hideQueueIndicator) {
            if (indicator.style.display !== "none") {
                indicator.style.setProperty("display", "none", "important");
            }
        } else {
            if (indicator.style.display === "none") {
                indicator.style.removeProperty("display");
            }
        }
    }

    updateSidebarTabsVisibility();
}

export function setupPropertiesPanelToggleFix() {
    if (!document.getElementById("comfy-sidebar-layout-fix-styles")) {
        const style = document.createElement("style");
        style.id = "comfy-sidebar-layout-fix-styles";
        style.textContent = `
            .comfy-sidebar-hide-original-properties-btn {
                display: none !important;
            }
            .comfy-sidebar-custom-properties-toggle {
                margin-left: -8px !important;
                margin-right: 0px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 0 !important;
            }
            .comfy-sidebar-custom-properties-toggle.comfy-panel-open {
                margin-left: 0px !important;
                margin-right: 0px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 0 !important;
            }
        `;
        document.head.appendChild(style);
    }

    if (domObserver) {
        domObserver.disconnect();
    }

    syncClassicLayout();

    domObserver = new MutationObserver((mutations) => {
        let shouldSync = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
                shouldSync = true;
                break;
            }
        }
        if (shouldSync) {
            syncClassicLayout();
        }
    });

    domObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}