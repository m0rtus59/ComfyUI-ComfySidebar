export function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
        .comfy-sidebar-card {
            background: var(--comfy-input-bg, #181818);
            border-radius: 4px; padding: 8px; position: relative;
            min-height: 80px; margin-bottom: 12px; break-inside: avoid;
            user-select: none; -webkit-user-select: none;
            transition: border-color 0.2s, background-color 0.2s;
            border: 2px solid var(--border-color, #333);
            color: var(--comfy-input-color, var(--fg-color, #eee));
        }
        .comfy-sidebar-card:hover { border-color: var(--p-primary-color, var(--primary-color, #555)) !important; }
        .comfy-sidebar-card.active { --border-color: #3b82f6; --hover-color: #60a5fa; }
        .comfy-sidebar-card.pending { --border-color: #6c757d; --hover-color: #adb5bd; }
        .comfy-sidebar-card.cancelled { --border-color: #ffc107; --hover-color: #ffe082; }
        .comfy-sidebar-card.error { --border-color: #dc3545; --hover-color: #f87171; }
        
        .comfy-sidebar-card.pending .pi-times { display: none !important; }
        .comfy-sidebar-card.pending:hover .pi-times { display: flex !important; }
        
        .comfy-sidebar-card-timer {
            position: absolute; top: 6px; left: 8px; font-size: 10px;
            font-family: monospace; opacity: 0.7; background: rgba(0, 0, 0, 0.6);
            padding: 2px 4px; border-radius: 3px; pointer-events: none; z-index: 5; color: #fff;
        }
    `;
    document.head.appendChild(style);
}