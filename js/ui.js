import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { State, promptStates, cardElements, saveStatesToLocalStorage } from "./state.js";
import { isVideoFormat, matchesFilter, getRunOutputs } from "./utils.js";

// DI Hook for cyclic imports
export let syncQueueFn = async () => {};
export function setSyncQueue(fn) { syncQueueFn = fn; }

export function showFullscreenPreview(imgSrcs) {
    if (!imgSrcs || imgSrcs.length === 0) return;
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
        position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh",
        background: "rgba(0,0,0,0.9)", zIndex: "10000", display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "zoom-out"
    });
    
    const content = document.createElement("div");
    Object.assign(content.style, { maxWidth: "90%", maxHeight: "85%", display: "flex", justifyContent: "center" });

    imgSrcs.forEach(src => {
        if (isVideoFormat(src)) {
            const video = document.createElement("video");
            video.src = src; video.autoplay = true; video.controls = true; video.loop = true;
            video.style.maxWidth = "100%"; video.style.maxHeight = "100%";
            content.appendChild(video);
        } else {
            const img = document.createElement("img");
            img.src = src; img.style.maxWidth = "100%"; img.style.maxHeight = "100%"; img.style.objectFit = "contain";
            content.appendChild(img);
        }
    });

    overlay.appendChild(content);
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
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
        return;
    }

    const src = img.url ? img.url : window.location.origin + `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
    const isVideo = isVideoFormat(src);

    const currentMediaEl = cardObj.grid.querySelector("img, video");
    const matchesTagType = currentMediaEl && (isVideo === (currentMediaEl.tagName.toLowerCase() === "video"));

    if (matchesTagType) {
        // --- IN-PLACE REUSE PATH (ELIMINATES BLINKING & SHAPE-SHIFTS) ---
        const mediaEl = currentMediaEl;

        // 1. Update interactive event listeners on reuse to bind correct closure variables
        mediaEl.onclick = (ev) => { 
            ev.stopPropagation(); 
            showFullscreenPreview(state.images.map(i => i.url ? i.url : window.location.origin + `/view?filename=${encodeURIComponent(i.filename)}&type=${encodeURIComponent(i.type || 'output')}&subfolder=${encodeURIComponent(i.subfolder || '')}`)); 
        };

        if (!isVideo) {
            // Re-bind native drag handlers with updated state values
            const newDragStart = (e) => {
                State.currentDraggedImgData = { ...img, workflow: state.workflow };
                try {
                    e.dataTransfer.setData("text/uri-list", src);
                    e.dataTransfer.setData("text/plain", src);
                } catch (err) {}
                e.dataTransfer.effectAllowed = "copy";
                e.stopPropagation();
            };
            mediaEl.removeEventListener("dragstart", mediaEl._currentDragStart);
            mediaEl.addEventListener("dragstart", newDragStart);
            mediaEl._currentDragStart = newDragStart;
        }

        // 2. Perform smooth in-memory source swapping for blob live previews
        const currentSrc = mediaEl.getAttribute("src") || mediaEl.src;
        if (currentSrc !== src && currentSrc !== (currentSrc + "#t=0.001")) {
            if (src.startsWith("blob:") && !isVideo) {
                // Smooth preload trick: hold current preview until the new one is fully loaded
                const tempImg = new Image();
                tempImg.onload = () => {
                    const oldBlob = mediaEl._lastBlob;
                    mediaEl.src = src;
                    mediaEl._lastBlob = src;
                    
                    if (keepAspect && tempImg.naturalWidth && tempImg.naturalHeight) {
                        mediaEl.style.aspectRatio = `${tempImg.naturalWidth} / ${tempImg.naturalHeight}`;
                    }
                    if (cardObj.dimEl && tempImg.naturalWidth && tempImg.naturalHeight) {
                        cardObj.dimEl.textContent = `${tempImg.naturalWidth}x${tempImg.naturalHeight}`;
                        cardObj.dimEl.style.display = "block";
                    }

                    if (oldBlob && oldBlob !== src) {
                        try { URL.revokeObjectURL(oldBlob); } catch(e){}
                    }
                };
                tempImg.src = src;
            } else {
                // Direct fast swap for standard server files
                mediaEl.src = isVideo ? src + "#t=0.001" : src;
            }
        }

        // 3. Update the pagination label if it exists
        const label = cardObj.grid.querySelector(".comfy-sidebar-batch-label");
        if (label) {
            label.textContent = `${idx + 1}/${state.images.length}`;
        }
        return;
    }

    // --- REBUILD PATH (ONLY RUNS ON TYPE CHANGE OR FIRST RENDER) ---
    cardObj.grid.innerHTML = "";
    cardObj.firstImgElement = null;

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, { position: "relative", width: "100%", display: "block" });

    const thumb = isVideo ? document.createElement("video") : document.createElement("img");
    Object.assign(thumb.style, { 
        width: "100%", 
        borderRadius: "2px", 
        display: "block", 
        cursor: "zoom-in",
        webkitUserDrag: "element"
    });

    if (isVideo) { 
        thumb.muted = true; 
        thumb.playsInline = true; 
        thumb.preload = "metadata";
        thumb.loop = true;
        
        const playIcon = document.createElement("div");
        Object.assign(playIcon.style, {
            position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
            pointerEvents: "none", zIndex: "5", transition: "opacity 0.2s ease"
        });
        
        playIcon.innerHTML = `
            <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: 100%; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));">
                <circle cx="50" cy="50" r="16.65" fill="rgba(0, 0, 0, 0.55)" />
                <polygon points="45.7,42.5 45.7,57.5 58.7,50" fill="rgba(255, 255, 255, 0.9)" />
            </svg>
        `;
        wrapper.appendChild(playIcon);

        thumb.onmouseenter = () => { playIcon.style.opacity = "0"; thumb.play().catch(()=>{}); };
        thumb.onmouseleave = () => { playIcon.style.opacity = "1"; thumb.pause(); };
    }
    
    if (!keepAspect) { thumb.style.aspectRatio = "1 / 1"; thumb.style.objectFit = "cover"; }
    
    if (!isVideo) {
        thumb.setAttribute("draggable", "true");
        thumb.onload = () => { 
            if (keepAspect && thumb.naturalWidth && thumb.naturalHeight) {
                thumb.style.aspectRatio = `${thumb.naturalWidth} / ${thumb.naturalHeight}`;
            }
            if (cardObj.dimEl) {
                cardObj.dimEl.textContent = `${thumb.naturalWidth}x${thumb.naturalHeight}`;
                cardObj.dimEl.style.display = "block";
            }
        };
        thumb.src = src;

        const dragStartHandler = (e) => {
            State.currentDraggedImgData = { ...img, workflow: state.workflow };
            try {
                e.dataTransfer.setData("text/uri-list", src);
                e.dataTransfer.setData("text/plain", src);
            } catch (err) {}
            e.dataTransfer.effectAllowed = "copy";
            e.stopPropagation();
        };
        thumb.addEventListener("dragstart", dragStartHandler);
        thumb._currentDragStart = dragStartHandler;
    } else {
        thumb.setAttribute("draggable", "false");
        thumb.onloadedmetadata = () => {
            if (keepAspect && thumb.videoWidth && thumb.videoHeight) {
                thumb.style.aspectRatio = `${thumb.videoWidth} / ${thumb.videoHeight}`;
            }
            if (cardObj.dimEl) {
                cardObj.dimEl.textContent = `${thumb.videoWidth}x${thumb.videoHeight}`;
                cardObj.dimEl.style.display = "block";
            }
        };
        thumb.src = src + "#t=0.001";
    }

    thumb.onclick = (ev) => { 
        ev.stopPropagation(); 
        showFullscreenPreview(state.images.map(i => i.url ? i.url : window.location.origin + `/view?filename=${encodeURIComponent(i.filename)}&type=${encodeURIComponent(i.type || 'output')}&subfolder=${encodeURIComponent(i.subfolder || '')}`)); 
    };
    
    wrapper.insertBefore(thumb, wrapper.firstChild);
    cardObj.firstImgElement = thumb;

    // Overlay slick pagination controller bar if batch has multiple output images
    if (state.images.length > 1) {
        const navBar = document.createElement("div");
        Object.assign(navBar.style, {
            position: "absolute", bottom: "6px", left: "50%", transform: "translateX(-50%)",
            display: "flex", alignItems: "center", gap: "8px", background: "rgba(0,0,0,0.75)",
            padding: "4px 10px", borderRadius: "12px", zIndex: "15", fontSize: "10px",
            fontFamily: "monospace", color: "#eee", userSelect: "none", pointerEvents: "auto",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)"
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

    cardObj.grid.appendChild(wrapper);
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
    const clickedFullscreenOverlay = e.target.closest('div[style*="zIndex: 10000"]');
    
    if (!clickedInsideSidebar && !clickedFullscreenOverlay) {
        State.activeSubmenuPromptId = null;
        State.activeSubmenuBatchImages = null;
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

        const styleRightBtn = (btn) => {
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
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.3)"
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
                headerTitle.onclick = () => { State.activeSubmenuBatchImages = null; renderDOM(); };
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

                    const dimEl = document.createElement("div");
                    Object.assign(dimEl.style, {
                        position: "absolute", top: "6px", right: "8px", fontSize: "10px",
                        fontFamily: "monospace", opacity: "0.7", background: "rgba(0, 0, 0, 0.6)",
                        padding: "2px 4px", borderRadius: "3px", pointerEvents: "none", zIndex: "5", color: "#fff",
                        display: "none"
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
                    styleRightBtn(btnImg);
                    hoverPanel.appendChild(btnImg);

                    card.append(timerEl, dimEl, grid, p, hoverPanel);
                    cardObj = { element: card, timerEl, dimEl, grid, placeholder: p, hoverPanel, btnImg, firstImgElement: null };
                    cardElements.set(cardId, cardObj);

                    card.addEventListener("mouseenter", () => {
                        cardObj.hoverPanel.style.display = "flex";
                    });
                    card.addEventListener("mouseleave", () => {
                        cardObj.hoverPanel.style.display = "none";
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
                headerTitle.onclick = () => { State.activeSubmenuPromptId = null; renderDOM(); };
            }
            if (headerSearchIcon) headerSearchIcon.style.display = "none";
            if (headerActions) headerActions.style.display = "none";

            if (!globalClickRegistered) {
                document.addEventListener("click", handleGlobalClick, true);
                globalClickRegistered = true;
            }

            const outputs = getRunOutputs(st.nodeOutputs);
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

                    const dimEl = document.createElement("div");
                    Object.assign(dimEl.style, {
                        position: "absolute", top: "6px", right: "8px", fontSize: "10px",
                        fontFamily: "monospace", opacity: "0.7", background: "rgba(0, 0, 0, 0.6)",
                        padding: "2px 4px", borderRadius: "3px", pointerEvents: "none", zIndex: "5", color: "#fff",
                        display: "none"
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
                    styleRightBtn(btnImg);
                    hoverPanel.appendChild(btnImg);
                    
                    card.append(timerEl, dimEl, grid, p, hoverPanel);
                    cardObj = { element: card, timerEl, dimEl, grid, placeholder: p, hoverPanel, btnImg, firstImgElement: null };
                    cardElements.set(cardId, cardObj);

                    card.addEventListener("mouseenter", () => {
                        cardObj.hoverPanel.style.display = "flex";
                    });
                    card.addEventListener("mouseleave", () => {
                        cardObj.hoverPanel.style.display = "none";
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

                const btnImg = document.createElement("span"); btnImg.className = "pi pi-image"; btnImg.title = "Download Object"; styleRightBtn(btnImg);
                const btnJson = document.createElement("span"); btnJson.className = "pi pi-file"; btnJson.title = "Download JSON"; styleRightBtn(btnJson);
                const btnDel = document.createElement("span"); btnDel.className = "pi pi-trash"; btnDel.title = "Delete Card"; styleRightBtn(btnDel);

                // Bottom left Explorer Submenu Button
                const leftHoverBtn = document.createElement("span");
                leftHoverBtn.className = "pi pi-images comfy-sidebar-left-hover-btn";
                leftHoverBtn.title = "View all intermediate outputs";
                Object.assign(leftHoverBtn.style, {
                    position: "absolute", bottom: "4px", left: "4px", display: "none",
                    alignItems: "center", justifyContent: "center",
                    width: "32px", height: "32px",
                    backgroundColor: "rgba(0, 0, 0, 0.75)",
                    color: "#e2e8f0",
                    fontSize: "14px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.3)",
                    zIndex: "20"
                });
                leftHoverBtn.onmouseenter = () => { leftHoverBtn.style.backgroundColor = "rgba(0, 0, 0, 0.95)"; leftHoverBtn.style.color = "#fff"; };
                leftHoverBtn.onmouseleave = () => { leftHoverBtn.style.backgroundColor = "rgba(0, 0, 0, 0.75)"; leftHoverBtn.style.color = "#e2e8f0"; };
                
                leftHoverBtn.onclick = (ev) => {
                    ev.stopPropagation();
                    State.activeSubmenuPromptId = state.pid;
                    renderDOM();
                };

                hoverPanel.append(btnImg, btnJson, btnDel);
                card.append(timerEl, cancelX, sBadge, grid, p, pt, statusText, hoverPanel, leftHoverBtn);
                
                cardObj = { element: card, timerEl, statusBadge: sBadge, grid, placeholder: p, progressContainer: pt, progressBar: pb, cancelBtn: cancelX, hoverPanel, leftHoverBtn, btnImg, btnJson, btnDel, statusText, firstImgElement: null, lastImagesSignature: "" };
                
                card.addEventListener("mouseenter", () => { 
                    if (state.status !== "active" && state.status !== "pending") {
                        cardObj.hoverPanel.style.display = "flex";
                        // Show explorer view button if this run yielded multiple node outputs
                        const outputs = getRunOutputs(state.nodeOutputs);
                        if (outputs.length > 1) {
                            cardObj.leftHoverBtn.style.display = "inline-flex";
                        } else {
                            cardObj.leftHoverBtn.style.display = "none";
                        }
                    } 
                });
                card.addEventListener("mouseleave", () => {
                    cardObj.hoverPanel.style.display = "none";
                    cardObj.leftHoverBtn.style.display = "none";
                });
                
                card.addEventListener("dragstart", (e) => {
                    // Custom dragstart is only used for JSON-only workflows to supply a local DownloadURL.
                    // For image cards, dragging is handled natively by the browser on the child <img> tag.
                    if (state.workflow && (!state.images || state.images.length === 0)) {
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
                cardElements.set(state.pid, cardObj);
            }

            cardObj.element.className = `comfy-sidebar-card ${state.status}`;
            
            // Native drag isolation: completely remove draggable flags on image containers.
            // This exposes the child <img> tag directly to Chrome's native filesystem drag APIs.
            if (state.images && state.images.length > 0) {
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