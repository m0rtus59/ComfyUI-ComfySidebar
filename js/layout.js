// layout.js - Variant 1 (Media Queries) with Properties Panel Toggle Fix, Indicator Filter & Sidebar Visibility
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

/* --- Properties Panel Toggle Inline Correction --- */

let savedButtonData = null;

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
        const shouldHide = app.ui?.settings?.getSettingValue(`Comfy Sidebar.Hide Sidebar Tabs.${tab}`) ?? false;
        
        // Find the specific icon element inside the sidebar
        const icon = sidebar.querySelector(selector);
        if (icon) {
            // Find its closest parent button or tab item wrapper
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

    // 4. Handle "Override Stock Job History Tab" using its exact icon selector
    const hideStockHistory = app.ui?.settings?.getSettingValue("Comfy Sidebar.Hide Sidebar Tabs.Override Stock Job History Tab") ?? false;
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

export function setupPropertiesPanelToggleFix() {
    const style = document.createElement("style");
    style.textContent = `
        /* Hide native button completely */
        .comfy-sidebar-hide-original-properties-btn {
            display: none !important;
        }

        /* Spacing when the properties panel is CLOSED */
        .comfy-sidebar-custom-properties-toggle {
            margin-left: -8px !important;
            margin-right: 0px !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 0 !important; /* Forces perfect centering of the icon */
        }

        /* Spacing when the properties panel is OPEN */
        .comfy-sidebar-custom-properties-toggle.comfy-panel-open {
            margin-left: 0px !important;
            margin-right: 0px !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 0 !important; /* Forces perfect centering of the icon */
        }
    `;
    document.head.appendChild(style);

    function frameLoop() {
        const isClassicLayoutEnabled = app.ui?.settings?.getSettingValue("Comfy Sidebar.Classic Layout") ?? false;

        // If Classic Layout is disabled, cleanly restore stock elements and exit early
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

            requestAnimationFrame(frameLoop);
            return;
        }

        // --- Active Classic Layout Toggle Correction ---
        const originalBtn = findOriginalButton();
        const container = findTopbarContainer();
        const openState = isPropertiesPanelOpen();

        // 1. Capture original template data when native button is alive
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

        // 2. Build and insert our custom button inside topbar
        if (!customBtn && savedButtonData && container) {
            customBtn = document.createElement(savedButtonData.tagName);
            
            customBtn.className = savedButtonData.className + " comfy-sidebar-custom-properties-toggle";
            customBtn.innerHTML = savedButtonData.innerHTML;

            for (const attr of savedButtonData.attributes) {
                if (attr.name !== "class" && attr.name !== "id" && attr.name !== "style") {
                    customBtn.setAttribute(attr.name, attr.value);
                }
            }

            // Standard inline rendering
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

        // 3. Keep the state-specific CSS classes synchronized
        if (customBtn) {
            if (openState) {
                if (!customBtn.classList.contains("comfy-panel-open")) {
                    customBtn.classList.add("comfy-panel-open");
                }
            } else {
                if (customBtn.classList.contains("comfy-panel-open")) {
                    customBtn.classList.remove("comfy-panel-open");
                }
            }
            customBtn.style.display = "inline-flex";
        }

        // 4. Handle "0 active" indicator visibility based on user settings (Sub-grouped Path)
        const hideQueueIndicator = app.ui?.settings?.getSettingValue("Comfy Sidebar.Hide Sidebar Tabs.Override Stock Job History Tab") ?? false;
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

        // 5. Update Sidebar tab elements visibility
        updateSidebarTabsVisibility();

        // Run checking loop continuously synced with screen refresh cycles
        requestAnimationFrame(frameLoop);
    }

    // Start loop synced with the screen rendering rate
    requestAnimationFrame(frameLoop);
}