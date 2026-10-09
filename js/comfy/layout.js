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
/* Neutralize the leftover floating shell box to prevent empty dark square artifacts */
.actionbar-container,
.shadow-interface.rounded-lg.bg-comfy-menu-bg:not(.floating-panel):not([role="toolbar"]),
.shadow-interface.rounded-lg.border-interface-stroke:not(.floating-panel):not([role="toolbar"]),
.shadow-interface.border.rounded-lg:has([class*="actionbar-buttons"]),
.shadow-interface.border.rounded-lg:has(.actionbar-buttons),
div.border-interface-stroke.rounded-lg:has([class*="actionbar-buttons"]),
div.shadow-interface.py-1\\.75 {
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
}

/* Dock actionbar buttons in the topbar row with matching dark background and seamless border */
[class*="actionbar"]:not(.actionbar),
[class*="actionbar-buttons"],
.actionbar-buttons {
    position: fixed !important;
    top: 0 !important; 
    right: 0 !important; 
    left: auto !important;
    height: var(--topbar-height, 40px) !important;
    transform: none !important;
    z-index: 1010 !important;
    background: var(--comfy-menu-bg, #181818) !important;
    border: none !important;
    border-bottom: 1px solid var(--interface-stroke, var(--border-color, rgba(255, 255, 255, 0.12))) !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    padding: 0 8px !important;
    margin: 0 !important;
    display: flex !important;
    align-items: center !important;
    box-sizing: border-box !important;
}

/* Constrain tabs boundary directly to the start of the action bar */
.workflow-tabs-container {
    padding-right: var(--actionbar-width, 240px) !important;
    box-sizing: border-box !important;
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

let savedButtonData = null;
let domObserver = null;
let syncScheduled = false;
let actionbarResizeObserver = null;

function isSidebarOnLeft() {
    const sidebar = document.querySelector('.comfyui-sidebar, .comfy-sidebar, .sidebar, [class*="sidebar-nav"], [class*="sidebar"]');
    if (!sidebar) return false;
    return sidebar.getBoundingClientRect().left < window.innerWidth / 2;
}

function findSidebarBottomTarget(sidebar) {
    if (!sidebar) return null;

    const candidates = Array.from(sidebar.querySelectorAll('button, [role="button"], a, .comfyui-sidebar-tab, .comfyui-sidebar-item'));
    const bottomBtn = candidates.find(el => {
        const text = el.textContent?.trim().toLowerCase();
        const title = (el.getAttribute('title') || el.getAttribute('aria-label') || '').toLowerCase();
        return text === 'help' || text === 'console' || text === 'shortcuts' || text === 'settings' ||
               title.includes('help') || title.includes('console') || title.includes('shortcuts') || title.includes('settings') ||
               el.querySelector('[class*="help"], [class*="terminal"], [class*="keyboard"], [class*="settings"], [class*="gear"], .pi-cog, .pi-question');
    });

    return bottomBtn || null;
}

function stripBorderRadius(canvasMenu) {
    if (!canvasMenu) return;
    canvasMenu.style.setProperty("border-radius", "0px", "important");
    const elements = canvasMenu.querySelectorAll("button, [role='button'], div, i, span");
    elements.forEach((el) => {
        el.style.setProperty("border-radius", "0px", "important");
    });
}

function syncCanvasMenuPlacement(mode) {
    const HIDE_CANVAS_MENU_STYLE_ID = "comfy-sidebar-hide-canvas-menu-override";
    let hideStyleEl = document.getElementById(HIDE_CANVAS_MENU_STYLE_ID);

    if (mode === "Hide") {
        if (!hideStyleEl) {
            hideStyleEl = document.createElement("style");
            hideStyleEl.id = HIDE_CANVAS_MENU_STYLE_ID;
            hideStyleEl.textContent = `
                [role="toolbar"]:has([data-testid="zoom-controls-button"]):has([data-testid="toggle-minimap-button"]),
                .p-buttongroup.z-1200,
                .p-buttongroup.bottom-0.right-0,
                [class*="bottom-0"][class*="right-0"][class*="p-buttongroup"],
                .p-buttongroup:has([class*="w-15"]),
                .comfy-sidebar-unfloated-canvas-menu {
                    display: none !important;
                }
            `;
            document.head.appendChild(hideStyleEl);
        }

        // Return to original parent if it was docked, so the sidebar doesn't have an empty slot
        const canvasMenu = document.querySelector('.comfy-sidebar-unfloated-canvas-menu');
        if (canvasMenu && canvasMenu._originalParent) {
            canvasMenu._originalParent.insertBefore(canvasMenu, canvasMenu._originalNextSibling || null);
            canvasMenu.classList.remove("comfy-sidebar-unfloated-canvas-menu");
            canvasMenu.style.removeProperty("border-radius");
            const elements = canvasMenu.querySelectorAll("*");
            elements.forEach((el) => {
                el.style.removeProperty("border-radius");
            });
        }
        return;
    }

    if (hideStyleEl) {
        hideStyleEl.remove();
    }

    if (mode === "Dock" || mode === true) {
        const sidebar = document.querySelector('.comfyui-sidebar, .comfy-sidebar, .sidebar, [class*="sidebar-nav"], [class*="sidebar"]');
        if (!sidebar) return;

        // Stamp sidebar position and width for instant CSS positioning of modals
        document.documentElement.dataset.sidebarPosition = isSidebarOnLeft() ? "left" : "right";
        const sidebarWidth = Math.round(sidebar.getBoundingClientRect().width) || 60;
        document.documentElement.style.setProperty('--comfy-sidebar-dock-width', `${sidebarWidth}px`);

        const bottomTarget = findSidebarBottomTarget(sidebar);
        const targetParent = bottomTarget ? bottomTarget.parentNode : sidebar;

        // Find floating canvas toolbar by semantic role and test IDs, with class fallback
        const floatingMenu = Array.from(
            document.querySelectorAll('[role="toolbar"]')
        ).find((el) =>
            !el.classList.contains("comfy-sidebar-unfloated-canvas-menu") &&
            el.querySelector('[data-testid="zoom-controls-button"]') &&
            el.querySelector('[data-testid="toggle-minimap-button"]')
        ) || document.querySelector(
            '.p-buttongroup.z-1200:not(.comfy-sidebar-unfloated-canvas-menu), ' +
            '.p-buttongroup.bottom-0.right-0:not(.comfy-sidebar-unfloated-canvas-menu), ' +
            '[class*="bottom-0"][class*="right-0"][class*="p-buttongroup"]:not(.comfy-sidebar-unfloated-canvas-menu), ' +
            '.p-buttongroup:has([class*="w-15"]):not(.comfy-sidebar-unfloated-canvas-menu)'
        );

        const existingDocked = document.querySelector('.comfy-sidebar-unfloated-canvas-menu');

        // Prevent duplication when switching sidebar sides: drop stale docked bar if a fresh floating one appeared
        if (floatingMenu && existingDocked && floatingMenu !== existingDocked) {
            existingDocked.remove();
        }

        const canvasMenu = floatingMenu || existingDocked;
        if (!canvasMenu) return;

        if (canvasMenu.parentNode !== targetParent) {
            if (!canvasMenu._originalParent) {
                canvasMenu._originalParent = canvasMenu.parentNode;
                canvasMenu._originalNextSibling = canvasMenu.nextSibling;
            }

            if (bottomTarget && bottomTarget.parentNode === targetParent) {
                targetParent.insertBefore(canvasMenu, bottomTarget);
            } else {
                targetParent.appendChild(canvasMenu);
            }
            canvasMenu.classList.add("comfy-sidebar-unfloated-canvas-menu");

            stripBorderRadius(canvasMenu);

            if (!canvasMenu._clickGuardAttached) {
                canvasMenu._clickGuardAttached = true;
                const enforce = () => {
                    if (!canvasMenu.classList.contains("comfy-sidebar-unfloated-canvas-menu")) return;
                    requestAnimationFrame(() => stripBorderRadius(canvasMenu));
                };
                canvasMenu.addEventListener("click", enforce);
                canvasMenu.addEventListener("pointerup", enforce);
                canvasMenu.addEventListener("mouseenter", enforce, true);
            }
        } else {
            stripBorderRadius(canvasMenu);
        }
    } else {
        // Return to floating mode: completely restore stock parent and enforce 8px rounded corners
        const canvasMenu = document.querySelector('.comfy-sidebar-unfloated-canvas-menu') ||
                           document.querySelector('[role="toolbar"]') ||
                           document.querySelector('.floating-panel');
        if (canvasMenu && canvasMenu.classList.contains("comfy-sidebar-unfloated-canvas-menu")) {
            if (canvasMenu._originalParent) {
                canvasMenu._originalParent.insertBefore(canvasMenu, canvasMenu._originalNextSibling || null);
            }
            canvasMenu.classList.remove("comfy-sidebar-unfloated-canvas-menu");
        }
        if (canvasMenu) {
            canvasMenu.style.setProperty("border-radius", "8px", "important");
            canvasMenu.querySelectorAll("*").forEach((el) => {
                el.style.removeProperty("border-radius");
            });
        }
        delete document.documentElement.dataset.sidebarPosition;
        document.documentElement.style.removeProperty('--comfy-sidebar-dock-width');
    }
}

// Tooltips: dynamic side calculation (right for left-sidebar, left for right-sidebar)
function setupCanvasMenuTooltipRelocator() {
    if (window._canvasTooltipRelocatorReady) return;
    window._canvasTooltipRelocatorReady = true;

    document.addEventListener("mouseenter", (e) => {
        const targetBtn = e.target?.closest?.(
            ".comfy-sidebar-unfloated-canvas-menu button, " +
            ".comfy-sidebar-unfloated-canvas-menu [role='button'], " +
            ".comfy-sidebar-unfloated-canvas-menu [data-pd-tooltip='true']"
        );
        if (!targetBtn) return;

        const align = () => {
            const tooltipId = targetBtn.$_ptooltipId || targetBtn.getAttribute("aria-describedby");
            const tooltip = tooltipId ? document.getElementById(tooltipId) : document.querySelector(".p-tooltip:not(.p-tooltip-hidden)");
            if (!tooltip) return;

            const btnRect = targetBtn.getBoundingClientRect();
            const tWidth = tooltip.offsetWidth || 80;
            const tHeight = tooltip.offsetHeight || 28;
            const onLeft = isSidebarOnLeft();

            tooltip.classList.remove("p-tooltip-top", "p-tooltip-bottom", "p-tooltip-right", "p-tooltip-left");
            tooltip.classList.add(onLeft ? "p-tooltip-right" : "p-tooltip-left");

            const posX = onLeft ? Math.round(btnRect.right + 8) : Math.round(btnRect.left - tWidth - 8);
            const posY = Math.round(btnRect.top + (btnRect.height - tHeight) / 2);

            tooltip.style.setProperty("left", `${posX}px`, "important");
            tooltip.style.setProperty("top", `${posY}px`, "important");
            tooltip.style.setProperty("transform", "none", "important");
        };

        queueMicrotask(align);
        requestAnimationFrame(align);
    }, true);
}

// Popovers / Menus: positions popups and modals next to the docked sidebar button
function setupCanvasMenuPopoverRelocator() {
    if (window._canvasPopoverRelocatorReady) return;
    window._canvasPopoverRelocatorReady = true;

    // Instantly pre-calculate coordinates on pointerdown so the Zoom modal renders in place with ZERO flash
    const preAnchorZoomModal = (e) => {
        const btn = e.target?.closest?.(
            '.comfy-sidebar-unfloated-canvas-menu [data-testid="zoom-controls-button"], ' +
            '.comfy-sidebar-unfloated-canvas-menu button[title*="Zoom"], ' +
            '.comfy-sidebar-unfloated-canvas-menu button[aria-label*="Zoom"], ' +
            '.comfy-sidebar-unfloated-canvas-menu [class*="w-15"]'
        );
        if (!btn) return;

        const btnRect = btn.getBoundingClientRect();
        const onLeft = btnRect.left < window.innerWidth / 2;
        const modalWidth = 250;
        const modalHeight = 165;

        // Anchor 8px away from the button's edge
        const leftPos = onLeft
            ? Math.round(btnRect.right + 8)
            : Math.round(btnRect.left - modalWidth - 8);

        // Center vertically with the button, clamped to viewport bounds
        const maxTop = window.innerHeight - modalHeight - 12;
        const topPos = Math.max(12, Math.min(maxTop, Math.round(btnRect.top - (modalHeight / 2) + (btnRect.height / 2))));

        document.documentElement.style.setProperty('--zoom-modal-left', `${leftPos}px`);
        document.documentElement.style.setProperty('--zoom-modal-top', `${topPos}px`);
    };

    document.addEventListener("pointerdown", preAnchorZoomModal, true);
    document.addEventListener("click", preAnchorZoomModal, true);

    document.addEventListener("click", (e) => {
        const btn = e.target?.closest?.(".comfy-sidebar-unfloated-canvas-menu button, .comfy-sidebar-unfloated-canvas-menu [role='button']");
        if (!btn) return;

        const reposition = () => {
            const popovers = document.querySelectorAll(".p-popover");
            const sidebar = document.querySelector('.comfyui-sidebar, .comfy-sidebar, .sidebar, [class*="sidebar-nav"], [class*="sidebar"]');
            if (!sidebar || !popovers.length) return;

            const sidebarRect = sidebar.getBoundingClientRect();
            const btnRect = btn.getBoundingClientRect();
            const onLeft = sidebarRect.left < window.innerWidth / 2;

            popovers.forEach((pop) => {
                if (pop.style.display !== "none" && !pop.classList.contains("p-overlay-hidden")) {
                    const popWidth = pop.offsetWidth || 160;
                    const popHeight = pop.offsetHeight || 100;
                    const maxTop = window.innerHeight - popHeight - 12;
                    const topPos = Math.max(12, Math.min(maxTop, Math.round(btnRect.top)));

                    const leftPos = onLeft
                        ? Math.round(sidebarRect.right + 8)
                        : Math.round(sidebarRect.left - popWidth - 8);

                    pop.style.setProperty("left", `${leftPos}px`, "important");
                    pop.style.setProperty("top", `${topPos}px`, "important");
                    pop.style.setProperty("transform", "none", "important");
                }
            });
        };

        [0, 15, 40, 100].forEach((ms) => setTimeout(reposition, ms));
    }, true);
}

function updateTopMetrics() {
    const bar = document.querySelector('.actionbar-buttons, [class*="actionbar-buttons"]') || findTopbarContainer();
    const tabsEl = document.querySelector('.workflow-tabs-container');
    const topbar = tabsEl?.closest('header, .topbar, [class*="topbar"]') || tabsEl;

    if (bar) {
        const rect = bar.getBoundingClientRect();
        const width = Math.ceil(rect.width);
        if (width > 80 && width < window.innerWidth * 0.8) {
            document.documentElement.style.setProperty('--actionbar-width', `${Math.round(width / 2)}px`);
        }

        if (window.ResizeObserver && !actionbarResizeObserver) {
            actionbarResizeObserver = new ResizeObserver(() => {
                updateTopMetrics();
            });
            actionbarResizeObserver.observe(bar);
        }
    }

    if (topbar) {
        const height = Math.round(topbar.getBoundingClientRect().height);
        if (height > 20) {
            document.documentElement.style.setProperty('--topbar-height', `${height}px`);
        }
    }
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
        updateTopMetrics();
        window.removeEventListener("resize", updateTopMetrics);
        window.addEventListener("resize", updateTopMetrics);
    } else {
        if (styleEl) styleEl.remove();
        if (actionbarResizeObserver) {
            actionbarResizeObserver.disconnect();
            actionbarResizeObserver = null;
        }
        window.removeEventListener("resize", updateTopMetrics);
        document.documentElement.style.removeProperty('--actionbar-width');
        document.documentElement.style.removeProperty('--topbar-height');

        if (updateSetting) {
            if (app.extensionManager?.setting) {
                app.extensionManager.setting.set("Comfy.Workflow.WorkflowTabsPosition", "Sidebar");
            } else if (app.ui?.settings) {
                app.ui.settings.setSettingValue("Comfy.Workflow.WorkflowTabsPosition", "Sidebar");
            }
        }
    }
}

function syncAvatarVisibility() {
    const hideAvatar = app.ui?.settings?.getSettingValue("Comfy Sidebar.Hide Junk.Avatar") ?? false;
    const STYLE_AVATAR_ID = "comfy-sidebar-hide-avatar-override";
    let styleEl = document.getElementById(STYLE_AVATAR_ID);

    if (hideAvatar) {
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = STYLE_AVATAR_ID;
            styleEl.textContent = `
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
                [role="button"]:has([data-pc-name="avatar"]),
                button:has([class*="lucide--user"]),
                button:has(svg.lucide-user),
                [data-testid="user-profile-button"] {
                    display: none !important;
                }
            `;
            document.head.appendChild(styleEl);
        }
    } else {
        if (styleEl) styleEl.remove();
    }
}

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
        let canvasControlsMode = app.ui?.settings?.getSettingValue("Comfy Sidebar.Hide Junk.Floating Canvas Controls");
        if (canvasControlsMode === undefined || canvasControlsMode === null) {
            const legacyDock = app.ui?.settings?.getSettingValue("Comfy Sidebar.Dock Canvas Controls");
            canvasControlsMode = legacyDock ? "Dock" : "Default";
        } else if (typeof canvasControlsMode === "boolean") {
            canvasControlsMode = canvasControlsMode ? "Dock" : "Default";
        }

        if (isClassicLayoutEnabled) {
            updateTopMetrics();
        }

        syncGraphButton();
        syncAvatarVisibility();
        syncCanvasMenuPlacement(canvasControlsMode);
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
    setupCanvasMenuTooltipRelocator();
    setupCanvasMenuPopoverRelocator();

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

            /* Ensure floating canvas toolbar keeps its native rounded corners when undocked */
            .floating-panel:not(.comfy-sidebar-unfloated-canvas-menu),
            [role="toolbar"]:not(.comfy-sidebar-unfloated-canvas-menu),
            .p-buttongroup:not(.comfy-sidebar-unfloated-canvas-menu) {
                border-radius: 8px !important;
            }

            /* When docked, instantly anchor Zoom modal right beside the Zoom button with zero flash */
            html:has(.comfy-sidebar-unfloated-canvas-menu) div.z-1300,
            html:has(.comfy-sidebar-unfloated-canvas-menu) [class*="bottom-[62px]"],
            html:has(.comfy-sidebar-unfloated-canvas-menu) [class*="bottom-\\[62px\\]"] {
                position: fixed !important;
                left: var(--zoom-modal-left, -9999px) !important;
                top: var(--zoom-modal-top, -9999px) !important;
                right: auto !important;
                bottom: auto !important;
            }

            /* Tooltip positioning: suppress top tooltip flash and show cleanly on left/right */
            body:has(.comfy-sidebar-unfloated-canvas-menu :hover) .p-tooltip-top {
                visibility: hidden !important;
            }
            body:has(.comfy-sidebar-unfloated-canvas-menu :hover) .p-tooltip-left,
            body:has(.comfy-sidebar-unfloated-canvas-menu :hover) .p-tooltip-right {
                visibility: visible !important;
                transform: none !important;
            }

            /* Docked canvas menu: vertical containment */
            .comfy-sidebar-unfloated-canvas-menu {
                position: static !important;
                bottom: auto !important;
                right: auto !important;
                left: auto !important;
                top: auto !important;
                transform: none !important;
                z-index: 10 !important;
                flex-direction: column !important;
                background: transparent !important;
                border: none !important;
                border-radius: 0 !important;
                box-shadow: none !important;
                padding: 0 !important;
                margin: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
                min-width: 0 !important;
                overflow: hidden !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 0 !important;
                box-sizing: border-box !important;
            }

            /* Strict containment: stops all children from expanding sidebar width */
            .comfy-sidebar-unfloated-canvas-menu,
            .comfy-sidebar-unfloated-canvas-menu * {
                min-width: 0 !important;
                box-sizing: border-box !important;
            }

            /* Unconditional zero radius override across entire container and all states */
            html body .comfy-sidebar-unfloated-canvas-menu,
            html body .comfy-sidebar-unfloated-canvas-menu *,
            html body .comfy-sidebar-unfloated-canvas-menu *:hover,
            html body .comfy-sidebar-unfloated-canvas-menu *:focus,
            html body .comfy-sidebar-unfloated-canvas-menu *:active,
            html body .comfy-sidebar-unfloated-canvas-menu button,
            html body .comfy-sidebar-unfloated-canvas-menu button:hover,
            html body .comfy-sidebar-unfloated-canvas-menu button:focus,
            html body .comfy-sidebar-unfloated-canvas-menu button:active,
            html body .comfy-sidebar-unfloated-canvas-menu [class*="hover:rounded"]:hover,
            html body .comfy-sidebar-unfloated-canvas-menu .hover\\:rounded-lg\\!:hover,
            html body .comfy-sidebar-unfloated-canvas-menu div,
            html body .comfy-sidebar-unfloated-canvas-menu div:hover {
                border-radius: 0 !important;
            }

            /* Full-width rectangular button containers matching stock Help/Console */
            .comfy-sidebar-unfloated-canvas-menu > button,
            .comfy-sidebar-unfloated-canvas-menu > [role="button"],
            .comfy-sidebar-unfloated-canvas-menu > div {
                width: 100% !important;
                max-width: 100% !important;
                height: 38px !important;
                min-height: 38px !important;
                border-radius: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                background: transparent !important;
            }

            /* Full rectangular hover background across the full sidebar width */
            .comfy-sidebar-unfloated-canvas-menu > button:hover,
            .comfy-sidebar-unfloated-canvas-menu > [role="button"]:hover,
            .comfy-sidebar-unfloated-canvas-menu > div:hover,
            .comfy-sidebar-unfloated-canvas-menu button:hover {
                background: var(--interface-button-hover-surface, rgba(255, 255, 255, 0.08)) !important;
                border-radius: 0 !important;
            }

            /* Neutralize CanvasModeSelector inner selected backgrounds so idle mode is clean and transparent */
            .comfy-sidebar-unfloated-canvas-menu > div div,
            .comfy-sidebar-unfloated-canvas-menu > div button,
            .comfy-sidebar-unfloated-canvas-menu > div [role="button"],
            .comfy-sidebar-unfloated-canvas-menu [class*="bg-interface-panel-selected-surface"],
            .comfy-sidebar-unfloated-canvas-menu [class*="group-hover:bg-interface-button-hover-surface"] {
                background: transparent !important;
                border-radius: 0 !important;
                box-shadow: none !important;
            }

            /* Compact CanvasModeSelector padding and chevrons to eliminate extra sidebar width and ensure full-width highlight */
            .comfy-sidebar-unfloated-canvas-menu [class*="pr-0.5"],
            .comfy-sidebar-unfloated-canvas-menu div.flex.items-center,
            .comfy-sidebar-unfloated-canvas-menu > div,
            .comfy-sidebar-unfloated-canvas-menu > div > button {
                padding: 0 !important;
                margin: 0 !important;
                gap: 2px !important;
                justify-content: center !important;
                width: 100% !important;
                border-radius: 0 !important;
            }

            /* Compact the Zoom button: strip w-15 (60px) and px-2 padding */
            .comfy-sidebar-unfloated-canvas-menu [class*="w-15"],
            .comfy-sidebar-unfloated-canvas-menu .w-15 {
                width: 100% !important;
                max-width: 100% !important;
            }
            .comfy-sidebar-unfloated-canvas-menu [class*="px-2"],
            .comfy-sidebar-unfloated-canvas-menu span.px-2 {
                padding: 0 !important;
                gap: 2px !important;
            }

            /* Compact down-arrow chevrons */
            .comfy-sidebar-unfloated-canvas-menu [class*="chevron-down"],
            .comfy-sidebar-unfloated-canvas-menu [class*="pr-1.5"] {
                padding: 0 !important;
                width: 12px !important;
                height: 12px !important;
            }

            .comfy-sidebar-unfloated-canvas-menu button,
            .comfy-sidebar-unfloated-canvas-menu [role="button"] {
                border-radius: 0 !important;
                background: transparent !important;
                font-size: 11px !important;
                width: 100% !important;
                height: 100% !important;
            }

            /* Exact stock grey color #8a8a8a without opacity */
            .comfy-sidebar-unfloated-canvas-menu button,
            .comfy-sidebar-unfloated-canvas-menu [role="button"],
            .comfy-sidebar-unfloated-canvas-menu span,
            .comfy-sidebar-unfloated-canvas-menu svg {
                color: #8a8a8a !important;
                opacity: 1 !important;
                transition: color 0.15s ease !important;
            }

            .comfy-sidebar-unfloated-canvas-menu button:hover,
            .comfy-sidebar-unfloated-canvas-menu [role="button"]:hover,
            .comfy-sidebar-unfloated-canvas-menu button:hover span,
            .comfy-sidebar-unfloated-canvas-menu [role="button"]:hover span,
            .comfy-sidebar-unfloated-canvas-menu button:hover svg,
            .comfy-sidebar-unfloated-canvas-menu [role="button"]:hover svg {
                color: #ffffff !important;
            }

            /* Consistent, uniform 38px horizontal separators */
            .comfy-sidebar-unfloated-canvas-menu::before,
            .comfy-sidebar-unfloated-canvas-menu::after,
            .comfy-sidebar-unfloated-canvas-menu .p-divider,
            .comfy-sidebar-unfloated-canvas-menu [class*="divider"],
            .comfy-sidebar-unfloated-canvas-menu hr,
            .comfy-sidebar-unfloated-canvas-menu > div:not(:has(*)):not(button),
            .comfy-sidebar-unfloated-canvas-menu > span:not(:has(*)):not(button),
            .comfy-sidebar-unfloated-canvas-menu [class*="w-px"],
            .comfy-sidebar-unfloated-canvas-menu [class*="w-\[1px\]"] {
                content: "" !important;
                width: 38px !important;
                height: 1px !important;
                min-height: 1px !important;
                max-height: 1px !important;
                min-width: 38px !important;
                max-width: 38px !important;
                border: none !important;
                background: var(--interface-stroke, var(--border-color, rgba(255, 255, 255, 0.15))) !important;
                margin: 4px auto !important;
                display: block !important;
                position: static !important;
            }

            .comfy-sidebar-unfloated-canvas-menu .p-divider::before,
            .comfy-sidebar-unfloated-canvas-menu [class*="divider"]::before {
                display: none !important;
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
    delete document.documentElement.dataset.sidebarPosition;
    document.documentElement.style.removeProperty('--comfy-sidebar-dock-width');
    document.documentElement.style.removeProperty('--zoom-modal-left');
    document.documentElement.style.removeProperty('--zoom-modal-top');
    syncCanvasMenuPlacement("Default");
    const hideCanvasStyle = document.getElementById("comfy-sidebar-hide-canvas-menu-override");
    if (hideCanvasStyle) hideCanvasStyle.remove();
    if (domObserver) {
        domObserver.disconnect();
        domObserver = null;
    }
    if (actionbarResizeObserver) {
        actionbarResizeObserver.disconnect();
        actionbarResizeObserver = null;
    }
    window.removeEventListener("resize", updateTopMetrics);
    document.documentElement.style.removeProperty('--actionbar-width');
    document.documentElement.style.removeProperty('--topbar-height');

    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
    const fixStyles = document.getElementById("comfy-sidebar-layout-fix-styles");
    if (fixStyles) fixStyles.remove();
    const avatarStyles = document.getElementById("comfy-sidebar-hide-avatar-override");
    if (avatarStyles) avatarStyles.remove();
}