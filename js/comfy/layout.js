import { app } from "/scripts/app.js";
import {
    findOriginalPropertiesButton,
    findTopbarContainer,
    isPropertiesPanelOpen,
    findActiveQueueIndicator,
    findNativeExtensionsPanel,
    findGraphButton,
    findPropertiesPanel
} from "./adapter.js";
import { isRuntimePreviewEnabled, setRuntimePreviewEnabled, setRuntimePreviewStateListener } from "../utils/comparison.js";

// Listen for runtime preview state changes to keep button UI in sync
setRuntimePreviewStateListener(() => {
    syncRuntimePreviewButton();
});

const STYLE_ID = "comfy-sidebar-classic-layout-override";

const CLASSIC_LAYOUT_CSS_MEDIA = `
.actionbar-container,
.shadow-interface.rounded-lg.bg-comfy-menu-bg,
.shadow-interface.rounded-lg.border-interface-stroke,
.shadow-interface.border.rounded-lg:has([class*="actionbar-buttons"]),
.shadow-interface.border.rounded-lg:has(.actionbar-buttons),
div.border-interface-stroke.rounded-lg:has([class*="actionbar-buttons"]) {
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
}

[class*="actionbar"]:not(.actionbar),
[class*="actionbar-buttons"],
.actionbar-buttons {
    position: fixed !important;
    top: 3px !important; 
    right: 4px !important; 
    left: auto !important;
    transform: none !important;
    z-index: 1010 !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    margin: 0 !important;
    display: flex !important;
    align-items: center !important;
}

.comfy-sidebar-extensions-override {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    margin: 0 8px 0 0 !important;
    height: auto !important;
    position: static !important;
    order: -10 !important;
    display: inline-flex !important;
    align-items: center !important;
}

#crysmonitor-monitors-root,
#crystools-monitors-root,
.crysmonitor-monitors-container {
    zoom: 0.8 !important;
    display: inline-flex !important;
    align-items: center !important;
}

img[alt*="User Avatar"],
img[alt*="user avatar"],
button:has(img[alt*="User Avatar"]),
[role="button"]:has(img[alt*="User Avatar"]),
button:has(img[alt*="user avatar"]),
[role="button"]:has(img[alt*="user avatar"]),
.p-avatar,
[data-pc-name="avatar"],
button:has(.p-avatar),
[role="button"]:has(.p-avatar),
button:has([data-pc-name="avatar"]),
[role="button"]:has([data-pc-name="avatar"]) {
    display: none !important;
}

.p-tabview-nav-content,
[class*="tabview"] {
    padding-left: 150px !important;
    padding-right: 580px !important; 
}

@media (max-width: 1599px) {
    .p-tabview-nav-content,
    [class*="tabview"] {
        padding-left: 100px !important;
        padding-right: 420px !important; 
    }
}

@media (max-width: 1199px) {
    .p-tabview-nav-content,
    [class*="tabview"] {
        padding-left: 40px !important;
        padding-right: 280px !important; 
    }
}

@media (max-width: 899px) {
    .p-tabview-nav-content,
    [class*="tabview"] {
        padding-left: 10px !important;
        padding-right: 180px !important; 
    }
}
`;

export function syncStockHistoryAndProgressSettings(enable) {
    const dockedVal = !!enable;
    const progressVal = !enable;
    const QPOV2_ID = "Comfy.Queue.QPOV2";
    const progressKey = "Comfy.Queue.ShowRunProgressBar";

    if (app.extensionManager?.setting) {
        try { app.extensionManager.setting.set(QPOV2_ID, dockedVal); } catch (e) {}
        try { app.extensionManager.setting.set(progressKey, progressVal); } catch (e) {}
    } else if (app.ui?.settings) {
        try { app.ui.settings.setSettingValue(QPOV2_ID, dockedVal); } catch (e) {}
        try { app.ui.settings.setSettingValue(progressKey, progressVal); } catch (e) {}
    }

    try { localStorage.setItem(QPOV2_ID, JSON.stringify(dockedVal)); } catch (e) {}
    try { localStorage.setItem(progressKey, JSON.stringify(progressVal)); } catch (e) {}
    try { window.dispatchEvent(new Event("storage")); } catch (e) {}
}

export function applyClassicLayout(enable, updateSetting = false) {
    let styleEl = document.getElementById(STYLE_ID);
    
    if (enable) {
        if (updateSetting) {
            if (app.extensionManager?.setting) {
                app.extensionManager.setting.set("Comfy.Workflow.WorkflowTabsPosition", "Topbar");
            } else if (app.ui?.settings) {
                app.ui.settings.setSettingValue("Comfy.Workflow.WorkflowTabsPosition", "Topbar");
            }
        }
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = STYLE_ID;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = CLASSIC_LAYOUT_CSS_MEDIA;
    } else {
        if (styleEl) styleEl.remove();
        if (updateSetting) {
            if (app.extensionManager?.setting) {
                app.extensionManager.setting.set("Comfy.Workflow.WorkflowTabsPosition", "Sidebar");
            } else if (app.ui?.settings) {
                app.ui.settings.setSettingValue("Comfy.Workflow.WorkflowTabsPosition", "Sidebar");
            }
        }
    }
}

let savedButtonData = null;
let domObserver = null;
let syncScheduled = false;

function updateSidebarTabsVisibility() {
    const sidebar = document.querySelector('.comfyui-sidebar, .comfy-sidebar, .sidebar, [class*="sidebar-nav"], [class*="sidebar"]');
    if (!sidebar) return;

    const tabSelectors = {
        "Assets": '[data-testid="assets-tab-button"], [class*="comfy--image-ai-edit"]',
        "Nodes": '[data-testid="node-library-tab-button"], [class*="comfy--node"]',
        "Models": '[data-testid="model-library-tab-button"], [class*="comfy--ai-model"]',
        "Workflows": '[data-testid="workflows-tab-button"], [class*="comfy--workflow"], [class*="workflow"]',
        "Apps": '[data-testid="apps-tab-button"], [class*="lucide--panels-top-left"]',
        "Templates": '[data-testid="templates-tab-button"], [class*="comfy--template"]'
    };

    Object.entries(tabSelectors).forEach(([tab, selector]) => {
        const shouldHide = app.ui?.settings?.getSettingValue(`Comfy Sidebar.Hide Junk.${tab}`) ?? false;
        const target = sidebar.querySelector(selector);
        if (target) {
            const tabBtn = target.closest('.comfyui-sidebar-tab, button, [role="tab"], li, a, .comfyui-sidebar-item') || target;
            if (shouldHide) {
                if (tabBtn.style.display !== "none") tabBtn.style.setProperty("display", "none", "important");
            } else {
                if (tabBtn.style.display === "none") tabBtn.style.removeProperty("display");
            }
        }
    });

    const hideStockHistory = app.ui?.settings?.getSettingValue("Comfy Sidebar.Hide Junk.Override Stock Job History Tab") ?? false;
    const historyTarget = sidebar.querySelector('[data-testid="queue-tab-button"], [data-testid="job-history-tab-button"], [class*="lucide--history"]');
    if (historyTarget) {
        const historyBtn = historyTarget.closest('.comfyui-sidebar-tab, button, [role="tab"], li, a, .comfyui-sidebar-item') || historyTarget;
        if (hideStockHistory) {
            if (historyBtn.style.display !== "none") historyBtn.style.setProperty("display", "none", "important");
        } else {
            if (historyBtn.style.display === "none") historyBtn.style.removeProperty("display");
        }
    }
}

function syncErrorBadge(originalBtn, customBtn) {
    if (!customBtn) return;

    const stockDot = document.querySelector('.comfy-sidebar-hide-original-properties-btn ~ span, .comfy-sidebar-hide-original-properties-btn + span');
    let customDot = customBtn.querySelector('.comfy-sidebar-error-dot');

    if (stockDot) {
        if (!customDot) {
            customDot = document.createElement("span");
            customDot.className = "comfy-sidebar-error-dot inline-flex items-center justify-center rounded-full bg-destructive-background text-white size-2 absolute -top-1 -right-1";
            customBtn.appendChild(customDot);
        }
    } else if (customDot) {
        customDot.remove();
    }
}

function cleanHTML(html) {
    if (!html) return "";
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;
    const tempDot = tempDiv.querySelector('[class*="destructive"]');
    if (tempDot) tempDot.remove();
    return tempDiv.innerHTML;
}

function syncGraphButton() {
    const hideGraphBtn = app.ui?.settings?.getSettingValue("Comfy Sidebar.Hide Junk.Graph Button") ?? false;
    const graphBtn = findGraphButton();
    if (graphBtn) {
        if (hideGraphBtn) {
            if (graphBtn.style.display !== "none") graphBtn.style.setProperty("display", "none", "important");
        } else {
            if (graphBtn.style.display === "none") graphBtn.style.removeProperty("display");
        }
    }
}

function syncExtensionsPanel(isClassicLayoutEnabled) {
    const extensionsPanel = findNativeExtensionsPanel();
    if (!extensionsPanel) return;

    if (isClassicLayoutEnabled) {
        const container = findTopbarContainer();
        if (container && extensionsPanel.parentNode !== container) {
            if (!extensionsPanel._originalParent) {
                extensionsPanel._originalParent = extensionsPanel.parentNode;
                extensionsPanel._originalNextSibling = extensionsPanel.nextSibling;
            }
            container.appendChild(extensionsPanel);
            extensionsPanel.classList.add("comfy-sidebar-extensions-override");
        }
    } else if (extensionsPanel._originalParent && extensionsPanel.parentNode !== extensionsPanel._originalParent) {
        extensionsPanel._originalParent.insertBefore(extensionsPanel, extensionsPanel._originalNextSibling || null);
        extensionsPanel.classList.remove("comfy-sidebar-extensions-override");
    }
}

function syncPropertiesButton(isClassicLayoutEnabled) {
    if (!isClassicLayoutEnabled) {
        const originalBtn = findOriginalPropertiesButton();
        if (originalBtn?.classList.contains("comfy-sidebar-hide-original-properties-btn")) {
            originalBtn.classList.remove("comfy-sidebar-hide-original-properties-btn");
        }

        const customBtn = document.querySelector(".comfy-sidebar-custom-properties-toggle");
        if (customBtn) customBtn.remove();
        return;
    }

    const originalBtn = findOriginalPropertiesButton();
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
        customBtn.innerHTML = cleanHTML(savedButtonData.innerHTML);

        for (const attr of savedButtonData.attributes) {
            if (attr.name !== "class" && attr.name !== "id" && attr.name !== "style") {
                customBtn.setAttribute(attr.name, attr.value);
            }
        }

        customBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const nativeBtn = findOriginalPropertiesButton();
            if (nativeBtn) {
                nativeBtn.click();
                requestAnimationFrame(() => syncClassicLayout());
            }
        });

        container.appendChild(customBtn);
    }

    if (customBtn) {
        if (originalBtn) {
            const cleanedHTML = cleanHTML(originalBtn.innerHTML);
            if (cleanedHTML && customBtn.innerHTML !== cleanedHTML) {
                const existingDot = customBtn.querySelector('.comfy-sidebar-error-dot');
                customBtn.innerHTML = cleanedHTML;
                if (existingDot) customBtn.appendChild(existingDot);
            }

            const titleVal = originalBtn.getAttribute("title") || originalBtn.getAttribute("aria-label") || "Toggle properties panel";
            customBtn.setAttribute("title", titleVal);
            customBtn.setAttribute("aria-label", titleVal);

            for (const cls of originalBtn.classList) {
                if (cls !== "comfy-sidebar-hide-original-properties-btn" && !customBtn.classList.contains(cls)) {
                    customBtn.classList.add(cls);
                }
            }

            syncErrorBadge(originalBtn, customBtn);
        } else if (!customBtn.getAttribute("title")) {
            customBtn.setAttribute("title", "Toggle properties panel");
            customBtn.setAttribute("aria-label", "Toggle properties panel");
        }
        customBtn.classList.toggle("comfy-panel-open", openState);
        customBtn.style.display = "inline-flex";
    }
}

function syncActiveQueueIndicator(isClassicLayoutEnabled) {
    const hideQueueIndicator = app.ui?.settings?.getSettingValue("Comfy Sidebar.Hide Junk.Override Stock Job History Tab") ?? false;
    const indicator = findActiveQueueIndicator();
    if (indicator) {
        if (isClassicLayoutEnabled && hideQueueIndicator) {
            if (indicator.style.display !== "none") indicator.style.setProperty("display", "none", "important");
        } else if (indicator.style.display === "none") {
            indicator.style.removeProperty("display");
        }
    }
}

export function syncRuntimePreviewButton() {
    const panel = findPropertiesPanel();
    if (!panel) return;

    let dock = panel.querySelector(".comfy-sidebar-runtime-preview-dock");
    if (!dock) {
        dock = document.createElement("div");
        dock.className = "comfy-sidebar-runtime-preview-dock";
        Object.assign(dock.style, {
            position: "sticky",
            bottom: "0px",
            left: "0px",
            width: "100%",
            padding: "8px 12px",
            boxSizing: "border-box",
            background: "var(--comfy-menu-bg, #181818)",
            borderTop: "1px solid var(--border-color, rgba(255, 255, 255, 0.12))",
            zIndex: "20",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: "auto"
        });

        const btn = document.createElement("button");
        btn.className = "comfy-sidebar-runtime-preview-btn";
        Object.assign(btn.style, {
            width: "100%",
            height: "34px",
            borderRadius: "6px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontSize: "12px",
            fontWeight: "600",
            fontFamily: "sans-serif",
            transition: "all 0.15s ease",
            outline: "none"
        });

        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const nextState = !isRuntimePreviewEnabled();
            setRuntimePreviewEnabled(nextState, true);
        };

        dock.appendChild(btn);
        panel.appendChild(dock);
    }

    const btn = dock.querySelector(".comfy-sidebar-runtime-preview-btn");
    if (btn) {
        const active = isRuntimePreviewEnabled();

        const lucidePlay = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polygon points="6 3 20 12 6 21 6 3"/></svg>`;
        const lucideEye = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7;flex-shrink:0;"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
        const lucideSquareCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`;
        const lucideSquare = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;flex-shrink:0;"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>`;

        if (active) {
            btn.style.background = "rgba(59, 130, 246, 0.18)";
            btn.style.border = "1px solid #3b82f6";
            btn.style.color = "#93c5fd";
            btn.style.boxShadow = "0 0 8px rgba(59, 130, 246, 0.35)";
            btn.innerHTML = `<span style="display:flex;align-items:center;gap:7px;">${lucidePlay}<span>Runtime Preview</span></span>${lucideSquareCheck}`;
            btn.title = "Runtime Preview is ON (auto-tracking live generation). Click to turn OFF.";
        } else {
            btn.style.background = "rgba(255, 255, 255, 0.05)";
            btn.style.border = "1px solid var(--border-color, rgba(255, 255, 255, 0.15))";
            btn.style.color = "var(--desc-color, #aaa)";
            btn.style.boxShadow = "none";
            btn.innerHTML = `<span style="display:flex;align-items:center;gap:7px;">${lucideEye}<span>Runtime Preview</span></span>${lucideSquare}`;
            btn.title = "Click to turn ON Runtime Preview (auto-focus live generation).";
        }
    }
}

export function syncClassicLayout() {
    if (domObserver) domObserver.disconnect();

    try {
        const isClassicLayoutEnabled = app.ui?.settings?.getSettingValue("Comfy Sidebar.Comfy Layout") ?? false;

        syncGraphButton();
        syncExtensionsPanel(isClassicLayoutEnabled);
        syncPropertiesButton(isClassicLayoutEnabled);
        syncActiveQueueIndicator(isClassicLayoutEnabled);
        updateSidebarTabsVisibility();
        syncRuntimePreviewButton();

    } catch (err) {
        console.error("Comfy Sidebar: Error inside layout sync routine:", err);
    } finally {
        if (domObserver) {
            domObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    }
}

export function setupPropertiesPanelToggleFix() {
    if (!document.getElementById("comfy-sidebar-layout-fix-styles")) {
        const style = document.createElement("style");
        style.id = "comfy-sidebar-layout-fix-styles";
        style.textContent = `
            .comfy-sidebar-hide-original-properties-btn {
                display: none !important;
            }
            .comfy-sidebar-hide-original-properties-btn ~ span,
            .comfy-sidebar-hide-original-properties-btn + span {
                display: none !important;
            }
            .comfy-sidebar-custom-properties-toggle {
                order: 99999 !important;
                position: relative !important;
                overflow: visible !important;
                margin-left: -8px !important;
                margin-right: 0px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 0 !important;
            }
            .comfy-sidebar-custom-properties-toggle.comfy-panel-open {
                margin-left: 0px !important;
            }
            .comfy-sidebar-custom-properties-toggle > span.comfy-sidebar-error-dot {
                display: inline-flex !important;
            }
        `;
        document.head.appendChild(style);
    }

    if (domObserver) domObserver.disconnect();

    domObserver = new MutationObserver((mutations) => {
        let shouldSync = false;

        const isInternalSidebarMutation = (node) => {
            if (!node || node.nodeType !== 1) return false;
            return node.closest?.('.comfyui-sidebar, .comfy-sidebar, .comfy-sidebar-comparison-overlay') ||
                   node.classList?.contains('comfy-sidebar-card');
        };

        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
                const hasExternalElementMutation = 
                    Array.from(mutation.addedNodes).some(node => node.nodeType === 1 && !isInternalSidebarMutation(node)) ||
                    Array.from(mutation.removedNodes).some(node => node.nodeType === 1 && !isInternalSidebarMutation(node));
                
                if (hasExternalElementMutation) {
                    shouldSync = true;
                    break;
                }
            }
        }
        if (shouldSync && !syncScheduled) {
            syncScheduled = true;
            requestAnimationFrame(() => {
                syncClassicLayout();
                syncScheduled = false;
            });
        }
    });

    domObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    syncClassicLayout();
}

export function destroyLayoutFix() {
    if (domObserver) {
        domObserver.disconnect();
        domObserver = null;
    }
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
    const fixStyles = document.getElementById("comfy-sidebar-layout-fix-styles");
    if (fixStyles) fixStyles.remove();
}