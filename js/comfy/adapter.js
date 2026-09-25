import { app } from "/scripts/app.js";

export function findOriginalPropertiesButton() {
    const byTestId = document.querySelector('[data-testid="properties-panel-toggle"]');
    if (byTestId && !byTestId.classList.contains("comfy-sidebar-custom-properties-toggle")) {
        return byTestId;
    }

    const icons = document.querySelectorAll('[class*="lucide--panel-right"], [class*="lucide--panel-left"], [class*="lucide--panel-bottom"]');
    for (const icon of icons) {
        const btn = icon.closest('button, [role="button"], .comfyui-menu-item, .p-button');
        if (btn && !btn.classList.contains("comfy-sidebar-custom-properties-toggle")) {
            return btn;
        }
    }

    const buttons = document.querySelectorAll('button, [role="button"], .p-button');
    for (const btn of buttons) {
        if (btn.classList.contains("comfy-sidebar-custom-properties-toggle")) continue;
        const title = (btn.getAttribute("title") || btn.getAttribute("aria-label") || "").toLowerCase();
        if (title.includes("workflow overview") || title.includes("properties") || title.includes("toggle panel")) {
            return btn;
        }
    }
    return null;
}

export function findTopbarContainer() {
    const container = document.querySelector('[data-testid="action-bar-buttons"], [class*="actionbar-buttons"], .actionbar-buttons, [class*="actionbar"]');
    if (container) return container;

    const orig = findOriginalPropertiesButton();
    if (orig?.parentNode) return orig.parentNode;

    const buttons = document.querySelectorAll("button, .p-button");
    for (const btn of buttons) {
        if (btn.classList.contains("comfy-sidebar-custom-properties-toggle")) continue;
        const title = (btn.getAttribute("title") || btn.getAttribute("aria-label") || "").toLowerCase();
        if (title.includes("run") || title.includes("manager")) {
            if (btn.parentNode) return btn.parentNode;
        }
    }
    return null;
}

export function findPropertiesPanel() {
    const testIdPanel = document.querySelector('[data-testid="properties-panel"], [data-testid="workflow-overview-panel"], .properties-panel, [class*="properties-panel"]');
    if (testIdPanel && testIdPanel.offsetWidth > 0 && testIdPanel.offsetHeight > 0 && testIdPanel.isConnected) {
        return testIdPanel;
    }

    const headings = document.querySelectorAll('h1, h2, h3, h4, [class*="title"]');
    for (const h of headings) {
        if (h.textContent.trim().toLowerCase() === "workflow overview" && h.offsetWidth > 0 && h.offsetHeight > 0) {
            const container = h.closest('.p-sidebar, .sidebar, aside, [class*="side-panel"], [class*="panel"], [class*="properties"]') || h.parentElement;
            if (container && container.offsetWidth > 0 && container !== document.body) {
                return container;
            }
        }
    }

    const rightSidebars = document.querySelectorAll('.p-sidebar-right, aside.p-sidebar, [class*="p-sidebar-right"]');
    for (const sb of rightSidebars) {
        if (sb.offsetWidth > 0 && sb.offsetHeight > 0) {
            return sb;
        }
    }

    return null;
}

export function isPropertiesPanelOpen() {
    const panel = findPropertiesPanel();
    if (panel) return true;

    const origBtn = findOriginalPropertiesButton();
    if (origBtn) {
        if (origBtn.classList.contains("p-button-active") ||
            origBtn.classList.contains("active") ||
            origBtn.getAttribute("aria-expanded") === "true" ||
            origBtn.getAttribute("aria-pressed") === "true") {
            return true;
        }
    }
    return false;
}

export function findActiveSidebars() {
    const leftPanels = [];
    const rightPanels = [];
    const winW = window.innerWidth;
    const midX = winW / 2;

    // 1. Check if our Queue sidebar is open and visible
    const queueHeader = document.querySelector('.comfy-sidebar-header-root');
    if (queueHeader) {
        const queueDrawer = queueHeader.closest('.sidebar-content-container, .comfyui-sidebar-content, .p-sidebar, aside') || queueHeader.parentElement;
        if (queueDrawer && queueDrawer.offsetWidth > 0 && queueDrawer.offsetHeight > 0 && queueDrawer.isConnected) {
            const r = queueDrawer.getBoundingClientRect();
            if (r.right > 0 && r.right < midX) {
                leftPanels.push(queueDrawer);
            }
        }
    }

    // 2. Query all active sidebars and panels across ComfyUI & third-party extensions
    const candidates = document.querySelectorAll(
        'aside, nav, .comfyui-sidebar, .side-tool-bar-container, .sidebar-content-container, ' +
        '.comfyui-sidebar-content, .p-sidebar, [data-testid="properties-panel"], ' +
        '[data-testid="workflow-overview-panel"], [data-testid*="sidebar"], .p-sidebar-right'
    );

    const seen = new Set(leftPanels);

    for (const el of candidates) {
        if (!el.isConnected || el.offsetWidth < 30 || el.offsetHeight < 120) continue;
        if (el.closest('.comfy-sidebar-comparison-overlay, .p-dialog, [role="dialog"], .comfy-modal, .comfy-menu')) continue;

        if (seen.has(el)) continue;
        seen.add(el);

        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.top > 150) continue;

        // Left-docked panels (Icon bar or an open drawer on the left)
        if (rect.left <= 100 && rect.right > 0 && rect.right < midX) {
            leftPanels.push(el);
        }
        // Right-docked panels (Workflow Overview or right inspector drawers)
        else if (rect.right >= winW - 80 && rect.left > midX && rect.left < winW) {
            rightPanels.push(el);
        }
    }

    return { leftPanels, rightPanels };
}

export function findActiveQueueIndicator() {
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

export function findNativeExtensionsPanel() {
    return Array.from(document.querySelectorAll('.shadow-interface:not(.actionbar-container)'))
        .find(el => el.textContent.toLowerCase().includes('extensions') || el.querySelector('button')?.textContent.toLowerCase().includes('extensions'));
}

export function findGraphButton() {
    const elements = document.querySelectorAll('.p-1.bg-base-background.rounded-lg, .bg-base-background.rounded-lg, .bg-secondary-background.rounded-lg.items-center.inline-flex.pointer-events-auto, [data-testid="graph-view-button"]');
    for (const el of elements) {
        if (el.closest('.p-dialog, .comfy-modal, [role="dialog"], .p-sidebar, .comfy-settings, .comfyui-sidebar, .comfy-sidebar')) continue;
        return el.closest('.group, .p-1') || el;
    }

    const fallbacks = document.querySelectorAll('button, .bg-base-background, .bg-secondary-background');
    for (const el of fallbacks) {
        if (el.closest('.p-dialog, .comfy-modal, [role="dialog"], .p-sidebar, .comfy-settings, .comfyui-sidebar, .comfy-sidebar')) continue;
        const text = (el.textContent || el.getAttribute("title") || el.getAttribute("aria-label") || "").toLowerCase();
        if (text.includes("graph") || text.includes("workflow") || el.querySelector('[class*="sitemap"], [class*="workflow"]')) {
            return el.closest('.group, .p-1, .bg-base-background, .bg-secondary-background') || el;
        }
    }
    return null;
}

export function findOurSidebarButton() {
    const byTestId = document.querySelector('[data-testid="classic-comfy-sidebar-tab-button"]');
    if (byTestId) return byTestId;

    const icon = document.querySelector('.pi-images');
    return icon ? icon.closest('.comfyui-sidebar-tab, button, [role="tab"]') : null;
}

export function findStandardQueueButton() {
    const byTestId = document.querySelector('[data-testid="queue-tab-button"], [data-testid="job-history-tab-button"]');
    if (byTestId && !byTestId.id?.includes('classic-comfy-sidebar') && !byTestId.querySelector('.pi-images')) {
        return byTestId;
    }

    for (const iconSelector of [".pi-history", ".pi-clock", ".pi-server", ".pi-list", ".pi-sliders-h", '[class*="lucide--history"]']) {
        const icon = document.querySelector(iconSelector);
        if (icon) {
            const btn = icon.closest('.comfyui-sidebar-tab, button, [role="tab"]');
            if (btn && !btn.querySelector('.pi-images')) return btn;
        }
    }

    const buttons = document.querySelectorAll('.comfyui-sidebar-tab, button, [role="tab"]');
    for (const btn of buttons) {
        const title = btn.title || btn.getAttribute('aria-label') || '';
        if ((title.toLowerCase().includes('queue') || title.toLowerCase().includes('history')) &&
            !btn.querySelector('.pi-images') &&
            !btn.id?.includes('classic-comfy-sidebar')) {
            return btn;
        }
    }
    return null;
}

export function updateSidebarBadge(count) {
    const btn = findOurSidebarButton();
    if (btn) {
        let badge = btn.querySelector('.comfy-sidebar-badge');
        if (count > 0) {
            if (!badge) {
                btn.style.position = 'relative';
                badge = document.createElement('div');
                badge.className = 'comfy-sidebar-badge';
                Object.assign(badge.style, {
                    position: 'absolute', top: '2px', right: '2px', background: '#0ea5e9', color: '#fff',
                    borderRadius: '50%', width: '16px', height: '16px', fontSize: '10px', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', pointerEvents: 'none'
                });
                btn.appendChild(badge);
            }
            badge.textContent = count > 99 ? '99+' : count;
        } else if (badge) {
            badge.remove();
        }
    }
}

export function applySidebarOverride() {
    const overrideStock = app.ui.settings?.getSettingValue?.("Comfy Sidebar.Hide Junk.Override Stock Job History Tab") ?? false;
    const stdBtn = findStandardQueueButton();
    const ourBtn = findOurSidebarButton();

    if (stdBtn) {
        if (!stdBtn._originalDisplay) {
            stdBtn._originalDisplay = window.getComputedStyle(stdBtn).display || "block";
        }
        if (overrideStock) {
            stdBtn.style.setProperty("display", "none", "important");
            if (!stdBtn._overrideClickListener) {
                stdBtn._overrideClickListener = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const b = findOurSidebarButton();
                    if (b) b.click();
                };
                stdBtn.addEventListener('click', stdBtn._overrideClickListener, true);
            }
            if (ourBtn && stdBtn.parentNode && ourBtn.nextSibling !== stdBtn) {
                stdBtn.parentNode.insertBefore(ourBtn, stdBtn);
            }
        } else {
            stdBtn.style.setProperty("display", stdBtn._originalDisplay === "none" ? "block" : stdBtn._originalDisplay);
            if (stdBtn._overrideClickListener) {
                stdBtn.removeEventListener('click', stdBtn._overrideClickListener, true);
                stdBtn._overrideClickListener = null;
            }
            if (ourBtn && stdBtn.parentNode && ourBtn.parentNode === stdBtn.parentNode && ourBtn !== stdBtn.parentNode.lastChild) {
                stdBtn.parentNode.appendChild(ourBtn);
            }
        }
    }
}

export function centerAndSelectCanvasNode(nodeId) {
    if (!app.graph || !app.canvas) return false;
    const id = typeof nodeId === "string" ? Number(nodeId) : nodeId;
    const node = app.graph.getNodeById ? (app.graph.getNodeById(id) || app.graph.getNodeById(String(nodeId))) : null;
    if (node) {
        if (app.canvas.centerOnNode) app.canvas.centerOnNode(node);
        if (app.canvas.selectNode) app.canvas.selectNode(node);
        return true;
    }
    return false;
}