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

        /* Hover Panels CSS Hover Control */
        .comfy-sidebar-hover-panel,
        .comfy-sidebar-left-hover-panel {
            display: none !important;
        }

        .comfy-sidebar-card:hover .comfy-sidebar-hover-panel,
        .comfy-sidebar-card:hover .comfy-sidebar-left-hover-panel {
            display: flex !important;
        }

        /* Card Action Buttons */
        .comfy-sidebar-card-action-btn {
            display: inline-flex;
            align-items: center !important;
            justify-content: center !important;
            width: 32px !important;
            height: 32px !important;
            background-color: rgba(0, 0, 0, 0.75) !important;
            color: #e2e8f0 !important;
            font-size: 14px !important;
            border-radius: 6px !important;
            cursor: pointer !important;
            transition: all 0.15s ease !important;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
            z-index: 20 !important;
            transform: translateZ(0);
        }

        .comfy-sidebar-card-action-btn:hover {
            background-color: rgba(0, 0, 0, 0.95) !important;
            color: #ffffff !important;
        }

        /* Delete Confirmation Active State */
        .comfy-sidebar-card-action-btn.confirm-delete,
        .comfy-sidebar-card-action-btn.confirm-delete:hover {
            background-color: #dc3545 !important;
            color: #ffffff !important;
            box-shadow: 0 0 8px rgba(220, 53, 69, 0.6) !important;
        }

        /* Header Icons & Header Action Buttons */
        .comfy-sidebar-header-btn {
            background: transparent;
            color: var(--desc-color, #aaa);
            border: 1px solid var(--border-color, #555);
            border-radius: 3px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.15s ease-in-out;
        }

        .comfy-sidebar-header-btn:hover {
            border-color: var(--fg-color, #eee);
            color: var(--fg-color, #eee);
        }

        .comfy-sidebar-icon-btn {
            cursor: pointer;
            font-size: 13px;
            opacity: 0.6;
            transition: opacity 0.15s ease-in-out;
        }

        .comfy-sidebar-icon-btn:hover {
            opacity: 1;
        }

        /* Scroll To Top Floating Button */
        .comfy-sidebar-scroll-top-btn {
            position: absolute;
            bottom: 12px;
            right: 12px;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: rgba(30, 30, 30, 0.9);
            color: #eee;
            border: 1px solid var(--border-color, #555);
            cursor: pointer;
            font-size: 13px;
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.6);
            transition: all 0.15s ease-in-out;
            opacity: 0.85;
        }

        .comfy-sidebar-scroll-top-btn:hover {
            opacity: 1;
            background: var(--p-primary-color, #3b82f6);
            color: #fff;
            border-color: var(--p-primary-color, #3b82f6);
        }
    `;
    document.head.appendChild(style);
}