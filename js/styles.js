export function injectStyles() {
    if (document.getElementById("comfy-sidebar-styles")) return;
    const style = document.createElement("style");
    style.id = "comfy-sidebar-styles";
    style.textContent = `
        .comfy-sidebar-card {
            background: var(--comfy-input-bg, #181818);
            border-radius: 4px; padding: 8px; position: relative;
            min-height: 80px; margin-bottom: 12px; break-inside: avoid;
            user-select: none; -webkit-user-select: none;
            border: 2px solid var(--border-color, #333);
            color: var(--comfy-input-color, var(--fg-color, #eee));
        }
        .comfy-sidebar-card:hover { 
            border-color: var(--p-primary-color, var(--primary-color, #555)) !important; 
            transition: border-color 0.2s, background-color 0.2s;
        }
        .comfy-sidebar-card.active { --border-color: #3b82f6; --hover-color: #60a5fa; }
        .comfy-sidebar-card.pending { --border-color: #6c757d; --hover-color: #adb5bd; }
        .comfy-sidebar-card.cancelled { --border-color: #ffc107; --hover-color: #ffe082; }
        .comfy-sidebar-card.error { --border-color: #dc3545; --hover-color: #f87171; }
        
        .comfy-sidebar-card.pending .comfy-sidebar-queue-cancel-btn,
        .comfy-sidebar-card.active .comfy-sidebar-queue-cancel-btn { 
            display: none !important; 
        }

        .comfy-sidebar-card.pending:hover .comfy-sidebar-queue-cancel-btn,
        .comfy-sidebar-card.active:hover .comfy-sidebar-queue-cancel-btn { 
            display: flex !important; 
        }
        
        .comfy-sidebar-card-timer {
            position: absolute; top: 6px; left: 8px; font-size: 10px;
            font-family: monospace; opacity: 0.7; background: rgba(0, 0, 0, 0.6);
            padding: 2px 4px; border-radius: 3px; pointer-events: none; z-index: 5; color: #fff;
        }

        .comfy-sidebar-queue-cancel-btn {
            display: none;
            align-items: center !important;
            justify-content: center !important;
            width: 32px !important;
            height: 32px !important;
            background-color: #7f1d1d !important;
            color: #e2e8f0 !important;
            font-size: 11px !important;
            border-radius: 6px !important;
            cursor: pointer !important;
            transition: background-color 0.15s ease, color 0.15s ease !important;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
        }

        .comfy-sidebar-queue-cancel-btn:hover {
            background-color: #991b1b !important;
            color: #ffffff !important;
        }
    `;
    document.head.appendChild(style);
}