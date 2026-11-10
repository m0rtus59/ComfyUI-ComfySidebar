export function injectStyles() {
    if (document.getElementById("comfy-sidebar-styles")) return;
    const style = document.createElement("style");
    style.id = "comfy-sidebar-styles";
    style.textContent = `
        .comfy-sidebar-card {
            /* Uses the theme's main elevated surface color (matches folder background identically) */
            background: var(--card, var(--secondary, var(--p-surface-800, color-mix(in srgb, var(--bg-color, var(--comfy-menu-bg, #181818)) 85%, var(--fg-color, #fff) 15%))));
            border-radius: 4px; padding: 8px; position: relative;
            min-height: 80px; margin-bottom: 0px; break-inside: avoid;
            user-select: none; -webkit-user-select: none;
            border: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.12)));
            color: var(--foreground, var(--comfy-input-color, var(--fg-color, #eee)));
            overflow: hidden;
        }
        .comfy-sidebar-card:hover { 
            border-color: color-mix(in srgb, var(--border, var(--border-color, #555)) 50%, var(--foreground, var(--fg-color, #fff)) 50%) !important; 
            background: color-mix(in srgb, var(--card, var(--secondary, var(--p-surface-800, var(--comfy-menu-bg, #262626)))) 85%, var(--foreground, var(--fg-color, #fff)) 15%) !important;
            transition: border-color 0.2s, background-color 0.2s;
        }

        /* Border & Frame Spotlight (Uses the theme's main hue) */
        .comfy-sidebar-card::before,
        .comfy-sidebar-folder-card::before {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: inherit;
            background: radial-gradient(
                160px circle at var(--mouse-x, -999px) var(--mouse-y, -999px),
                color-mix(in srgb, var(--primary, var(--p-primary-color, var(--primary-color, var(--accent, currentColor)))) 60%, transparent),
                transparent 70%
            );
            opacity: 0;
            transition: opacity 0.25s ease;
            pointer-events: none;
            z-index: 1;
        }

        .comfy-sidebar-card:hover::before,
        .comfy-sidebar-folder-card:hover::before {
            opacity: 0.65;
        }
        /* Active job uses the theme accent (orange); Cancelled & Error remain standout Yellow & Red */
        .comfy-sidebar-card.active { border-color: var(--primary, var(--p-primary-color, #ea580c)) !important; --hover-color: var(--primary, var(--p-primary-color, #ea580c)); }
        .comfy-sidebar-card.pending { border-color: #6c757d !important; --hover-color: #adb5bd; }
        .comfy-sidebar-card.cancelled { border-color: #ffc107 !important; --hover-color: #ffe082; }
        .comfy-sidebar-card.error { border-color: #dc3545 !important; --hover-color: #f87171; }

        /* Progress bar track & fill on active cards */
        .comfy-sidebar-card.active [class*="progress"] > div,
        .comfy-sidebar-card.active [class*="progress-fill"],
        .comfy-sidebar-card.active [class*="bar-fill"] {
            background: var(--primary, var(--p-primary-color, #ea580c)) !important;
        }
        
        .comfy-sidebar-card.pending .comfy-sidebar-queue-cancel-btn,
        .comfy-sidebar-card.active .comfy-sidebar-queue-cancel-btn { 
            display: none !important; 
        }

        .comfy-sidebar-card.pending:hover .comfy-sidebar-queue-cancel-btn,
        .comfy-sidebar-card.active:hover .comfy-sidebar-queue-cancel-btn { 
            display: flex !important; 
        }

        /* Prevent action hover buttons from showing on pending & running cards */
        .comfy-sidebar-card.pending .comfy-sidebar-hover-panel,
        .comfy-sidebar-card.active .comfy-sidebar-hover-panel,
        .comfy-sidebar-card.pending .comfy-sidebar-left-hover-panel,
        .comfy-sidebar-card.active .comfy-sidebar-left-hover-panel {
            display: none !important;
        }
        
        .comfy-sidebar-card-timer {
            position: absolute; top: 6px; left: 8px; font-size: 10px;
            font-family: monospace; opacity: 0.7; background: rgba(0, 0, 0, 0.6);
            padding: 2px 4px; border-radius: 3px; pointer-events: none; z-index: 10; color: #fff;
        }

        /* Card Cancel / Interrupt Button - matches native ComfyUI Topbar Cancel */
        .comfy-sidebar-queue-cancel-btn {
            display: none;
            align-items: center !important;
            justify-content: center !important;
            width: 28px !important;
            height: 28px !important;
            background: var(--destructive, var(--p-button-danger-background, #ef4444)) !important;
            color: var(--foreground, var(--fg-color, inherit)) !important;
            border: 1px solid var(--destructive-border, transparent) !important;
            font-size: 12px !important;
            border-radius: 6px !important;
            cursor: pointer !important;
            transition: background-color 0.15s ease, filter 0.15s ease !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25) !important;
            z-index: 25 !important;
        }

        .comfy-sidebar-queue-cancel-btn:hover {
            background: color-mix(in srgb, var(--destructive, var(--p-button-danger-background, #ef4444)) 88%, var(--foreground, #fff) 12%) !important;
            color: var(--foreground, var(--fg-color, inherit)) !important;
            filter: brightness(1.06);
        }

        /* Cancel All Pending Button */
        .comfy-sidebar-cancel-all-btn {
            background: var(--destructive, var(--p-button-danger-background, #ef4444)) !important;
            color: var(--foreground, var(--fg-color, inherit)) !important;
            border: 1px solid var(--destructive-border, transparent) !important;
            border-radius: 6px !important;
            padding: 6px 12px !important;
            cursor: pointer !important;
            font-size: 11px !important;
            font-weight: bold !important;
            width: 100% !important;
            box-sizing: border-box !important;
            transition: background-color 0.15s ease, filter 0.15s ease !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
        }

        .comfy-sidebar-cancel-all-btn:hover {
            background: color-mix(in srgb, var(--destructive, var(--p-button-danger-background, #ef4444)) 88%, var(--foreground, #fff) 12%) !important;
            filter: brightness(1.06);
        }

        .comfy-sidebar-cancel-all-btn:active {
            filter: brightness(0.95);
        }

        .comfy-sidebar-hover-panel,
        .comfy-sidebar-left-hover-panel {
            display: none !important;
        }

        .comfy-sidebar-card:not(.pending):not(.active):hover .comfy-sidebar-hover-panel,
        .comfy-sidebar-card:not(.pending):not(.active):hover .comfy-sidebar-left-hover-panel {
            display: flex !important;
        }

        /* Card Action Buttons */
        .comfy-sidebar-card-action-btn {
            display: inline-flex;
            align-items: center !important;
            justify-content: center !important;
            width: 30px !important;
            height: 30px !important;
            background-color: rgba(0, 0, 0, 0.75) !important;
            color: #e2e8f0 !important;
            font-size: 13px !important;
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

        /* Disk Delete Confirmation */
        .comfy-sidebar-card-action-btn.confirm-delete-disk,
        .comfy-sidebar-card-action-btn.confirm-delete-disk:hover {
            background-color: #7f1d1d !important;
            color: #ffc9c9 !important;
            box-shadow: 0 0 10px rgba(220, 38, 38, 0.85) !important;
            border: 1px solid #ef4444 !important;
        }

        /* Dynamic Ctrl Key Hover State */
        .comfy-sidebar-del-label {
            display: none;
            margin-left: 5px;
            font-size: 10px;
            font-weight: bold;
            white-space: nowrap;
            font-family: sans-serif;
            letter-spacing: 0.3px;
        }

        body.comfy-sidebar-ctrl-active .comfy-sidebar-card-action-btn:not(.comfy-sidebar-btn-del) {
            display: none !important;
        }

        body.comfy-sidebar-ctrl-active .comfy-sidebar-left-hover-panel {
            display: none !important;
        }

        body.comfy-sidebar-ctrl-active .comfy-sidebar-btn-del {
            background-color: #991b1b !important;
            color: #ffffff !important;
            border: 1px solid #ef4444 !important;
            width: auto !important;
            padding: 0 8px !important;
            border-radius: 6px !important;
            box-shadow: 0 0 10px rgba(239, 68, 68, 0.6) !important;
        }

        body.comfy-sidebar-ctrl-active .comfy-sidebar-btn-del .comfy-sidebar-del-label {
            display: inline;
        }

        /* Translucent Folder Indicator on Ctrl Press */
        .comfy-sidebar-ctrl-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: color-mix(in srgb, var(--card, var(--secondary, #12071f)) 85%, transparent);
            backdrop-filter: blur(3px);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 6px;
            color: var(--primary, var(--p-primary-color, #ea580c));
            z-index: 15;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s ease;
            border-radius: 4px;
        }

        .comfy-sidebar-ctrl-overlay i {
            font-size: 26px;
            filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6));
        }

        .comfy-sidebar-ctrl-overlay span {
            font-size: 11px;
            font-weight: bold;
            color: #f1f5f9;
            font-family: sans-serif;
            letter-spacing: 0.5px;
            text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
        }

        body.comfy-sidebar-ctrl-active .comfy-sidebar-card:not(.pending):not(.active):hover .comfy-sidebar-ctrl-overlay {
            opacity: 1;
        }

        .comfy-sidebar-header-btn {
            background: var(--card, var(--secondary, var(--p-surface-800, rgba(255, 255, 255, 0.05))));
            color: var(--muted-foreground, var(--desc-color, #aaa));
            border: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.15)));
            border-radius: 4px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.15s ease-in-out;
        }

        .comfy-sidebar-header-btn:hover {
            border-color: color-mix(in srgb, var(--border, var(--border-color, #a855f7)) 65%, var(--foreground, #fff) 35%);
            color: var(--foreground, #fff);
            background: color-mix(in srgb, var(--card, var(--secondary, rgba(255, 255, 255, 0.12))) 65%, var(--border, var(--border-color, #a855f7)) 35%);
        }

        .comfy-sidebar-icon-btn {
            cursor: pointer;
            font-size: 13px;
            opacity: 0.6;
            color: var(--foreground, var(--fg-color, inherit));
            transition: opacity 0.15s ease-in-out, color 0.15s ease-in-out;
        }

        .comfy-sidebar-icon-btn:hover {
            opacity: 1;
            color: var(--primary, var(--p-primary-color, inherit));
        }

        .comfy-sidebar-scroll-top-btn {
            position: absolute;
            bottom: 14px;
            right: 28px;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: var(--card, var(--secondary, rgba(30, 30, 30, 0.9)));
            color: var(--foreground, #eee);
            border: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.15)));
            cursor: pointer;
            font-size: 13px;
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            transition: all 0.15s ease-in-out;
            opacity: 0.85;
        }

        .comfy-sidebar-scroll-top-btn:hover {
            opacity: 1;
            background: var(--primary, var(--p-primary-color, #ea580c));
            color: #fff;
            border-color: var(--primary, var(--p-primary-color, #ea580c));
        }

        /* 3D Preview Cards */
        .comfy-sidebar-3d-wrapper {
            width: 100%;
            height: 160px;
            background: linear-gradient(135deg, #1e1e2e 0%, #0f172a 100%);
            border-radius: 4px;
            display: flex;
            position: relative;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.12);
            transition: all 0.2s ease-in-out;
            user-select: none;
            cursor: pointer;
        }

        .comfy-sidebar-3d-wrapper:hover {
            border-color: var(--primary, var(--p-primary-color, #ea580c));
            box-shadow: 0 0 12px color-mix(in srgb, var(--primary, #ea580c) 35%, transparent);
        }

        .comfy-sidebar-3d-preview-img {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            filter: brightness(0.45);
            transition: filter 0.2s ease, transform 0.2s ease;
            pointer-events: none;
            z-index: 1;
        }

        .comfy-sidebar-3d-wrapper:hover .comfy-sidebar-3d-preview-img {
            filter: brightness(0.6);
            transform: scale(1.03);
        }

        .comfy-sidebar-3d-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 2;
            pointer-events: none;
        }

        .comfy-sidebar-3d-icon {
            font-size: 38px;
            color: #60a5fa;
            margin-bottom: 6px;
            filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.8));
            transition: transform 0.2s ease;
        }

        .comfy-sidebar-3d-wrapper:hover .comfy-sidebar-3d-icon {
            transform: scale(1.1) rotate(6deg);
        }

        .comfy-sidebar-3d-badge {
            position: absolute;
            top: 6px;
            right: 6px;
            background: rgba(59, 130, 246, 0.9);
            color: #fff;
            font-size: 9px;
            font-weight: bold;
            padding: 2px 6px;
            border-radius: 3px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
            z-index: 3;
        }

        .comfy-sidebar-3d-title {
            font-size: 10px;
            color: #f1f5f9;
            font-family: monospace;
            max-width: 85%;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            background: rgba(0, 0, 0, 0.65);
            padding: 2px 6px;
            border-radius: 3px;
            backdrop-filter: blur(2px);
            z-index: 3;
        }

        /* Audio Preview Cards */
        /* Generic Background Thumbnail for Non-Image Cards (Audio, 3D, File) */
        .comfy-sidebar-card-bg-img {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            filter: brightness(0.35);
            transition: filter 0.2s ease, transform 0.2s ease;
            pointer-events: none;
            z-index: 1;
        }

        .comfy-sidebar-audio-wrapper:hover .comfy-sidebar-card-bg-img,
        .comfy-sidebar-file-wrapper:hover .comfy-sidebar-card-bg-img {
            filter: brightness(0.5);
            transform: scale(1.03);
        }

        .comfy-sidebar-audio-wrapper {
            width: 100%;
            min-height: 110px;
            background: linear-gradient(135deg, #1e1333 0%, #0f172a 100%);
            border-radius: 4px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 10px 12px 12px 12px;
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.12);
            transition: all 0.2s ease-in-out;
            user-select: none;
            cursor: pointer;
        }

        .comfy-sidebar-audio-wrapper:hover {
            border-color: #a855f7;
            box-shadow: 0 0 12px rgba(168, 85, 247, 0.35);
        }

        .comfy-sidebar-audio-badge {
            background: rgba(168, 85, 247, 0.9);
            color: #fff;
            font-size: 9px;
            font-weight: bold;
            padding: 2px 6px;
            border-radius: 3px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
            z-index: 3;
        }

        .comfy-sidebar-audio-title {
            font-size: 10px;
            color: #f1f5f9;
            font-family: monospace;
            max-width: 65%;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            z-index: 3;
        }

        .comfy-sidebar-soundwave-container {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 3px;
            height: 36px;
            margin: 4px 0;
        }

        .comfy-sidebar-soundwave-bar {
            width: 3px;
            background: #a855f7;
            border-radius: 2px;
            height: 8px;
            transition: height 0.1s ease, background-color 0.2s ease;
        }

        .comfy-sidebar-audio-wrapper.playing .comfy-sidebar-soundwave-bar {
            background: #c084fc;
            animation: comfySidebarWave 1s ease-in-out infinite alternate;
        }

        @keyframes comfySidebarWave {
            0% { transform: scaleY(0.4); }
            100% { transform: scaleY(1.3); }
        }

        /* Generic File Preview Cards */
        .comfy-sidebar-file-wrapper {
            width: 100%;
            min-height: 88px;
            background: linear-gradient(135deg, #131d2e 0%, #0b1120 100%);
            border-radius: 4px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 8px 10px;
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.12);
            transition: all 0.2s ease-in-out;
            user-select: none;
            cursor: pointer;
            gap: 8px;
        }

        .comfy-sidebar-file-wrapper:hover {
            border-color: var(--primary, var(--p-primary-color, #ea580c));
            box-shadow: 0 0 14px color-mix(in srgb, var(--primary, #ea580c) 35%, transparent);
            transform: translateY(-1px);
        }

        .comfy-sidebar-file-badge {
            background: var(--primary, var(--p-primary-color, #ea580c));
            color: #fff;
            font-size: 9px;
            font-weight: bold;
            padding: 0 6px;
            height: 18px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
            border-radius: 3px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
            flex-shrink: 0;
            white-space: nowrap;
        }

        .comfy-sidebar-file-title {
            font-size: 11px;
            color: #f1f5f9;
            font-family: monospace;
            font-weight: 600;
            word-break: break-all;
            line-height: 1.4;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .comfy-sidebar-file-icon {
            font-size: 14px;
            color: #38bdf8;
            flex-shrink: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transform: translateY(-3px);
        }

        .comfy-sidebar-file-subtext {
            font-size: 9px;
            color: #94a3b8;
            font-family: sans-serif;
            display: flex;
            align-items: center;
            gap: 4px;
            opacity: 0.9;
        }

        .comfy-sidebar-text-clamp {
            font-size: 11px;
            line-height: 1.45;
            color: var(--foreground, #cbd5e1);
            max-height: 84px;
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 4;
            -webkit-box-orient: vertical;
            cursor: pointer;
            padding: 8px 10px;
            /* Solid theme surface that sits above the spotlight, keeping text crisp and readable */
            background: var(--card, var(--secondary, var(--p-surface-800, #181818)));
            border-radius: 4px;
            border: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.12)));
            margin-top: 18px;
            word-break: break-word;
            transition: all 0.15s ease-in-out;
            position: relative;
            z-index: 2;
        }

        .comfy-sidebar-text-clamp:hover {
            /* Follows the theme accent (orange) */
            border-color: var(--primary, var(--p-primary-color, #ea580c));
            background: color-mix(in srgb, var(--primary, var(--p-primary-color, #ea580c)) 6%, var(--card, var(--secondary, #181818)) 94%);
        }

        /* Translucent theme backdrop behind Text Reader & Fullscreen Previews */
        .comfy-sidebar-comparison-overlay,
        .comfy-sidebar-overlay,
        body.comfy-sidebar-overlay-active > div[style*="position: fixed"],
        body.comfy-sidebar-overlay-active > div[style*="position:fixed"] {
            background: color-mix(in srgb, var(--background, var(--card, var(--comfy-menu-bg, #13091f))) 82%, transparent) !important;
            backdrop-filter: blur(10px) !important;
            -webkit-backdrop-filter: blur(10px) !important;
        }

        /* Comparison Media: Ensures no borders or outlines appear on compared images */
        .comfy-sidebar-comparison-media {
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
        }

        /* Comparison Slider Line & Handle */
        .comfy-sidebar-comparison-slider {
            background: var(--foreground, #ffffff) !important;
            box-shadow: 0 0 6px rgba(0, 0, 0, 0.6) !important;
        }

        .comfy-sidebar-comparison-handle {
            width: 32px !important;
            height: 32px !important;
            border-radius: 50% !important;
            background: var(--card, var(--secondary, rgba(30, 30, 30, 0.9))) !important;
            border: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.15))) !important;
            color: var(--foreground, #eee) !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
            cursor: ew-resize !important;
            transition: background-color 0.15s ease-in-out, border-color 0.15s ease-in-out, color 0.15s ease-in-out !important;
        }

        .comfy-sidebar-comparison-handle:hover {
            background: var(--primary, var(--p-primary-color, #ea580c)) !important;
            border-color: var(--primary, var(--p-primary-color, #ea580c)) !important;
            color: #ffffff !important;
        }

        /* Round (X) Close Button across all preview overlays (matches buttons, ignores images/sliders) */
        body.comfy-sidebar-overlay-active button[style*="50%"],
        body.comfy-sidebar-overlay-active [style*="border-radius: 50%"]:not(img):not(video):not(.comfy-sidebar-comparison-handle):not(.comfy-sidebar-comparison-slider):not(.comfy-sidebar-comparison-media),
        body.comfy-sidebar-overlay-active [style*="border-radius:50%"]:not(img):not(video):not(.comfy-sidebar-comparison-handle):not(.comfy-sidebar-comparison-slider):not(.comfy-sidebar-comparison-media),
        .comfy-sidebar-comparison-overlay button[style*="50%"],
        div[class*="sidebar-overlay"] button[style*="50%"] {
            background: var(--card, var(--secondary, rgba(30, 30, 30, 0.9))) !important;
            border: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.15))) !important;
            color: var(--foreground, #eee) !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
            transition: all 0.15s ease-in-out !important;
        }

        body.comfy-sidebar-overlay-active button[style*="50%"]:hover,
        body.comfy-sidebar-overlay-active [style*="border-radius: 50%"]:not(img):not(video):not(.comfy-sidebar-comparison-handle):not(.comfy-sidebar-comparison-slider):not(.comfy-sidebar-comparison-media):hover,
        body.comfy-sidebar-overlay-active [style*="border-radius:50%"]:not(img):not(video):not(.comfy-sidebar-comparison-handle):not(.comfy-sidebar-comparison-slider):not(.comfy-sidebar-comparison-media):hover,
        .comfy-sidebar-comparison-overlay button[style*="50%"]:hover,
        div[class*="sidebar-overlay"] button[style*="50%"]:hover {
            color: #ffffff !important;
            border-color: var(--primary, var(--p-primary-color, #ea580c)) !important;
            background: var(--primary, var(--p-primary-color, #ea580c)) !important;
        }

        body.comfy-sidebar-overlay-active [style*="50%"] svg,
        body.comfy-sidebar-overlay-active [style*="50%"] i,
        body.comfy-sidebar-overlay-active [style*="50%"] line,
        body.comfy-sidebar-overlay-active [style*="50%"] path {
            stroke: currentColor !important;
            color: inherit !important;
        }

        /* Elevate outer sidebar dock containers above the preview overlay */
        body.comfy-sidebar-overlay-active aside,
        body.comfy-sidebar-overlay-active nav,
        body.comfy-sidebar-overlay-active .comfyui-sidebar,
        body.comfy-sidebar-overlay-active .side-tool-bar-container,
        body.comfy-sidebar-overlay-active .sidebar-content-container,
        body.comfy-sidebar-overlay-active .comfyui-sidebar-content,
        body.comfy-sidebar-overlay-active .p-sidebar,
        body.comfy-sidebar-overlay-active .p-sidebar-right,
        body.comfy-sidebar-overlay-active [data-testid="properties-panel"],
        body.comfy-sidebar-overlay-active [data-testid="workflow-overview-panel"],
        body.comfy-sidebar-overlay-active [class*="properties-panel"],
        body.comfy-sidebar-overlay-active [class*="resize-handle"],
        body.comfy-sidebar-overlay-active [class*="resizer"],
        body.comfy-sidebar-overlay-active [class*="splitter"],
        body.comfy-sidebar-overlay-active [class*="gutter"],
        body.comfy-sidebar-overlay-active [role="separator"] {
            z-index: 1005 !important;
        }

        /* Media and text wrappers sit on z-index 2 so the spotlight shines on the border behind them */
        .comfy-sidebar-card .comfy-sidebar-media-wrapper,
        .comfy-sidebar-card .comfy-sidebar-text-clamp {
            z-index: 2 !important;
            position: relative;
        }
        .comfy-sidebar-card-timer {
            z-index: 10 !important;
        }
        .comfy-sidebar-queue-cancel-btn {
            z-index: 25 !important;
        }
        .comfy-sidebar-status-badge {
            z-index: 30 !important;
        }

        /* Sidebar Tab Counter Badge (Queue count) */
        .side-tool-bar-container [class*="badge"],
        .comfyui-sidebar [class*="badge"],
        nav [class*="badge"],
        aside [class*="badge"],
        .side-tool-bar-end [class*="badge"],
        button:has(.pi-images) + span,
        button:has([class*="queue"]) + span {
            background-color: var(--primary, var(--p-primary-color, #ea580c)) !important;
            background: var(--primary, var(--p-primary-color, #ea580c)) !important;
            color: var(--primary-foreground, #ffffff) !important;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4) !important;
        }

        /* Slim down the Queue sidebar scrollbar so it stops colliding with the separator */
        .comfyui-sidebar ::-webkit-scrollbar,
        .comfy-sidebar ::-webkit-scrollbar,
        [class*="sidebar-content"] ::-webkit-scrollbar,
        .sidebar-content-container ::-webkit-scrollbar {
            width: 6px !important;
        }
        .comfyui-sidebar ::-webkit-scrollbar-thumb,
        .comfy-sidebar ::-webkit-scrollbar-thumb,
        [class*="sidebar-content"] ::-webkit-scrollbar-thumb,
        .sidebar-content-container ::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.25) !important;
            border-radius: 3px !important;
        }

        /* Gallery delete button only shows in the Ctrl alternative actions menu */
        .comfy-sidebar-gallery-btn-del {
            display: none !important;
        }
        body.comfy-sidebar-ctrl-active .comfy-sidebar-gallery-btn-del,
        .comfy-sidebar-gallery-btn-del.confirm-delete,
        .comfy-sidebar-gallery-btn-del.confirm-delete-disk {
            display: inline-flex !important;
        }

        /* Sticky Header & Nav Reveal (Seamlessly transparent at rest, frosted on scroll) */
        .comfy-sidebar-sticky-header-group {
            position: sticky;
            top: 0;
            margin: -14px -14px 6px -14px;
            padding: 14px 14px 0 14px;
            background: transparent;
            z-index: 35;
            transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s ease, box-shadow 0.2s ease;
            will-change: transform;
        }

        .comfy-sidebar-sticky-header-group.is-scrolled {
            background: color-mix(in srgb, var(--card, var(--secondary, var(--background, var(--bg-color, #181818)))) 75%, transparent);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
            border-bottom: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.08)));
        }

        /* Gallery Subfolders & Breadcrumb Styles */
        .comfy-sidebar-breadcrumb-bar {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: var(--muted-foreground, var(--desc-color, #aaa));
            overflow-x: auto;
            white-space: nowrap;
            padding: 4px 0 8px 0;
            border-bottom: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.08)));
            margin-bottom: 10px;
        }
        .comfy-sidebar-breadcrumb-item {
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 3px;
            background: var(--card, var(--secondary, var(--p-surface-800, rgba(255, 255, 255, 0.05))));
            border: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.08)));
            transition: all 0.15s ease-in-out;
            color: var(--foreground, var(--fg-color, #eee));
            text-decoration: none;
        }
        .comfy-sidebar-breadcrumb-item:hover {
            background: color-mix(in srgb, var(--primary, var(--p-primary-color, #38bdf8)) 25%, transparent);
            border-color: var(--primary, var(--p-primary-color, #38bdf8));
            color: #fff;
        }
        .comfy-sidebar-breadcrumb-sep {
            opacity: 0.4;
            font-size: 10px;
        }

        .comfy-sidebar-folders-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
            gap: 8px;
            margin-bottom: 12px;
            width: 100%;
        }
        .comfy-sidebar-folder-card {
            /* Uses the theme's main elevated surface color */
            background: var(--card, var(--secondary, var(--p-surface-800, color-mix(in srgb, var(--bg-color, var(--comfy-menu-bg, #181818)) 85%, var(--fg-color, #fff) 15%))));
            border-radius: 4px;
            padding: 8px 10px;
            border: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.12)));
            color: var(--foreground, var(--comfy-input-color, var(--fg-color, #eee)));
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
            user-select: none;
            min-width: 0;
            position: relative;
            overflow: hidden;
        }
        .comfy-sidebar-folder-card:hover {
            border-color: color-mix(in srgb, var(--border, var(--border-color, #555)) 50%, var(--foreground, var(--fg-color, #fff)) 50%);
            background: color-mix(in srgb, var(--card, var(--secondary, var(--p-surface-800, var(--comfy-menu-bg, #262626)))) 85%, var(--foreground, var(--fg-color, #fff)) 15%);
        }
        .comfy-sidebar-folder-icon {
            font-size: 16px;
            /* Keeps the accent color (orange, blue, or purple) strictly for the icon */
            color: var(--primary, var(--p-primary-color, var(--primary-color, #38bdf8)));
            flex-shrink: 0;
        }
        body.comfy-sidebar-ctrl-active .comfy-sidebar-folder-card:hover {
            cursor: alias !important;
            border-color: var(--primary, var(--p-primary-color, var(--primary-color, #a855f7))) !important;
            box-shadow: 0 0 0 1px var(--primary, var(--p-primary-color, var(--primary-color, #a855f7))), 0 0 10px rgba(168, 85, 247, 0.3) !important;
            background: color-mix(in srgb, var(--primary, var(--p-primary-color, var(--primary-color, #a855f7))) 15%, transparent) !important;
        }
        .comfy-sidebar-folder-name {
            font-size: 11px;
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
        }

        .comfy-sidebar-card-filename-badge {
            position: absolute;
            top: 6px;
            right: 8px;
            font-size: 10px;
            font-family: monospace;
            opacity: 0.7;
            background: rgba(0, 0, 0, 0.6);
            padding: 2px 4px;
            border-radius: 3px;
            pointer-events: none;
            z-index: 5;
            color: #fff;
            max-width: 62%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            transform: translateZ(0);
        }

        /* Folder card layout & Ctrl overlay support */
        .comfy-sidebar-folder-card {
            position: relative;
            overflow: hidden;
        }
        body.comfy-sidebar-ctrl-active .comfy-sidebar-folder-card:hover .comfy-sidebar-ctrl-overlay {
            display: flex;
        }

        /* Comparison selected image */
        .comfy-sidebar-card.comfy-sidebar-comparison-source {
            outline: 2px solid #eab308 !important;
            box-shadow: 0 0 12px rgba(234, 179, 8, 0.5);
        }

        /* Smooth animation for the circular loader */
        @keyframes comfy-sidebar-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        /* Runtime Preview Dock in Properties Panel */
        .comfy-sidebar-runtime-preview-dock {
            position: sticky;
            bottom: 0px;
            left: 0px;
            width: 100%;
            padding: 8px 12px;
            box-sizing: border-box;
            background: color-mix(in srgb, var(--card, var(--bg-color, var(--comfy-menu-bg, #181818))) 85%, transparent);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-top: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.12)));
            z-index: 20;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: auto;
        }

        .comfy-sidebar-runtime-preview-btn {
            width: 100%;
            height: 34px;
            border-radius: 6px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-size: 12px;
            font-weight: 600;
            font-family: inherit;
            transition: all 0.15s ease-in-out;
            outline: none;
            box-sizing: border-box;
            background: var(--card, var(--secondary, rgba(255, 255, 255, 0.05)));
            border: 1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.15)));
            color: var(--muted-foreground, var(--desc-color, #aaa));
            box-shadow: none;
        }

        .comfy-sidebar-runtime-preview-btn:hover {
            border-color: color-mix(in srgb, var(--primary, var(--p-primary-color, #ea580c)) 65%, var(--border, #666) 35%);
            color: var(--foreground, #fff);
            background: color-mix(in srgb, var(--primary, var(--p-primary-color, #ea580c)) 8%, var(--card, rgba(255, 255, 255, 0.08)) 92%);
        }

        .comfy-sidebar-runtime-preview-btn.active {
            background: color-mix(in srgb, var(--primary, var(--p-primary-color, var(--primary-color, #ea580c))) 18%, transparent) !important;
            border: 1px solid var(--primary, var(--p-primary-color, var(--primary-color, #ea580c))) !important;
            color: var(--primary, var(--p-primary-color, var(--primary-color, #ea580c))) !important;
            box-shadow: 0 0 10px color-mix(in srgb, var(--primary, var(--p-primary-color, var(--primary-color, #ea580c))) 35%, transparent) !important;
        }

        .comfy-sidebar-runtime-preview-btn.active:hover {
            filter: brightness(1.1);
        }
    `;
    document.head.appendChild(style);
}