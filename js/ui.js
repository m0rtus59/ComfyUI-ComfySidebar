import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { State, promptStates, cardElements, saveStatesToLocalStorage } from "./state.js";
import { isVideoFormat, matchesFilter, getRunOutputs } from "./utils.js";
import { showFullscreenPreview } from "./comparison.js";

// DI Hook for cyclic imports
export let syncQueueFn = async () => {};
export function setSyncQueue(fn) { syncQueueFn = fn; }

// Resets any stale hover states when transitioning between submenus and the main queue
function resetAllCardHoverStates() {
    for (const cardObj of cardElements.values()) {
        if (cardObj.hoverPanel) cardObj.hoverPanel.style.display = "none";
        if (cardObj.leftHoverPanel) cardObj.leftHoverPanel.style.display = "none";
    }
}

// Traverses node execution metadata to resolve the exact node ID that generated a specific image
function findNodeIdForImage(state, img) {
    if (!state || !state.nodeOutputs || !img) return null;
    for (const nodeId in state.nodeOutputs) {
        const out = state.nodeOutputs[nodeId];
        // Safely check both gifs, images, or videos under this specific node
        for (const key in out) {
            const val = out[key];
            if (Array.isArray(val)) {
                if (val.some(i => i && typeof i === 'object' && i.filename === img.filename)) {
                    return nodeId;
                }
            } else if (val && typeof val === 'object' && val.filename === img.filename) {
                return nodeId;
            }
        }
    }
    return null;
}

export const updateSidebarBadge = (count) => {
    const icons = document.querySelectorAll('.pi-images');
    icons.forEach(icon => {
        const btn = icon.closest('.comfyui-sidebar-tab, button, [role="tab"]');
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
    });
};

export const findOurSidebarButton = () => {
    const icon = document.querySelector('.pi-images');
    return icon ? icon.closest('.comfyui-sidebar-tab, button, [role="tab"]') : null;
};

export const findStandardQueueButton = () => {
    for (const iconSelector of [".pi-history", ".pi-clock", ".pi-server", ".pi-list", ".pi-sliders-h"]) {
        const icon = document.querySelector(iconSelector);
        if (icon) {
            const btn = icon.closest('.comfyui-sidebar-tab, button, [role="tab"]');
            if (btn && !btn.querySelector('.pi-images')) return btn;
        }
    }
    const buttons = document.querySelectorAll('.comfyui-sidebar-tab, button, [role="tab"]');
    for (const btn of buttons) {
        const title = btn.title || btn.getAttribute('aria-label') || '';
        if ((title.toLowerCase().includes('queue') || title.toLowerCase().includes('history')) && !btn.querySelector('.pi-images') && !btn.id?.includes('classic-comfy-sidebar')) return btn;
    }
    return null;
};

export const applySidebarOverride = () => {
    const overrideStock = app.ui.settings.getSettingValue("Comfy Sidebar.Hide Junk.Override Stock Job History Tab") ?? false;
    const stdBtn = findStandardQueueButton();
    const ourBtn = findOurSidebarButton();
    
    if (stdBtn) {
        if (!stdBtn._originalDisplay) stdBtn._originalDisplay = window.getComputedStyle(stdBtn).display || "block";
        if (overrideStock) {
            stdBtn.style.setProperty("display", "none", "important");
            if (!stdBtn._overrideClickListener) {
                stdBtn._overrideClickListener = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    const b = findOurSidebarButton();
                    if (b) b.click();
                };
                stdBtn.addEventListener('click', stdBtn._overrideClickListener, true);
            }
            if (ourBtn && stdBtn.parentNode && ourBtn.nextSibling !== stdBtn) stdBtn.parentNode.insertBefore(ourBtn, stdBtn);
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
};

export function setupSidebarUI() {
    State.sidebarContainer = document.createElement("div");
    Object.assign(State.sidebarContainer.style, {
        display: "flex", flexDirection: "column", height: "100%", padding: "14px", boxSizing: "border-box",
        background: "var(--comfy-menu-bg, #121212)", color: "var(--fg-color, #eee)"
    });

    const header = document.createElement("div");
    Object.assign(header.style, { position: "relative", marginBottom: "12px", height: "26px", display: "flex", alignItems: "center" });

    const standardHeader = document.createElement("div");
    Object.assign(standardHeader.style, { display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" });

    const titleGroup = document.createElement("div");
    Object.assign(titleGroup.style, { display: "flex", alignItems: "center", gap: "8px" });

    const searchIcon = document.createElement("span");
    searchIcon.className = "pi pi-search";
    searchIcon.title = "Search History";
    Object.assign(searchIcon.style, { cursor: "pointer", fontSize: "13px", opacity: "0.6", transition: "opacity 0.15s ease-in-out" });
    searchIcon.onmouseenter = () => searchIcon.style.opacity = "1";
    searchIcon.onmouseleave = () => searchIcon.style.opacity = "0.6";

    const title = document.createElement("h3");
    title.textContent = "Queue";
    Object.assign(title.style, { margin: "0", fontSize: "14px", fontWeight: "bold", opacity: "0.9", color: "var(--fg-color, #eee)" });

    titleGroup.appendChild(searchIcon);
    titleGroup.appendChild(title);
    standardHeader.appendChild(titleGroup);

    // Dynamic Compact Actions Group
    const actionsGroup = document.createElement("div");
    Object.assign(actionsGroup.style, { display: "flex", gap: "6px", alignItems: "center" });

    const createActionBtn = (iconClass, tooltip, hoverColor, onClickFn) => {
        const btn = document.createElement("button");
        btn.className = iconClass;
        btn.title = tooltip;
        Object.assign(btn.style, {
            background: "transparent", color: "var(--desc-color, #aaa)", border: "1px solid var(--border-color, #555)",
            borderRadius: "3px", padding: "4px 8px", cursor: "pointer", fontSize: "13px", transition: "all 0.15s ease-in-out"
        });

        let timeout = null, isPending = false;
        const reset = () => {
            isPending = false;
            Object.assign(btn.style, { color: "var(--desc-color, #aaa)", background: "transparent", borderColor: "var(--border-color, #555)", boxShadow: "none" });
            if (timeout) { clearTimeout(timeout); timeout = null; }
        };

        btn.onmouseenter = () => { if (!isPending) { btn.style.borderColor = "var(--fg-color, #eee)"; btn.style.color = "var(--fg-color, #eee)"; } };
        btn.onmouseleave = () => { if (!isPending) { btn.style.borderColor = "var(--border-color, #555)"; btn.style.color = "var(--desc-color, #aaa)"; } };

        btn.onclick = async (ev) => {
            ev.stopPropagation();
            if (!isPending) {
                isPending = true;
                Object.assign(btn.style, { color: "#fff", background: hoverColor, borderColor: hoverColor, boxShadow: `0 0 8px ${hoverColor}80` });
                timeout = setTimeout(reset, 1500); // 1.5s to confirm
            } else {
                reset();
                await onClickFn();
            }
        };
        return btn;
    };

    const btnClearInterrupted = createActionBtn("pi pi-eraser", "Clear Cancelled & Failed", "#ffc107", async () => {
        const toDelete = [];
        for (const [pid, state] of promptStates.entries()) {
            if (state.status === "cancelled" || state.status === "error") {
                toDelete.push(pid);
                promptStates.delete(pid);
            }
        }
        if (toDelete.length > 0) {
            try { await api.fetchApi("/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: toDelete }) }); } catch (err) {}
            renderDOM();
        }
    });

    const btnClearAll = createActionBtn("pi pi-trash", "Clear All History", "#dc3545", async () => {
        for (const [pid, state] of promptStates.entries()) {
            if (state.status !== "pending" && state.status !== "active") {
                promptStates.delete(pid);
            }
        }
        try { await api.fetchApi("/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); } catch (err) {}
        renderDOM();
    });

    actionsGroup.appendChild(btnClearInterrupted);
    actionsGroup.appendChild(btnClearAll);
    standardHeader.appendChild(actionsGroup);

    const searchContainer = document.createElement("div");
    Object.assign(searchContainer.style, { display: "none", width: "100%", alignItems: "center", background: "var(--comfy-input-bg, #181818)", border: "1px solid var(--border-color, #555)", borderRadius: "4px", padding: "2px 8px", boxSizing: "border-box", height: "26px" });
    const searchInputIcon = document.createElement("span");
    searchInputIcon.className = "pi pi-search";
    Object.assign(searchInputIcon.style, { fontSize: "11px", opacity: "0.5", marginRight: "6px" });
    const searchInput = document.createElement("input");
    Object.assign(searchInput, { type: "text", placeholder: "Filter by text, images, nodes..." });
    Object.assign(searchInput.style, { flex: "1", background: "transparent", border: "none", outline: "none", color: "var(--comfy-input-color, var(--fg-color, #eee))", fontSize: "11px", padding: "0" });
    const clearSearchBtn = document.createElement("span");
    clearSearchBtn.className = "pi pi-times";
    clearSearchBtn.title = "Clear & Close Search";
    Object.assign(clearSearchBtn.style, { cursor: "pointer", fontSize: "11px", opacity: "0.6", marginLeft: "6px", transition: "opacity 0.15s ease" });
    clearSearchBtn.onmouseenter = () => clearSearchBtn.style.opacity = "1"; clearSearchBtn.onmouseleave = () => clearSearchBtn.style.opacity = "0.6";

    searchContainer.appendChild(searchInputIcon); searchContainer.appendChild(searchInput); searchContainer.appendChild(clearSearchBtn);
    header.appendChild(standardHeader); header.appendChild(searchContainer); State.sidebarContainer.appendChild(header);

    searchIcon.onclick = (e) => { e.stopPropagation(); standardHeader.style.display = "none"; searchContainer.style.display = "flex"; searchInput.focus(); };
    const closeSearch = () => { searchInput.value = ""; State.currentSearchQuery = ""; searchContainer.style.display = "none"; standardHeader.style.display = "flex"; renderDOM(); };
    clearSearchBtn.onclick = (e) => { e.stopPropagation(); closeSearch(); };
    searchInput.onkeydown = (e) => { if (e.key === "Escape") closeSearch(); };
    searchInput.oninput = () => { State.currentSearchQuery = searchInput.value.trim(); renderDOM(); };

    State.cardStack = document.createElement("div");
    Object.assign(State.cardStack.style, { flex: "1", overflowY: "auto", scrollbarWidth: "thin", display: "block" });
    State.sidebarContainer.appendChild(State.cardStack);

    // Global background click handler: return to main queue if clicking empty space of the entire container
    State.sidebarContainer.onclick = (e) => {
        if (State.activeSubmenuPromptId || State.activeSubmenuBatchImages) {
            // Stop closure if we clicked on standard interactive elements (images, buttons, spans, cancels)
            if (e.target.closest('img, video, .comfy-sidebar-card-timer, .pi-times, .comfy-sidebar-left-hover-btn, .comfy-sidebar-queue-cancel-btn, button, span')) return;
            State.activeSubmenuPromptId = null;
            State.activeSubmenuBatchImages = null;
            resetAllCardHoverStates(); // Instantly wipe stale hover indicators on exit click
            renderDOM();
            document.removeEventListener("click", handleGlobalClick, true);
            globalClickRegistered = false;
        }
    };

    new ResizeObserver((entries) => {
        const threshold = app.ui.settings.getSettingValue("Comfy Sidebar.Grid Columns Threshold") ?? 350;
        const cols = Math.max(1, Math.floor(entries[0].contentRect.width / (threshold / 2)));
        State.cardStack.style.columnCount = cols.toString();
        State.cardStack.style.columnGap = cols > 1 ? "12px" : "0";
    }).observe(State.sidebarContainer);

    setInterval(() => {
        for (const [pid, state] of promptStates.entries()) {
            if (state.status === "active" && state.startTime) {
                const cardObj = cardElements.get(pid);
                if (cardObj && cardObj.timerEl) cardObj.timerEl.textContent = ((Date.now() - state.startTime) / 1000).toFixed(2) + "s";
            }
        }
    }, 100);

    return State.sidebarContainer;
}

// Unified image batch pagination renderer (supports standard queue cards & both explorer submenus)
function renderCardImages(cardObj, state, keepAspect) {
    cardObj.currentImageIndex = cardObj.currentImageIndex || 0;
    if (cardObj.currentImageIndex >= state.images.length) {
        cardObj.currentImageIndex = 0;
    }

    const idx = cardObj.currentImageIndex;
    const img = state.images[idx];
    if (!img) {
        cardObj.grid.innerHTML = "";
        cardObj.firstImgElement = null;
        if (cardObj.dimEl) cardObj.dimEl.style.display = "none";
        return;
    }

    const src = img.url ? img.url : window.location.origin + `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
    const isVideo = isVideoFormat(src);

    // Find or create the native wrapper
    let wrapper = cardObj.grid.querySelector(".comfy-sidebar-media-wrapper");
    if (!wrapper) {
        cardObj.grid.innerHTML = "";
        wrapper = document.createElement("div");
        wrapper.className = "comfy-sidebar-media-wrapper";
        Object.assign(wrapper.style, { position: "relative", width: "100%", display: "block" });
        cardObj.grid.appendChild(wrapper);
    }

    // Find or create the media tag in-place
    let mediaEl = wrapper.querySelector("img, video");
    const needsRebuild = !mediaEl || (isVideo !== (mediaEl.tagName.toLowerCase() === "video"));

    if (needsRebuild) {
        if (mediaEl) mediaEl.remove();
        mediaEl = isVideo ? document.createElement("video") : document.createElement("img");
        Object.assign(mediaEl.style, { 
            width: "100%", 
            borderRadius: "2px", 
            display: "block", 
            cursor: "zoom-in",
            webkitUserDrag: "element",
            zIndex: "1"
        });
        wrapper.insertBefore(mediaEl, wrapper.firstChild);
    }

    cardObj.firstImgElement = mediaEl;

    // Binds interactive event listeners. Passes shiftKey context natively to support split side-loading
    mediaEl.onclick = (ev) => { 
        ev.stopPropagation(); 
        showFullscreenPreview([src], ev.shiftKey); 
    };

    // Shared dimensions layout compiler
    const applyDimensions = (width, height) => {
        if (keepAspect && width && height) {
            mediaEl.style.aspectRatio = `${width} / ${height}`;
        }
        if (cardObj.dimEl && width && height) {
            cardObj.dimEl.textContent = `${width}x${height}`;
            cardObj.dimEl.style.display = "block";
        }
    };

    if (isVideo) { 
        mediaEl.muted = true; 
        mediaEl.playsInline = true; 
        mediaEl.preload = "metadata";
        mediaEl.loop = true;
        mediaEl.setAttribute("draggable", "false");

        mediaEl.onloadedmetadata = () => {
            applyDimensions(mediaEl.videoWidth, mediaEl.videoHeight);
        };
        
        let playIcon = wrapper.querySelector(".comfy-sidebar-play-icon");
        if (!playIcon) {
            playIcon = document.createElement("div");
            playIcon.className = "comfy-sidebar-play-icon";
            Object.assign(playIcon.style, {
                position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
                pointerEvents: "none", zIndex: "2", transition: "opacity 0.2s ease"
            });
            playIcon.innerHTML = `
                <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: 100%; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));">
                    <circle cx="50" cy="50" r="16.65" fill="rgba(0, 0, 0, 0.55)" />
                    <polygon points="45.7,42.5 45.7,57.5 58.7,50" fill="rgba(255, 255, 255, 0.9)" />
                </svg>
            `;
            wrapper.appendChild(playIcon);
        }

        mediaEl.onmouseenter = () => { playIcon.style.opacity = "0"; mediaEl.play().catch(()=>{}); };
        mediaEl.onmouseleave = () => { playIcon.style.opacity = "1"; mediaEl.pause(); };
    } else {
        const isUnfinished = state.status && state.status !== "completed";
        if (isUnfinished) {
            mediaEl.setAttribute("draggable", "false");
            mediaEl.style.cursor = "grab";
            mediaEl.removeEventListener("dragstart", mediaEl._currentDragStart);
            delete mediaEl._currentDragStart;
        } else {
            mediaEl.setAttribute("draggable", "true");
            mediaEl.style.cursor = "zoom-in";
            
            const dragStartHandler = (e) => {
                State.currentDraggedImgData = { ...img, workflow: state.workflow };
                try {
                    e.dataTransfer.setData("text/uri-list", src);
                    e.dataTransfer.setData("text/plain", src);
                } catch (err) {}
                e.dataTransfer.effectAllowed = "copy";
                e.stopPropagation();
            };
            mediaEl.removeEventListener("dragstart", mediaEl._currentDragStart);
            mediaEl.addEventListener("dragstart", dragStartHandler);
            mediaEl._currentDragStart = dragStartHandler;
        }

        const playIcon = wrapper.querySelector(".comfy-sidebar-play-icon");
        if (playIcon) playIcon.remove();
    }

    // Smooth in-memory source swapping for blob live previews
    const currentSrc = mediaEl.getAttribute("src") || mediaEl.src;
    if (currentSrc !== src && currentSrc !== (currentSrc + "#t=0.001")) {
        if (src.startsWith("blob:") && !isVideo) {
            const tempImg = new Image();
            tempImg.onload = () => {
                const oldBlob = mediaEl._lastBlob;
                mediaEl.src = src;
                mediaEl._lastBlob = src;
                applyDimensions(tempImg.naturalWidth, tempImg.naturalHeight);
                if (oldBlob && oldBlob !== src) {
                    try { URL.revokeObjectURL(oldBlob); } catch(e){}
                }
            };
            tempImg.src = src;
        } else {
            mediaEl.src = isVideo ? src + "#t=0.001" : src;
        }
    } else {
        // If the source is already correct, make sure we still force dimensions calculations
        if (isVideo) {
            if (mediaEl.videoWidth) applyDimensions(mediaEl.videoWidth, mediaEl.videoHeight);
        } else {
            if (mediaEl.naturalWidth) applyDimensions(mediaEl.naturalWidth, mediaEl.naturalHeight);
        }
    }

    // Sync batch pagination controller overlay
    let navBar = wrapper.querySelector(".comfy-sidebar-batch-navbar");
    if (state.images.length > 1) {
        if (!navBar) {
            navBar = document.createElement("div");
            navBar.className = "comfy-sidebar-batch-navbar";
            Object.assign(navBar.style, {
                position: "absolute", bottom: "6px", left: "50%",
                display: "flex", alignItems: "center", gap: "8px", background: "rgba(0,0,0,0.75)",
                padding: "4px 10px", borderRadius: "12px", zIndex: "15", fontSize: "10px",
                fontFamily: "monospace", color: "#eee", userSelect: "none", pointerEvents: "auto",
                boxShadow: "0 1px 3px rgba(0,0,0,0.4)", transform: "translate3d(-50%, 0, 0)"
            });

            const prevBtn = document.createElement("span");
            prevBtn.className = "pi pi-chevron-left";
            prevBtn.style.cursor = "pointer";
            prevBtn.onclick = (ev) => {
                ev.stopPropagation();
                cardObj.currentImageIndex = (cardObj.currentImageIndex - 1 + state.images.length) % state.images.length;
                renderCardImages(cardObj, state, keepAspect);
            };

            const label = document.createElement("span");
            label.className = "comfy-sidebar-batch-label";
            label.textContent = `${idx + 1}/${state.images.length}`;
            label.style.cursor = "pointer";
            label.title = "View all images in this batch";
            
            // Open the dynamic batch explorer explorer view when the middle counter label is clicked
            label.onclick = (ev) => {
                ev.stopPropagation();
                State.activeSubmenuBatchImages = {
                    pid: state.pid || cardObj.element.id.replace("card-", ""),
                    images: state.images,
                    workflow: state.workflow
                };
                resetAllCardHoverStates(); // Prevent ghost hover handles
                renderDOM();
            };

            const nextBtn = document.createElement("span");
            nextBtn.className = "pi pi-chevron-right";
            nextBtn.style.cursor = "pointer";
            nextBtn.onclick = (ev) => {
                ev.stopPropagation();
                cardObj.currentImageIndex = (cardObj.currentImageIndex + 1) % state.images.length;
                renderCardImages(cardObj, state, keepAspect);
            };

            navBar.append(prevBtn, label, nextBtn);
            wrapper.appendChild(navBar);
        }

        const label = navBar.querySelector(".comfy-sidebar-batch-label");
        if (label) label.textContent = `${idx + 1}/${state.images.length}`;
    } else {
        if (navBar) navBar.remove();
    }
}

let globalClickRegistered = false;

// Global document mousedown-capturer to reliably trigger click-aways outside the sidebar
const handleGlobalClick = (e) => {
    if (!State.activeSubmenuPromptId && !State.activeSubmenuBatchImages) {
        document.removeEventListener("click", handleGlobalClick, true);
        globalClickRegistered = false;
        return;
    }
    const sidebar = State.sidebarContainer;
    const clickedInsideSidebar = sidebar && sidebar.contains(e.target);
    const clickedFullscreenOverlay = e.target.closest('div[style*="zIndex: 999"]');
    
    if (!clickedInsideSidebar && !clickedFullscreenOverlay) {
        State.activeSubmenuPromptId = null;
        State.activeSubmenuBatchImages = null;
        resetAllCardHoverStates(); // Reset stale overlays when clicking away
        renderDOM();
        document.removeEventListener("click", handleGlobalClick, true);
        globalClickRegistered = false;
    }
};

let renderTimeout = null;
export function renderDOM() {
    if (renderTimeout) cancelAnimationFrame(renderTimeout);
    renderTimeout = requestAnimationFrame(() => {
        const showPendingSummary = app.ui.settings.getSettingValue("Comfy Sidebar.Show Pending Count Only") ?? true;
        const keepAspect = app.ui.settings.getSettingValue("Comfy Sidebar.Keep Object Aspect Ratio") ?? true;
        const showWorkingNode = app.ui.settings.getSettingValue("Comfy Sidebar.Show Working Node Name") ?? true;

        const headerTitle = State.sidebarContainer.querySelector("h3");
        const headerSearchIcon = State.sidebarContainer.querySelector(".pi-search");
        const headerActions = State.sidebarContainer.querySelector(".pi-eraser")?.parentNode;

        const styleActionBtn = (btn) => {
            Object.assign(btn.style, {
                display: "inline-flex",
                alignItems: "center", justifyContent: "center",
                width: "32px", height: "32px",
                backgroundColor: "rgba(0, 0, 0, 0.75)",
                color: "#e2e8f0",
                fontSize: "14px",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "all 0.15s ease",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.3)",
                zIndex: "20",
                transform: "translateZ(0)" // Forces a GPU compositor stacking context to prevent video clipping
            });
            btn.onmouseenter = () => { btn.style.backgroundColor = "rgba(0, 0, 0, 0.95)"; btn.style.color = "#fff"; };
            btn.onmouseleave = () => { btn.style.backgroundColor = "rgba(0, 0, 0, 0.75)"; btn.style.color = "#e2e8f0"; };
        };

        // --- SUBMENU 2: BATCH IMAGES EXPLORER ---
        if (State.activeSubmenuBatchImages) {
            const batchInfo = State.activeSubmenuBatchImages;

            if (headerTitle) {
                headerTitle.textContent = `Batch of #${batchInfo.pid}`;
                headerTitle.style.cursor = "pointer";
                headerTitle.title = "Go Back to Queue";
                headerTitle.onclick = () => { State.activeSubmenuBatchImages = null; resetAllCardHoverStates(); renderDOM(); };
            }
            if (headerSearchIcon) headerSearchIcon.style.display = "none";
            if (headerActions) headerActions.style.display = "none";

            if (!globalClickRegistered) {
                document.addEventListener("click", handleGlobalClick, true);
                globalClickRegistered = true;
            }

            const targetElements = [];

            batchInfo.images.forEach((img, index) => {
                const cardId = `batch-${batchInfo.pid}-${index}`;
                let cardObj = cardElements.get(cardId);

                if (!cardObj) {
                    const card = document.createElement("div");
                    card.className = "comfy-sidebar-card completed";
                    card.style.position = "relative";

                    const timerEl = document.createElement("div");
                    timerEl.className = "comfy-sidebar-card-timer";
                    timerEl.textContent = `Image ${index + 1}/${batchInfo.images.length}`;
                    timerEl.style.display = "block";
                    timerEl.style.transform = "translateZ(0)";

                    const dimEl = document.createElement("div");
                    Object.assign(dimEl.style, {
                        position: "absolute", top: "6px", right: "8px", fontSize: "10px",
                        fontFamily: "monospace", opacity: "0.7", background: "rgba(0, 0, 0, 0.6)",
                        padding: "2px 4px", borderRadius: "3px", pointerEvents: "none", zIndex: "5", color: "#fff",
                        display: "none", transform: "translateZ(0)"
                    });

                    const grid = document.createElement("div");
                    grid.style.display = "flex"; grid.style.flexDirection = "column"; grid.style.gap = "6px";

                    const p = document.createElement("div");
                    Object.assign(p.style, {
                        fontSize: "11px", opacity: "0.5", textAlign: "center", padding: "12px", marginTop: "12px", userSelect: "none"
                    });

                    // Symmetrical hover panel on the right with ONLY the Download Object button
                    const hoverPanel = document.createElement("div");
                    Object.assign(hoverPanel.style, {
                        position: "absolute", bottom: "4px", right: "4px", display: "none",
                        flexDirection: "column", gap: "4px", zIndex: "20"
                    });

                    const btnImg = document.createElement("span");
                    btnImg.className = "pi pi-image";
                    btnImg.title = "Download Object";
                    styleActionBtn(btnImg);
                    hoverPanel.appendChild(btnImg);

                    // Symmetrical left hover panel containing ONLY btnFocus
                    const leftHoverPanel = document.createElement("div");
                    Object.assign(leftHoverPanel.style, {
                        position: "absolute", bottom: "4px", left: "4px", display: "none",
                        flexDirection: "column", gap: "4px", zIndex: "20"
                    });

                    const btnFocus = document.createElement("span");
                    btnFocus.className = "pi pi-eye";
                    btnFocus.title = "Show Node";
                    styleActionBtn(btnFocus);
                    leftHoverPanel.appendChild(btnFocus);

                    card.append(timerEl, dimEl, grid, p, hoverPanel, leftHoverPanel);
                    cardObj = { element: card, timerEl, dimEl, grid, placeholder: p, hoverPanel, leftHoverPanel, btnFocus, btnImg, firstImgElement: null };
                    cardElements.set(cardId, cardObj);

                    card.addEventListener("mouseenter", () => {
                        cardObj.hoverPanel.style.display = "flex";
                        cardObj.leftHoverPanel.style.display = "flex";
                    });
                    card.addEventListener("mouseleave", () => {
                        cardObj.hoverPanel.style.display = "none";
                        cardObj.leftHoverPanel.style.display = "none";
                    });
                }

                cardObj.placeholder.style.display = "none";

                cardObj.btnImg.style.display = "inline-flex";
                cardObj.btnImg.onclick = (ev) => {
                    ev.stopPropagation();
                    const a = document.createElement("a");
                    a.href = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`;
                    a.download = img.filename || "output";
                    a.click();
                };

                // Focus/center target node inside Batch Explorer Submenu
                const nodeId = findNodeIdForImage(batchInfo, img);
                if (nodeId) {
                    cardObj.btnFocus.style.display = "inline-flex";
                    cardObj.btnFocus.onclick = (ev) => {
                        ev.stopPropagation();
                        const node = app.graph.getNodeById(Number(nodeId));
                        if (node) {
                            app.canvas.centerOnNode(node);
                            app.canvas.selectNode(node);
                        }
                    };
                } else {
                    cardObj.btnFocus.style.display = "none";
                }

                renderCardImages(cardObj, { pid: batchInfo.pid, images: [img], workflow: batchInfo.workflow }, keepAspect);

                targetElements.push(cardObj.element);
            });

            targetElements.forEach((el, index) => { if (State.cardStack.children[index] !== el) State.cardStack.insertBefore(el, State.cardStack.children[index] || null); });
            while (State.cardStack.children.length > targetElements.length) State.cardStack.removeChild(State.cardStack.lastChild);
            return;
        }

        // --- SUBMENU 1: WORKFLOW OUTPUTS EXPLORER ---
        if (State.activeSubmenuPromptId) {
            const st = promptStates.get(State.activeSubmenuPromptId);
            if (!st) {
                State.activeSubmenuPromptId = null;
                renderDOM();
                return;
            }

            // Sync Header UI State for the explorer view
            if (headerTitle) {
                headerTitle.textContent = `Outputs of #${State.activeSubmenuPromptId}`;
                headerTitle.style.cursor = "pointer";
                headerTitle.title = "Go Back to Queue";
                headerTitle.onclick = () => { State.activeSubmenuPromptId = null; resetAllCardHoverStates(); renderDOM(); };
            }
            if (headerSearchIcon) headerSearchIcon.style.display = "none";
            if (headerActions) headerActions.style.display = "none";

            if (!globalClickRegistered) {
                document.addEventListener("click", handleGlobalClick, true);
                globalClickRegistered = true;
            }

            const outputs = getRunOutputs(st.nodeOutputs, st.workflow);
            const targetElements = [];

            outputs.forEach((out) => {
                const cardId = `submenu-${st.pid}-${out.nodeId}`;
                let cardObj = cardElements.get(cardId);
                
                if (!cardObj) {
                    const card = document.createElement("div");
                    card.className = "comfy-sidebar-card completed";
                    card.style.position = "relative";
                    
                    const timerEl = document.createElement("div"); 
                    timerEl.className = "comfy-sidebar-card-timer";
                    const node = st.workflow?.nodes?.find(n => String(n.id) === String(out.nodeId));
                    timerEl.textContent = node ? (node.title || node.type) : `Node #${out.nodeId}`;
                    timerEl.style.display = "block";
                    timerEl.style.transform = "translateZ(0)";

                    const dimEl = document.createElement("div");
                    Object.assign(dimEl.style, {
                        position: "absolute", top: "6px", right: "8px", fontSize: "10px",
                        fontFamily: "monospace", opacity: "0.7", background: "rgba(0, 0, 0, 0.6)",
                        padding: "2px 4px", borderRadius: "3px", pointerEvents: "none", zIndex: "5", color: "#fff",
                        display: "none", transform: "translateZ(0)"
                    });

                    const grid = document.createElement("div"); 
                    grid.style.display = "flex"; grid.style.flexDirection = "column"; grid.style.gap = "6px";
                    
                    const p = document.createElement("div"); 
                    Object.assign(p.style, { 
                        fontSize: "11px", opacity: "0.5", textAlign: "center", padding: "12px", marginTop: "12px", userSelect: "none"
                    });

                    // Action overlay on hover containing only Download Object
                    const hoverPanel = document.createElement("div");
                    Object.assign(hoverPanel.style, {
                        position: "absolute", bottom: "4px", right: "4px", display: "none",
                        flexDirection: "column", gap: "4px", zIndex: "20"
                    });

                    const btnImg = document.createElement("span");
                    btnImg.className = "pi pi-image";
                    btnImg.title = "Download Object";
                    styleActionBtn(btnImg);
                    hoverPanel.appendChild(btnImg);

                    // Symmetrical left hover panel containing ONLY btnFocus
                    const leftHoverPanel = document.createElement("div");
                    Object.assign(leftHoverPanel.style, {
                        position: "absolute", bottom: "4px", left: "4px", display: "none",
                        flexDirection: "column", gap: "4px", zIndex: "20"
                    });

                    const btnFocus = document.createElement("span");
                    btnFocus.className = "pi pi-eye";
                    btnFocus.title = "Show Node";
                    styleActionBtn(btnFocus);
                    leftHoverPanel.appendChild(btnFocus);
                    
                    card.append(timerEl, dimEl, grid, p, hoverPanel, leftHoverPanel);
                    cardObj = { element: card, timerEl, dimEl, grid, placeholder: p, hoverPanel, leftHoverPanel, btnFocus, btnImg, firstImgElement: null };
                    cardElements.set(cardId, cardObj);

                    card.addEventListener("mouseenter", () => {
                        cardObj.hoverPanel.style.display = "flex";
                        cardObj.leftHoverPanel.style.display = "flex";
                    });
                    card.addEventListener("mouseleave", () => {
                        cardObj.hoverPanel.style.display = "none";
                        cardObj.leftHoverPanel.style.display = "none";
                    });
                }

                if (out.images && out.images.length > 0) {
                    cardObj.placeholder.style.display = "none";
                    
                    cardObj.btnImg.style.display = "inline-flex";
                    cardObj.btnImg.onclick = (ev) => {
                        ev.stopPropagation();
                        out.images.forEach(img => {
                            const a = document.createElement("a");
                            a.href = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`;
                            a.download = img.filename || "output";
                            a.click();
                        });
                    };

                    // Focus/center target node inside Workflow outputs Submenu
                    cardObj.btnFocus.onclick = (ev) => {
                        ev.stopPropagation();
                        const node = app.graph.getNodeById(Number(out.nodeId));
                        if (node) {
                            app.canvas.centerOnNode(node);
                            app.canvas.selectNode(node);
                        }
                    };

                    renderCardImages(cardObj, { pid: st.pid, images: out.images, workflow: st.workflow }, keepAspect);
                } else {
                    cardObj.btnImg.style.display = "none";
                    cardObj.placeholder.style.display = "block";
                    cardObj.placeholder.textContent = "No Outputs";
                }

                targetElements.push(cardObj.element);
            });

            targetElements.forEach((el, index) => { if (State.cardStack.children[index] !== el) State.cardStack.insertBefore(el, State.cardStack.children[index] || null); });
            while (State.cardStack.children.length > targetElements.length) State.cardStack.removeChild(State.cardStack.lastChild);
            return;
        }

        // --- STANDARD QUEUE RENDER LOGIC ---
        if (headerTitle) {
            headerTitle.textContent = "Queue";
            headerTitle.style.cursor = "default";
            headerTitle.onclick = null;
        }
        if (headerSearchIcon) headerSearchIcon.style.display = "inline";
        if (headerActions) headerActions.style.display = "flex";

        let tasksArray = Array.from(promptStates.values());
        if (showPendingSummary) tasksArray = tasksArray.filter(t => t.status !== "pending");
        if (State.currentSearchQuery) tasksArray = tasksArray.filter(t => matchesFilter(t, State.currentSearchQuery));
        tasksArray.sort((a, b) => b.timestamp - a.timestamp);

        const activeTasks = tasksArray.filter(t => t.status === "active");
        const completedTasks = tasksArray.filter(t => t.status === "completed" || t.status === "cancelled" || t.status === "error");
        const pendingTasks = tasksArray.filter(t => t.status === "pending").sort((a, b) => (b.queueNumber || 0) - (a.queueNumber || 0));

        const syncCardElement = (state) => {
            let cardObj = cardElements.get(state.pid);
            const isFinalStatus = state.status === "completed" || state.status === "cancelled" || state.status === "error";
            if (cardObj && isFinalStatus && state.rendered) return cardObj.element;
            
            if (!cardObj) {
                const card = document.createElement("div");
                const timerEl = document.createElement("div"); timerEl.className = "comfy-sidebar-card-timer";
                const cancelX = document.createElement("span"); 
                cancelX.className = "pi pi-times comfy-sidebar-queue-cancel-btn";
                Object.assign(cancelX.style, { 
                    position: "absolute", 
                    top: "4px", 
                    right: "4px", 
                    display: "none", 
                    zIndex: "10" 
                });
                const sBadge = document.createElement("div");
                Object.assign(sBadge.style, { position: "absolute", top: "6px", right: "8px", fontSize: "9px", fontWeight: "bold", padding: "2px 6px", borderRadius: "2px", textTransform: "uppercase", display: "none", pointerEvents: "none", zIndex: "10" });
                const grid = document.createElement("div"); grid.style.display = "flex"; grid.style.flexDirection = "column"; grid.style.gap = "6px";
                const p = document.createElement("div"); 
                Object.assign(p.style, { 
                    fontSize: "11px", opacity: "0.5", textAlign: "center", padding: "12px", marginTop: "12px", userSelect: "none",
                    display: "-webkit-box", WebkitLineClamp: "15", WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word"
                });
                const pt = document.createElement("div"); Object.assign(pt.style, { width: "100%", height: "4px", background: "#333", borderRadius: "2px", marginTop: "8px", overflow: "hidden", display: "none" });
                const pb = document.createElement("div"); Object.assign(pb.style, { width: `0%`, height: "100%", background: "#3b82f6", transition: "width 0.1s linear" });
                pt.appendChild(pb);
                const statusText = document.createElement("div"); Object.assign(statusText.style, { fontSize: "11px", opacity: "0.9", color: "#3b82f6", textAlign: "center", marginTop: "6px", display: "none", fontWeight: "bold" });
                
                // Absolute Vertical Actions Panel on the right of the card
                const hoverPanel = document.createElement("div"); 
                Object.assign(hoverPanel.style, { 
                    position: "absolute", bottom: "4px", right: "4px", display: "none", 
                    flexDirection: "column", gap: "4px", zIndex: "20" 
                });

                const btnImg = document.createElement("span"); btnImg.className = "pi pi-image"; btnImg.title = "Download Object"; styleActionBtn(btnImg);
                const btnJson = document.createElement("span"); btnJson.className = "pi pi-file"; btnJson.title = "Download JSON"; styleActionBtn(btnJson);
                const btnDel = document.createElement("span"); btnDel.className = "pi pi-trash"; btnDel.title = "Delete Card"; styleActionBtn(btnDel);

                // Absolute Vertical Left Actions Panel containing btnFocus and leftHoverBtn
                const leftHoverPanel = document.createElement("div"); 
                Object.assign(leftHoverPanel.style, { 
                    position: "absolute", bottom: "4px", left: "4px", display: "none", 
                    flexDirection: "column", gap: "4px", zIndex: "20" 
                });

                const btnFocus = document.createElement("span");
                btnFocus.className = "pi pi-eye";
                btnFocus.title = "Show Node";
                styleActionBtn(btnFocus);

                const leftHoverBtn = document.createElement("span");
                leftHoverBtn.className = "pi pi-images";
                leftHoverBtn.title = "View all intermediate outputs";
                styleActionBtn(leftHoverBtn);
                
                leftHoverBtn.onclick = (ev) => {
                    ev.stopPropagation();
                    State.activeSubmenuPromptId = state.pid;
                    resetAllCardHoverStates(); // Reset standard sidebar hover states before opening submenu
                    renderDOM();
                };

                hoverPanel.append(btnImg, btnJson, btnDel);
                leftHoverPanel.append(btnFocus, leftHoverBtn);

                card.append(timerEl, cancelX, sBadge, grid, p, pt, statusText, hoverPanel, leftHoverPanel);
                
                cardObj = { element: card, timerEl, statusBadge: sBadge, grid, placeholder: p, progressContainer: pt, progressBar: pb, cancelBtn: cancelX, hoverPanel, leftHoverPanel, btnFocus, leftHoverBtn, btnImg, btnJson, btnDel, statusText, firstImgElement: null, lastImagesSignature: "" };
                
                card.addEventListener("mouseenter", () => { 
                    if (state.status !== "active" && state.status !== "pending") {
                        cardObj.hoverPanel.style.display = "flex";
                        cardObj.leftHoverPanel.style.display = "flex";

                        // Focus/Center the exact node that generated the currently active displayed image
                        const currentImg = state.images[cardObj.currentImageIndex || 0];
                        const nodeId = findNodeIdForImage(state, currentImg);
                        if (nodeId) {
                            cardObj.btnFocus.style.display = "inline-flex";
                            cardObj.btnFocus.onclick = (ev) => {
                                ev.stopPropagation();
                                const node = app.graph.getNodeById(Number(nodeId));
                                if (node) {
                                    app.canvas.centerOnNode(node);
                                    app.canvas.selectNode(node);
                                }
                            };
                        } else {
                            cardObj.btnFocus.style.display = "none";
                        }

                        // Show explorer view button if this run yielded multiple node outputs, or if it was interrupted/failed but has some outputs
                        const outputs = getRunOutputs(state.nodeOutputs, state.workflow);
                        const isInterrupted = state.status === "cancelled" || state.status === "error";
                        if (outputs.length > 1 || (outputs.length > 0 && isInterrupted)) {
                            cardObj.leftHoverBtn.style.display = "inline-flex";
                        } else {
                            cardObj.leftHoverBtn.style.display = "none";
                        }
                    } 
                });
                card.addEventListener("mouseleave", () => {
                    cardObj.hoverPanel.style.display = "none";
                    cardObj.leftHoverPanel.style.display = "none";
                });
                
                card.addEventListener("dragstart", (e) => {
                    // Custom dragstart is used for JSON-only or unfinished workflows to supply a local DownloadURL.
                    // For completed image cards, dragging is handled natively by the browser on the child <img> tag.
                    const isUnfinished = state.status && state.status !== "completed";
                    if (state.workflow && (!state.images || state.images.length === 0 || isUnfinished)) {
                        if (cardObj.firstImgElement) e.dataTransfer.setDragImage(cardObj.firstImgElement, 15, 15);
                        const jsonStr = JSON.stringify(state.workflow, null, 2);
                        try { 
                            e.dataTransfer.setData("DownloadURL", `application/json:workflow_${state.pid}.json:data:application/json;base64,` + btoa(unescape(encodeURIComponent(jsonStr)))); 
                            e.dataTransfer.setData("text/plain", jsonStr); 
                            e.dataTransfer.setData("application/json", jsonStr); 
                        } catch (err) {}
                        e.dataTransfer.effectAllowed = "copy";
                    }
                });
                cardObj.element.id = `card-${state.pid}`; // set ID helper
                cardElements.set(state.pid, cardObj);
            }

            cardObj.element.className = `comfy-sidebar-card ${state.status}`;
            
            // Native drag isolation: completely remove draggable flags on image containers for finished cards.
            // This exposes the child <img> tag directly to Chrome's native filesystem drag APIs.
            const isUnfinished = state.status && state.status !== "completed";
            if (state.images && state.images.length > 0 && !isUnfinished) {
                cardObj.element.removeAttribute("draggable");
            } else {
                cardObj.element.setAttribute("draggable", "true");
            }

            if (state.status === "active") {
                cardObj.timerEl.textContent = state.startTime ? ((Date.now() - state.startTime) / 1000).toFixed(2) + "s" : "...";
                cardObj.timerEl.style.display = "block";
            } else if (state.duration !== undefined && state.duration !== null) {
                cardObj.timerEl.textContent = state.duration.toFixed(2) + "s"; cardObj.timerEl.style.display = "block";
            } else cardObj.timerEl.style.display = "none";

            if (state.status === "cancelled") Object.assign(cardObj.statusBadge.style, { display: "block", background: "#ffc107", color: "#000" });
            else if (state.status === "error") Object.assign(cardObj.statusBadge.style, { display: "block", background: "#dc3545", color: "#fff" });
            else cardObj.statusBadge.style.display = "none";
            if (state.status === "cancelled") cardObj.statusBadge.textContent = "Cancelled";
            else if (state.status === "error") cardObj.statusBadge.textContent = "Error";

            if (state.status === "pending" && !showPendingSummary) {
                cardObj.cancelBtn.style.display = "flex";
                cardObj.cancelBtn.onclick = async (ev) => { 
                    ev.stopPropagation(); 
                    await api.fetchApi("/queue", { method: "POST", body: JSON.stringify({ delete: [state.pid] }) }); 
                    await syncQueueFn(); 
                };
            } else if (state.status === "active") {
                cardObj.cancelBtn.style.display = "flex";
                cardObj.cancelBtn.onclick = async (ev) => { 
                    ev.stopPropagation(); 
                    await api.interrupt(); // Natively interrupts current execution
                    await syncQueueFn(); 
                };
            } else {
                cardObj.cancelBtn.style.display = "none";
            }

            if (state.images && state.images.length > 0) {
                cardObj.btnImg.style.display = "inline-flex";
                cardObj.btnImg.onclick = (ev) => { ev.stopPropagation(); state.images.forEach(img => { const a = document.createElement("a"); a.href = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`; a.download = img.filename || "output"; a.click(); }); };
            } else cardObj.btnImg.style.display = "none";

            if (state.workflow) {
                cardObj.btnJson.style.display = "inline-flex";
                cardObj.btnJson.onclick = (ev) => { ev.stopPropagation(); const blob = new Blob([JSON.stringify(state.workflow, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `workflow_${state.pid}.json`; a.click(); URL.revokeObjectURL(url); };
            } else cardObj.btnJson.style.display = "none";

            let deleteTimeout = null, isDeletePending = false;
            const resetDeleteBtn = () => { 
                isDeletePending = false; 
                Object.assign(cardObj.btnDel.style, { 
                    color: "#e2e8f0", 
                    backgroundColor: "rgba(0, 0, 0, 0.75)"
                }); 
                cardObj.btnDel.title = "Delete Card"; 
                if (deleteTimeout) { clearTimeout(deleteTimeout); deleteTimeout = null; } 
            };
            
            cardObj.btnDel.onclick = async (ev) => {
                ev.stopPropagation();
                if (!isDeletePending) {
                    isDeletePending = true; 
                    Object.assign(cardObj.btnDel.style, { 
                        color: "#fff", 
                        backgroundColor: "#dc3545" // Changes to solid red on warning confirmation
                    }); 
                    cardObj.btnDel.title = "Click again to confirm deletion";
                    deleteTimeout = setTimeout(resetDeleteBtn, 1000);
                } else {
                    resetDeleteBtn(); 
                    promptStates.delete(state.pid); 
                    await api.fetchApi("/history", { method: "POST", body: JSON.stringify({ delete: [state.pid] }) }); 
                    renderDOM();
                }
            };

            const currentImagesSignature = state.images ? state.images.map(img => img.url || img.filename).join("|") : "";
            if (cardObj.lastImagesSignature !== currentImagesSignature) {
                if (!state.images || state.images.length === 0) {
                    cardObj.grid.innerHTML = ""; cardObj.firstImgElement = null; cardObj.placeholder.style.display = "block";
                } else {
                    cardObj.placeholder.style.display = "none";
                    renderCardImages(cardObj, state, keepAspect);
                }
                cardObj.lastImagesSignature = currentImagesSignature;
            }

            if (state.images.length === 0) {
                // Correctly display accumulated texts (like workflow prompts) while running as requested
                if (state.texts && state.texts.length > 0) {
                    cardObj.placeholder.textContent = state.texts.join("\n"); Object.assign(cardObj.placeholder.style, { whiteSpace: "pre-wrap", textAlign: "left" });
                } else {
                    cardObj.placeholder.textContent = state.progressText || "No Outputs"; Object.assign(cardObj.placeholder.style, { whiteSpace: "normal", textAlign: "center" });
                }
            }

            if (state.status === "active") {
                if (showWorkingNode) {
                    cardObj.statusText.style.display = "block";
                    cardObj.statusText.textContent = state.activeNodeName ? (state.activeNodeName === "Finishing..." ? "Finishing..." : `[${state.activeNodeName}]${state.progress ? ` ${state.progress}%` : ""}`) : `Sampling...${state.progress ? ` ${state.progress}%` : ""}`;
                } else cardObj.statusText.style.display = "none";
                cardObj.progressContainer.style.display = "block"; cardObj.progressBar.style.width = `${state.progress || 0}%`;
            } else { cardObj.statusText.style.display = "none"; cardObj.progressContainer.style.display = "none"; }

            if (isFinalStatus) state.rendered = true;
            return cardObj.element;
        };

        for (const [pid, cardObj] of cardElements.entries()) { if (pid !== "pending-summary-card" && pid !== "pending-cancel-all-standalone" && !promptStates.has(pid)) cardElements.delete(pid); }

        const pendingCount = Array.from(promptStates.values()).filter(t => t.status === "pending").length;
        const targetElements = [];

        if (pendingCount > 0) {
            if (showPendingSummary) {
                let pCard = cardElements.get("pending-summary-card");
                if (!pCard) {
                    const el = document.createElement("div"); Object.assign(el.style, { background: "#181818", border: "2px solid #6c757d", borderRadius: "4px", padding: "10px", marginBottom: "12px", textAlign: "center", fontSize: "12px", fontWeight: "bold", color: "#aaa", breakInside: "avoid", display: "flex", flexDirection: "column", gap: "8px" });
                    const textDiv = document.createElement("div"); el.appendChild(textDiv);
                    const cancelBtn = document.createElement("button"); cancelBtn.textContent = "Cancel All Pending"; Object.assign(cancelBtn.style, { background: "#dc3545", color: "white", border: "none", borderRadius: "3px", padding: "4px", cursor: "pointer", fontSize: "11px", fontWeight: "bold" });
                    cancelBtn.onclick = async () => { await api.fetchApi("/queue", { method: "POST", body: JSON.stringify({ clear: true }) }); await syncQueueFn(); };
                    el.appendChild(cancelBtn); pCard = { element: el, textDiv }; cardElements.set("pending-summary-card", pCard);
                }
                pCard.textDiv.textContent = `Pending Queue: ${pendingCount} tasks`;
                targetElements.push(pCard.element);
            } else {
                let btnCard = cardElements.get("pending-cancel-all-standalone");
                if (!btnCard) {
                    const btn = document.createElement("button"); btn.textContent = "Cancel All Pending"; Object.assign(btn.style, { background: "#dc3545", color: "white", border: "none", borderRadius: "3px", padding: "6px", cursor: "pointer", fontSize: "11px", fontWeight: "bold", width: "100%", marginBottom: "12px", breakInside: "avoid" });
                    btn.onclick = async () => { await api.fetchApi("/queue", { method: "POST", body: JSON.stringify({ clear: true }) }); await syncQueueFn(); };
                    btnCard = { element: btn }; cardElements.set("pending-cancel-all-standalone", btnCard);
                }
                targetElements.push(btnCard.element);
                pendingTasks.forEach(st => targetElements.push(syncCardElement(st)));
            }
        }
        activeTasks.forEach(st => targetElements.push(syncCardElement(st)));
        completedTasks.forEach(st => targetElements.push(syncCardElement(st)));

        targetElements.forEach((el, index) => { if (State.cardStack.children[index] !== el) State.cardStack.insertBefore(el, State.cardStack.children[index] || null); });
        while (State.cardStack.children.length > targetElements.length) State.cardStack.removeChild(State.cardStack.lastChild);

        saveStatesToLocalStorage();
    });
}