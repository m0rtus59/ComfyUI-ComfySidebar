import { State } from "./state.js";

export class SidebarOverlay {
    constructor(options = {}) {
        this.onDestroy = options.onDestroy || (() => {});
        this.cleanupFns = [];

        // Root container
        this.container = document.createElement("div");
        this.container.className = `comfy-sidebar-comparison-overlay ${options.className || ""}`;
        Object.assign(this.container.style, {
            position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh",
            background: options.background || "rgba(10, 10, 10, 0.95)",
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", zIndex: "1000", boxSizing: "border-box",
            overflow: "hidden", pointerEvents: "auto", userSelect: "none"
        });

        // Close button
        this.closeBtn = document.createElement("span");
        this.closeBtn.className = "pi pi-times";
        this.closeBtn.title = "Close (Esc)";
        Object.assign(this.closeBtn.style, {
            position: "absolute", top: "16px", right: "24px", zIndex: "30",
            cursor: "pointer", fontSize: "20px", color: "#aaa", transition: "color 0.15s ease",
            background: "rgba(10,10,10,0.6)", borderRadius: "50%", padding: "4px"
        });
        this.closeBtn.onmouseenter = () => this.closeBtn.style.color = "#fff";
        this.closeBtn.onmouseleave = () => this.closeBtn.style.color = "#aaa";
        this.closeBtn.onclick = () => this.destroy();
        this.container.appendChild(this.closeBtn);

        // Backdrop click to close
        this.container.addEventListener("click", (e) => {
            if (e.target === this.container) this.destroy();
        });

        // Sidebar boundary alignment
        this.updateOverlayBounds = this.updateOverlayBounds.bind(this);
        this.updateOverlayBounds();
        window.addEventListener("resize", this.updateOverlayBounds);
        this.cleanupFns.push(() => window.removeEventListener("resize", this.updateOverlayBounds));

        const sidebarEl = State.sidebarContainer?.closest('.comfyui-sidebar, .comfy-sidebar, .p-sidebar, [class*="sidebar"]') || State.sidebarContainer;
        if (sidebarEl && window.ResizeObserver) {
            const ro = new ResizeObserver(this.updateOverlayBounds);
            ro.observe(sidebarEl);
            this.cleanupFns.push(() => ro.disconnect());
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

    updateOverlayBounds() {
        const sidebarEl = State.sidebarContainer?.closest('.comfyui-sidebar, .comfy-sidebar, .p-sidebar, [class*="sidebar"]') || State.sidebarContainer;
        if (sidebarEl && sidebarEl.offsetWidth > 0 && sidebarEl.isConnected) {
            const rect = sidebarEl.getBoundingClientRect();
            if (rect.left < window.innerWidth / 2) {
                const leftOffset = Math.max(0, rect.right);
                this.container.style.left = `${leftOffset}px`;
                this.container.style.width = `calc(100vw - ${leftOffset}px)`;
                this.container.style.right = "0px";
            } else {
                const rightOffset = Math.max(0, window.innerWidth - rect.left);
                this.container.style.left = "0px";
                this.container.style.width = `calc(100vw - ${rightOffset}px)`;
                this.container.style.right = `${rightOffset}px`;
            }
            this.container.style.top = `${Math.max(0, rect.top)}px`;
            this.container.style.height = `calc(100vh - ${Math.max(0, rect.top)}px)`;
        } else {
            this.container.style.left = "0px";
            this.container.style.width = "100vw";
            this.container.style.top = "0px";
            this.container.style.height = "100vh";
        }
    }

    addCleanup(fn) {
        this.cleanupFns.push(fn);
    }

    destroy() {
        for (const fn of this.cleanupFns.splice(0)) {
            try { fn(); } catch (e) {}
        }
        this.container.remove();
        this.onDestroy();
    }
}