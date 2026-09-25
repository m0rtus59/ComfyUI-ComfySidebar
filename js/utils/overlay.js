import { store } from "../core/store.js";
import { findPropertiesPanel } from "../comfy/adapter.js";

export class SidebarOverlay {
    constructor(options = {}) {
        this.onDestroy = options.onDestroy || (() => {});
        this.cleanupFns = [];
        this.observedElements = new Set();

        // Elevate sidebars above overlay
        document.body.classList.add("comfy-sidebar-overlay-active");

        // Root container: visual backdrop (covers 100% flush from sidebar to sidebar, zero gap)
        // pointerEvents is "none" so the 6px edge zones pass mouse events directly to native resize handles
        this.container = document.createElement("div");
        this.container.className = `comfy-sidebar-comparison-overlay ${options.className || ""}`;
        Object.assign(this.container.style, {
            position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh",
            background: options.background || "color-mix(in srgb, var(--comfy-menu-bg, #121212) 95%, transparent)",
            backdropFilter: "blur(8px)",
            color: "var(--fg-color, #eee)",
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", zIndex: "1000", boxSizing: "border-box",
            overflow: "hidden", pointerEvents: "none", userSelect: "none"
        });

        // Interactive backdrop: insets 6px from each sidebar so the border zones pass clicks to the resizers
        this.backdrop = document.createElement("div");
        Object.assign(this.backdrop.style, {
            position: "absolute", top: "0", bottom: "0", left: "6px", right: "6px",
            pointerEvents: "auto", zIndex: "1"
        });
        this.backdrop.addEventListener("click", (e) => {
            if (e.target === this.backdrop) this.destroy();
        });
        this.container.appendChild(this.backdrop);

        // Close button
        this.closeBtn = document.createElement("span");
        this.closeBtn.className = "pi pi-times";
        this.closeBtn.title = "Close (Esc)";
        Object.assign(this.closeBtn.style, {
            position: "absolute", top: "16px", right: "24px", zIndex: "30",
            cursor: "pointer", fontSize: "18px", 
            color: "var(--desc-color, #aaa)", 
            transition: "all 0.15s ease",
            background: "var(--comfy-input-bg, rgba(20, 20, 20, 0.6))", 
            border: "1px solid var(--border-color, rgba(255, 255, 255, 0.1))",
            borderRadius: "50%", padding: "6px", pointerEvents: "auto"
        });
        this.closeBtn.onmouseenter = () => {
            this.closeBtn.style.color = "var(--fg-color, #fff)";
            this.closeBtn.style.borderColor = "var(--fg-color, #fff)";
        };
        this.closeBtn.onmouseleave = () => {
            this.closeBtn.style.color = "var(--desc-color, #aaa)";
            this.closeBtn.style.borderColor = "var(--border-color, rgba(255, 255, 255, 0.1))";
        };

        this.closeBtn.onclick = () => this.destroy();
        this.container.appendChild(this.closeBtn);

        // ResizeObserver to track live drag-resizing on both sidebars
        if (window.ResizeObserver) {
            this.ro = new ResizeObserver(() => {
                this.updateOverlayBounds();
            });
            this.cleanupFns.push(() => this.ro.disconnect());
        }

        // Sidebar boundary alignment
        this.updateOverlayBounds = this.updateOverlayBounds.bind(this);
        this.updateOverlayBounds();
        window.addEventListener("resize", this.updateOverlayBounds);
        this.cleanupFns.push(() => window.removeEventListener("resize", this.updateOverlayBounds));

        // Live observer for opening/closing panels or layout changes
        if (window.MutationObserver) {
            let updateScheduled = false;
            const mo = new MutationObserver(() => {
                if (!updateScheduled) {
                    updateScheduled = true;
                    requestAnimationFrame(() => {
                        this.updateOverlayBounds();
                        updateScheduled = false;
                    });
                }
            });
            mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
            this.cleanupFns.push(() => mo.disconnect());
        }

        // Global Key Handler (Esc to close)
        const onKeyDown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                this.destroy();
            }
            if (options.onKeyDown) options.onKeyDown(e);
        };
        document.addEventListener("keydown", onKeyDown);
        this.cleanupFns.push(() => document.removeEventListener("keydown", onKeyDown));

        document.body.appendChild(this.container);
    }

    observeElement(el) {
        if (!el || !this.ro || this.observedElements.has(el)) return;
        this.observedElements.add(el);
        this.ro.observe(el);
    }

    updateOverlayBounds() {
        const ourSidebar = store.ui.sidebarContainer?.closest('.comfyui-sidebar, .comfy-sidebar, .p-sidebar, [class*="sidebar"]') || store.ui.sidebarContainer;
        const propPanel = findPropertiesPanel();

        if (ourSidebar) this.observeElement(ourSidebar);
        if (propPanel) this.observeElement(propPanel);

        let leftOffset = 0;
        let rightOffset = 0;
        let topOffset = 0;

        const winW = window.innerWidth;
        const midX = winW / 2;

        const checkSidebars = [ourSidebar, propPanel].filter(el => {
            return el && el.offsetWidth > 0 && el.offsetHeight > 0 && el.isConnected;
        });

        for (const el of checkSidebars) {
            const rect = el.getBoundingClientRect();
            
            // Left sidebar boundary (flush with border)
            if (rect.left < midX && rect.right > 0) {
                leftOffset = Math.max(leftOffset, Math.round(rect.right));
            }
            // Right sidebar boundary (flush with border)
            if (rect.right > midX && rect.left < winW) {
                rightOffset = Math.max(rightOffset, Math.round(winW - rect.left));
            }

            // Top boundary alignment
            if (rect.top > 0 && rect.top < 120) {
                topOffset = Math.max(topOffset, Math.round(rect.top));
            }
        }

        leftOffset = Math.max(0, leftOffset);
        rightOffset = Math.max(0, rightOffset);
        topOffset = Math.max(0, topOffset);

        this.container.style.left = `${leftOffset}px`;
        this.container.style.right = `${rightOffset}px`;
        this.container.style.width = `calc(100vw - ${leftOffset + rightOffset}px)`;
        this.container.style.top = `${topOffset}px`;
        this.container.style.height = `calc(100vh - ${topOffset}px)`;

        // Crisp 1px visible separator line along each open sidebar boundary
        this.container.style.borderLeft = leftOffset > 0 ? "1px solid var(--border-color, rgba(255, 255, 255, 0.22))" : "none";
        this.container.style.borderRight = rightOffset > 0 ? "1px solid var(--border-color, rgba(255, 255, 255, 0.22))" : "none";
    }

    addCleanup(fn) {
        this.cleanupFns.push(fn);
    }

    destroy() {
        document.body.classList.remove("comfy-sidebar-overlay-active");

        for (const fn of this.cleanupFns.splice(0)) {
            try { fn(); } catch (e) {}
        }
        this.container.remove();
        this.onDestroy();
    }
}