import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { State, promptStates, cardElements, scheduleStateSave, deletePromptState } from "./state.js";
import { isVideoFormat, is3DFormat, isAudioFormat, getFilenameFromUrl, matchesFilter, getRunOutputs } from "./utils.js";
import { showFullscreenPreview, isAudioViewerOpen } from "./comparison.js";

export let syncQueueFn = async () => {};
export function setSyncQueue(fn) { syncQueueFn = fn; }

let currentlyPlayingAudio = null;
export function stopAllAudioPlayback() {
    if (currentlyPlayingAudio) {
        currentlyPlayingAudio.pause();
        currentlyPlayingAudio.currentTime = 0;
        if (currentlyPlayingAudio._onResetUI) currentlyPlayingAudio._onResetUI();
        currentlyPlayingAudio = null;
    }
}

function resetAllCardHoverStates() {
    for (const cardObj of cardElements.values()) {
        if (cardObj.hoverPanel) cardObj.hoverPanel.style.display = "none";
        if (cardObj.leftHoverPanel) cardObj.leftHoverPanel.style.display = "none";
    }
}

let scrollToTopBtnEl = null;

function getScrollContainer() {
    if (!State.cardStack) return null;
    return State.cardStack.closest('.sidebar-content-container, [class*="sidebar-content-container"], [class*="overflow-y-auto"]') 
        || State.cardStack.parentElement 
        || State.cardStack;
}

function updateScrollTopBtnVisibility() {
    if (!scrollToTopBtnEl || !State.sidebarContainer || !State.sidebarContainer.isConnected) return;
    const scrollEl = getScrollContainer();
    if (scrollEl) {
        const viewportEl = scrollEl.parentElement || State.sidebarContainer;
        if (viewportEl && scrollToTopBtnEl.parentNode !== viewportEl) {
            if (window.getComputedStyle(viewportEl).position === "static") {
                viewportEl.style.position = "relative";
            }
            viewportEl.appendChild(scrollToTopBtnEl);
        }

        if (scrollEl.scrollTop > 200) {
            scrollToTopBtnEl.style.display = "flex";
        } else {
            scrollToTopBtnEl.style.display = "none";
        }
    }
}

const scrollListener = () => {
    if (State.sidebarContainer && State.sidebarContainer.isConnected) {
        updateScrollTopBtnVisibility();
    }
};

export function setupScrollListener() {
    document.addEventListener("scroll", scrollListener, { capture: true, passive: true });
    return () => {
        document.removeEventListener("scroll", scrollListener, { capture: true, passive: true });
    };
}

function findNodeIdForImage(state, img) {
    if (!state || !state.nodeOutputs || !img) return null;
    for (const nodeId in state.nodeOutputs) {
        const out = state.nodeOutputs[nodeId];
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
        background: "var(--comfy-menu-bg, #121212)", color: "var(--fg-color, #eee)", position: "relative"
    });

    const header = document.createElement("div");
    Object.assign(header.style, { position: "relative", marginBottom: "12px", height: "26px", display: "flex", alignItems: "center" });

    const standardHeader = document.createElement("div");
    Object.assign(standardHeader.style, { display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" });

    const titleGroup = document.createElement("div");
    Object.assign(titleGroup.style, { display: "flex", alignItems: "center", gap: "8px" });

    const searchIcon = document.createElement("span");
    searchIcon.className = "pi pi-search comfy-sidebar-icon-btn";
    searchIcon.title = "Search History";

    const title = document.createElement("h3");
    title.textContent = "Queue";
    Object.assign(title.style, { margin: "0", fontSize: "14px", fontWeight: "bold", opacity: "0.9", color: "var(--fg-color, #eee)" });

    titleGroup.appendChild(searchIcon);
    titleGroup.appendChild(title);
    standardHeader.appendChild(titleGroup);

    const actionsGroup = document.createElement("div");
    Object.assign(actionsGroup.style, { display: "flex", gap: "6px", alignItems: "center" });

    const createActionBtn = (iconClass, tooltip, hoverColor, onClickFn) => {
        const btn = document.createElement("button");
        btn.className = `${iconClass} comfy-sidebar-header-btn`;
        btn.title = tooltip;

        let timeout = null, isPending = false;
        const reset = () => {
            isPending = false;
            Object.assign(btn.style, { color: "var(--desc-color, #aaa)", background: "transparent", borderColor: "var(--border-color, #555)", boxShadow: "none" });
            if (timeout) { clearTimeout(timeout); timeout = null; }
        };

        btn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            if (!isPending) {
                isPending = true;
                Object.assign(btn.style, { color: "#fff", background: hoverColor, borderColor: hoverColor, boxShadow: `0 0 8px ${hoverColor}80` });
                timeout = setTimeout(reset, 1500);
            } else {
                reset();
                await onClickFn();
            }
        });
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
            scheduleStateSave();
            renderDOM();
        }
    });

    const btnClearAll = createActionBtn("pi pi-trash", "Clear All History", "#dc3545", async () => {
        for (const [pid, state] of promptStates.entries()) {
            if (state.status !== "pending" && state.status !== "active") {
                promptStates.delete(pid);
            }
        }
        try { await api.fetchApi("/history", { method: "POST", body: JSON.stringify({ clear: true }) }); } catch (err) {}
        scheduleStateSave();
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
    clearSearchBtn.className = "pi pi-times comfy-sidebar-icon-btn";
    clearSearchBtn.title = "Clear & Close Search";
    Object.assign(clearSearchBtn.style, { marginLeft: "6px" });

    searchContainer.appendChild(searchInputIcon); searchContainer.appendChild(searchInput); searchContainer.appendChild(clearSearchBtn);
    header.appendChild(standardHeader); header.appendChild(searchContainer); State.sidebarContainer.appendChild(header);

    searchIcon.addEventListener("click", (e) => { e.stopPropagation(); standardHeader.style.display = "none"; searchContainer.style.display = "flex"; searchInput.focus(); });
    const closeSearch = () => { searchInput.value = ""; State.currentSearchQuery = ""; searchContainer.style.display = "none"; standardHeader.style.display = "flex"; renderDOM(); };
    clearSearchBtn.addEventListener("click", (e) => { e.stopPropagation(); closeSearch(); });
    searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSearch(); });
    searchInput.addEventListener("input", () => { State.currentSearchQuery = searchInput.value.trim(); renderDOM(); });

    State.cardStack = document.createElement("div");
    Object.assign(State.cardStack.style, { flex: "1", overflowY: "visible", display: "block", paddingBottom: "28px" });
    State.sidebarContainer.appendChild(State.cardStack);

    scrollToTopBtnEl = document.createElement("button");
    scrollToTopBtnEl.className = "pi pi-chevron-up comfy-sidebar-scroll-top-btn";
    scrollToTopBtnEl.title = "Scroll to Top";

    scrollToTopBtnEl.addEventListener("click", (e) => {
        e.stopPropagation();
        const scrollEl = getScrollContainer();
        if (scrollEl) {
            scrollEl.scrollTo({ top: 0, behavior: "smooth" });
        }
    });

    State.sidebarContainer.appendChild(scrollToTopBtnEl);

    State.sidebarContainer.addEventListener("click", (e) => {
        if (State.activeSubmenuPromptId || State.activeSubmenuBatchImages) {
            if (e.target.closest('img, video, .comfy-sidebar-card-timer, .pi-times, .comfy-sidebar-left-hover-btn, .comfy-sidebar-queue-cancel-btn, button, span')) return;
            State.activeSubmenuPromptId = null;
            State.activeSubmenuBatchImages = null;
            resetAllCardHoverStates();
            renderDOM();
            document.removeEventListener("click", handleGlobalClick, true);
            globalClickRegistered = false;
        }
    });

    new ResizeObserver((entries) => {
        const threshold = app.ui.settings.getSettingValue("Comfy Sidebar.Grid Columns Threshold") ?? 350;
        const cols = Math.max(1, Math.floor(entries[0].contentRect.width / (threshold / 2)));
        if (State.cardStack) {
            State.cardStack.style.columnCount = cols.toString();
            State.cardStack.style.columnGap = cols > 1 ? "12px" : "0";
        }
    }).observe(State.sidebarContainer);

    setInterval(() => {
        if (State.currentlyActivePromptId === null) return;
        for (const [pid, state] of promptStates.entries()) {
            if (state.status === "active" && state.startTime) {
                const cardObj = cardElements.get(pid);
                if (cardObj && cardObj.timerEl) cardObj.timerEl.textContent = ((Date.now() - state.startTime) / 1000).toFixed(2) + "s";
            }
        }
    }, 250);

    return State.sidebarContainer;
}

function syncCardButtonVisibility(cardObj, state) {
    if (!cardObj) return;

    // Pending and currently running cards should never display hover action panels
    const isPendingOrActive = state.status === "pending" || state.status === "active";
    if (isPendingOrActive) {
        if (cardObj.hoverPanel) cardObj.hoverPanel.style.setProperty("display", "none", "important");
        if (cardObj.leftHoverPanel) cardObj.leftHoverPanel.style.setProperty("display", "none", "important");
        return;
    } else {
        if (cardObj.hoverPanel) cardObj.hoverPanel.style.removeProperty("display");
        if (cardObj.leftHoverPanel) cardObj.leftHoverPanel.style.removeProperty("display");
    }

    const isCompleted = state.status === "completed";
    const hasRealImages = isCompleted && state.images && state.images.length > 0 && !state.images.some(img => img.url && img.url.startsWith("blob:"));

    if (cardObj.btnImg) {
        if (hasRealImages) {
            cardObj.btnImg.style.removeProperty("display");
            cardObj.btnImg.style.display = "inline-flex";
            cardObj.btnImg.onclick = (ev) => {
                ev.stopPropagation();
                state.images.forEach(img => {
                    const a = document.createElement("a");
                    a.href = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
                    a.download = img.filename || "output";
                    a.click();
                });
            };
        } else {
            cardObj.btnImg.style.setProperty("display", "none", "important");
        }
    }

    if (cardObj.btnJson) {
        if (state.workflow) {
            cardObj.btnJson.style.removeProperty("display");
            cardObj.btnJson.style.display = "inline-flex";
            cardObj.btnJson.onclick = (ev) => {
                ev.stopPropagation();
                const blob = new Blob([JSON.stringify(state.workflow, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `workflow_${state.pid}.json`;
                a.click();
                URL.revokeObjectURL(url);
            };
        } else {
            cardObj.btnJson.style.setProperty("display", "none", "important");
        }
    }

    if (cardObj.btnDel) {
        cardObj.btnDel.style.removeProperty("display");
        cardObj.btnDel.style.display = "inline-flex";
    }

    if (cardObj.btnFocus) {
        const currentImg = hasRealImages ? state.images[cardObj.currentImageIndex || 0] : null;
        const nodeId = currentImg ? findNodeIdForImage(state, currentImg) : null;
        if (nodeId) {
            cardObj.btnFocus.style.removeProperty("display");
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
            cardObj.btnFocus.style.setProperty("display", "none", "important");
        }
    }

    if (cardObj.leftHoverBtn) {
        const outputs = getRunOutputs(state.nodeOutputs, state.workflow);
        if (outputs.length > 1) {
            cardObj.leftHoverBtn.style.removeProperty("display");
            cardObj.leftHoverBtn.style.display = "inline-flex";
            cardObj.leftHoverBtn.onclick = (ev) => {
                ev.stopPropagation();
                if (!State.activeSubmenuBatchImages && !State.activeSubmenuPromptId) {
                    const scrollEl = getScrollContainer();
                    if (scrollEl) State.mainQueueScrollTop = scrollEl.scrollTop;
                }
                State.activeSubmenuPromptId = state.pid;
                resetAllCardHoverStates();
                renderDOM();
            };
        } else {
            cardObj.leftHoverBtn.style.setProperty("display", "none", "important");
        }
    }
}

function render3DCardPreview(cardObj, wrapper, src, img, state) {
    let preview3D = wrapper.querySelector(".comfy-sidebar-3d-wrapper");
    const fullUrl = img.url ? img.url : window.location.origin + `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;

    const imageAssets = state?.images?.filter(i => !is3DFormat(i.filename || i.url) && !isVideoFormat(i.filename || i.url) && !isAudioFormat(i.filename || i.url)) || [];
    const lastImageAsset = imageAssets.length > 0 ? imageAssets[imageAssets.length - 1] : null;
    const bgImgSrc = lastImageAsset
        ? (lastImageAsset.url || window.location.origin + `/view?filename=${encodeURIComponent(lastImageAsset.filename)}&type=${lastImageAsset.type || 'output'}&subfolder=${encodeURIComponent(lastImageAsset.subfolder || '')}`)
        : null;

    if (!preview3D) {
        wrapper.innerHTML = "";
        preview3D = document.createElement("div");
        preview3D.className = "comfy-sidebar-3d-wrapper";

        if (bgImgSrc) {
            const bgImg = document.createElement("img");
            bgImg.className = "comfy-sidebar-3d-preview-img";
            bgImg.src = bgImgSrc;
            bgImg.alt = "3D Thumbnail Preview";
            preview3D.appendChild(bgImg);
        }

        const overlay = document.createElement("div");
        overlay.className = "comfy-sidebar-3d-overlay";

        const badge = document.createElement("span");
        badge.className = "comfy-sidebar-3d-badge";
        const ext = (img.filename || src).split('.').pop().toUpperCase();
        badge.textContent = ext || "3D";

        const icon = document.createElement("span");
        icon.className = "pi pi-box comfy-sidebar-3d-icon";

        const title = document.createElement("span");
        title.className = "comfy-sidebar-3d-title";
        title.textContent = img.filename || "3D Model";

        overlay.append(badge, icon, title);
        preview3D.appendChild(overlay);
        wrapper.appendChild(preview3D);
    } else {
        const bgImg = preview3D.querySelector(".comfy-sidebar-3d-preview-img");
        if (bgImg && bgImgSrc && bgImg.src !== bgImgSrc) {
            bgImg.src = bgImgSrc;
        } else if (!bgImg && bgImgSrc) {
            const newBgImg = document.createElement("img");
            newBgImg.className = "comfy-sidebar-3d-preview-img";
            newBgImg.src = bgImgSrc;
            newBgImg.alt = "3D Thumbnail Preview";
            preview3D.insertBefore(newBgImg, preview3D.firstChild);
        }
        const title = preview3D.querySelector(".comfy-sidebar-3d-title");
        if (title) title.textContent = img.filename || "3D Model";
    }

    cardObj.firstImgElement = preview3D;

    preview3D.onclick = (ev) => {
        ev.stopPropagation();
        showFullscreenPreview([fullUrl], ev.shiftKey);
    };

    preview3D.setAttribute("draggable", "true");
    preview3D.ondragstart = (e) => {
        e.stopPropagation();
        const filename = img.filename || "model.glb";
        const mimeType = "application/octet-stream";
        
        try {
            e.dataTransfer.setData("text/uri-list", fullUrl);
            e.dataTransfer.setData("text/plain", fullUrl);
            e.dataTransfer.setData("DownloadURL", `${mimeType}:${filename}:${fullUrl}`);
            if (state && state.workflow) {
                e.dataTransfer.setData("application/json", JSON.stringify(state.workflow));
            }
        } catch (err) {}
        e.dataTransfer.effectAllowed = "copy";
    };
}

function renderAudioCardPreview(cardObj, wrapper, src, img, state) {
    let previewAudio = wrapper.querySelector(".comfy-sidebar-audio-wrapper");
    const fullUrl = img.url ? img.url : window.location.origin + `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
    const filename = img.filename || getFilenameFromUrl(src) || "audio.wav";
    const ext = filename.split('.').pop().toUpperCase();

    const playIconSvg = `<svg viewBox="0 0 24 24" width="14" height="14" style="margin-left: 2px; pointer-events: none;"><polygon points="6,4 20,12 6,20" fill="#ffffff"/></svg>`;
    const stopIconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" style="pointer-events: none;"><rect x="5" y="5" width="14" height="14" rx="2" fill="#ffffff"/></svg>`;

    if (!previewAudio) {
        wrapper.innerHTML = "";
        previewAudio = document.createElement("div");
        previewAudio.className = "comfy-sidebar-audio-wrapper";

        const topRow = document.createElement("div");
        Object.assign(topRow.style, { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", paddingLeft: "42px" });

        const title = document.createElement("span");
        title.className = "comfy-sidebar-audio-title";
        title.textContent = filename;

        const badge = document.createElement("span");
        badge.className = "comfy-sidebar-audio-badge";
        badge.textContent = ext || "AUDIO";

        topRow.append(title, badge);

        const centerArea = document.createElement("div");
        Object.assign(centerArea.style, { position: "relative", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", margin: "6px 0" });

        const soundwave = document.createElement("div");
        soundwave.className = "comfy-sidebar-soundwave-container";
        soundwave.style.width = "100%";
        const barHeights = [10, 16, 24, 18, 30, 22, 14, 28, 34, 20, 12, 26, 32, 18, 14, 22, 30, 16, 12];
        barHeights.forEach((h, i) => {
            const bar = document.createElement("div");
            bar.className = "comfy-sidebar-soundwave-bar";
            bar.style.height = `${h}px`;
            bar.style.animationDelay = `${(i * 0.08).toFixed(2)}s`;
            soundwave.appendChild(bar);
        });

        const playBtn = document.createElement("button");
        Object.assign(playBtn.style, {
            position: "absolute", width: "36px", height: "36px", borderRadius: "50%",
            background: "rgba(22, 22, 30, 0.88)", border: "1px solid rgba(255, 255, 255, 0.25)",
            color: "#ffffff", cursor: "pointer", display: "flex", alignItems: "center",
            justifyContent: "center", boxShadow: "0 4px 12px rgba(0, 0, 0, 0.65)", zIndex: "5",
            transition: "all 0.15s ease", outline: "none"
        });
        playBtn.innerHTML = playIconSvg;

        centerArea.append(soundwave, playBtn);

        const bottomRow = document.createElement("div");
        Object.assign(bottomRow.style, { display: "flex", flexDirection: "column", gap: "4px", width: "100%", padding: "0 34px", boxSizing: "border-box" });

        const scrubber = document.createElement("div");
        Object.assign(scrubber.style, {
            width: "100%", height: "4px", background: "#334155", borderRadius: "2px",
            position: "relative", cursor: "pointer"
        });
        const scrubberFill = document.createElement("div");
        Object.assign(scrubberFill.style, { width: "0%", height: "100%", background: "#c084fc", borderRadius: "2px" });
        scrubber.appendChild(scrubberFill);

        const timeLabel = document.createElement("div");
        Object.assign(timeLabel.style, { fontSize: "9px", fontFamily: "monospace", color: "#94a3b8", textAlign: "center" });
        timeLabel.textContent = "0:00 / 0:00";

        bottomRow.append(scrubber, timeLabel);

        const audioEl = document.createElement("audio");
        audioEl.src = fullUrl;
        audioEl.preload = "metadata";

        const formatTime = (t) => {
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            return `${m}:${s < 10 ? '0' : ''}${s}`;
        };

        const resetAudioUI = () => {
            playBtn.innerHTML = playIconSvg;
            previewAudio.classList.remove("playing");
            scrubberFill.style.width = "0%";
            timeLabel.textContent = `0:00 / ${formatTime(audioEl.duration || 0)}`;
        };

        audioEl._onResetUI = resetAudioUI;

        audioEl.onloadedmetadata = () => {
            timeLabel.textContent = `0:00 / ${formatTime(audioEl.duration || 0)}`;
        };

        audioEl.ontimeupdate = () => {
            if (audioEl.duration > 0) {
                const percent = (audioEl.currentTime / audioEl.duration) * 100;
                scrubberFill.style.width = `${percent}%`;
                timeLabel.textContent = `${formatTime(audioEl.currentTime)} / ${formatTime(audioEl.duration)}`;
            }
        };

        audioEl.onended = () => {
            resetAudioUI();
            if (currentlyPlayingAudio === audioEl) currentlyPlayingAudio = null;
        };

        const togglePlay = (e) => {
            e.stopPropagation();

            if (isAudioViewerOpen()) {
                stopAllAudioPlayback();
                showFullscreenPreview([fullUrl]);
                return;
            }

            if (audioEl.paused) {
                stopAllAudioPlayback();
                currentlyPlayingAudio = audioEl;
                audioEl.play().catch(()=>{});
                playBtn.innerHTML = stopIconSvg;
                previewAudio.classList.add("playing");
            } else {
                audioEl.pause();
                audioEl.currentTime = 0;
                resetAudioUI();
                if (currentlyPlayingAudio === audioEl) currentlyPlayingAudio = null;
            }
        };

        playBtn.onclick = togglePlay;

        playBtn.onmouseenter = () => {
            playBtn.style.background = "#9333ea";
            playBtn.style.borderColor = "#c084fc";
            playBtn.style.transform = "scale(1.08)";
        };
        playBtn.onmouseleave = () => {
            playBtn.style.background = previewAudio.classList.contains("playing") ? "rgba(147, 51, 234, 0.85)" : "rgba(22, 22, 30, 0.88)";
            playBtn.style.borderColor = "rgba(255, 255, 255, 0.25)";
            playBtn.style.transform = "scale(1.0)";
        };

        scrubber.onclick = (e) => {
            e.stopPropagation();
            const rect = scrubber.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            if (audioEl.duration > 0) audioEl.currentTime = pos * audioEl.duration;
        };

        previewAudio.append(topRow, centerArea, bottomRow, audioEl);
        wrapper.appendChild(previewAudio);

        previewAudio.onclick = (e) => {
            if (e.target.closest('button, input') || e.target === scrubber || e.target === scrubberFill) return;
            stopAllAudioPlayback();
            showFullscreenPreview([fullUrl]);
        };
    }

    cardObj.firstImgElement = previewAudio;

    previewAudio.setAttribute("draggable", "true");
    previewAudio.ondragstart = (e) => {
        e.stopPropagation();
        const mimeType = "audio/wav";
        try {
            e.dataTransfer.setData("text/uri-list", fullUrl);
            e.dataTransfer.setData("text/plain", fullUrl);
            e.dataTransfer.setData("DownloadURL", `${mimeType}:${filename}:${fullUrl}`);
            if (state && state.workflow) {
                e.dataTransfer.setData("application/json", JSON.stringify(state.workflow));
            }
        } catch (err) {}
        e.dataTransfer.effectAllowed = "copy";
    };
}

function renderCardImages(cardObj, state) {
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
    const is3D = is3DFormat(src) || is3DFormat(img.filename);
    const isAudio = isAudioFormat(src) || isAudioFormat(img.filename);

    let wrapper = cardObj.grid.querySelector(".comfy-sidebar-media-wrapper");
    if (!wrapper) {
        cardObj.grid.innerHTML = "";
        wrapper = document.createElement("div");
        wrapper.className = "comfy-sidebar-media-wrapper";
        Object.assign(wrapper.style, { position: "relative", width: "100%", display: "block" });
        cardObj.grid.appendChild(wrapper);
    }

    if (is3D) {
        render3DCardPreview(cardObj, wrapper, src, img, state);
        return;
    }

    if (isAudio) {
        renderAudioCardPreview(cardObj, wrapper, src, img, state);
        return;
    }

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

    mediaEl.onclick = (ev) => { 
        ev.stopPropagation(); 
        showFullscreenPreview([src], ev.shiftKey); 
    };

    mediaEl.onerror = async () => {
        if (src && !src.startsWith("blob:") && !is3D && !isAudio) {
            try {
                const res = await fetch(src, { method: "HEAD" });
                if (res.status === 404) {
                    deletePromptState(state.pid);
                    scheduleStateSave();
                    if (cardObj.element) cardObj.element.remove();
                    return;
                }
            } catch (e) {}
            if (cardObj.placeholder) {
                cardObj.placeholder.textContent = "Error loading media preview";
                cardObj.placeholder.style.display = "block";
            }
        }
    };

    const applyDimensions = (width, height) => {
        if (cardObj.dimEl && width && height) {
            cardObj.dimEl.textContent = `${width}x${height}`;
            cardObj.dimEl.style.display = "block";
        }
    };

    const isUnfinished = state.status ? (state.status !== "completed") : false;
    if (isUnfinished) {
        mediaEl.setAttribute("draggable", "false");
        mediaEl.style.cursor = "grab";
        if (mediaEl._currentDragStart) {
            mediaEl.removeEventListener("dragstart", mediaEl._currentDragStart);
            delete mediaEl._currentDragStart;
        }
    } else {
        mediaEl.setAttribute("draggable", "true");
        mediaEl.style.cursor = "zoom-in";

        if (isVideo) {
            const fullSrc = src.startsWith("http") ? src : window.location.origin + src;
            const filename = img.filename || "output.mp4";
            const mimeType = src.includes(".webm") ? "video/webm" : "video/mp4";

            const videoDragHandler = (e) => {
                try {
                    e.dataTransfer.setData("text/uri-list", fullSrc);
                    e.dataTransfer.setData("text/plain", fullSrc);
                    e.dataTransfer.setData("DownloadURL", `${mimeType}:${filename}:${fullSrc}`);
                    if (state && state.workflow) {
                        e.dataTransfer.setData("application/json", JSON.stringify(state.workflow));
                    }
                } catch (err) {}
                e.dataTransfer.effectAllowed = "copy";
                e.stopPropagation();
            };

            if (mediaEl._currentDragStart) {
                mediaEl.removeEventListener("dragstart", mediaEl._currentDragStart);
            }
            mediaEl.addEventListener("dragstart", videoDragHandler);
            mediaEl._currentDragStart = videoDragHandler;
        } else {
            if (mediaEl._currentDragStart) {
                mediaEl.removeEventListener("dragstart", mediaEl._currentDragStart);
                delete mediaEl._currentDragStart;
            }
        }
    }

    if (isVideo) { 
        mediaEl.muted = true; 
        mediaEl.playsInline = true; 
        mediaEl.preload = "metadata";
        mediaEl.loop = true;

        mediaEl.onloadedmetadata = () => {
            applyDimensions(mediaEl.videoWidth, mediaEl.videoHeight);
        };
        if (mediaEl.readyState >= 1) {
            applyDimensions(mediaEl.videoWidth, mediaEl.videoHeight);
        }
        
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
        mediaEl.onload = () => { 
            applyDimensions(mediaEl.naturalWidth, mediaEl.naturalHeight);
            if (state._oldPreviewBlobUrl) {
                try { URL.revokeObjectURL(state._oldPreviewBlobUrl); } catch(e){}
                delete state._oldPreviewBlobUrl;
            }
        };
        if (mediaEl.complete && mediaEl.naturalWidth) {
            applyDimensions(mediaEl.naturalWidth, mediaEl.naturalHeight);
        }

        const playIcon = wrapper.querySelector(".comfy-sidebar-play-icon");
        if (playIcon) playIcon.remove();
    }

    const currentSrc = mediaEl.getAttribute("src") || mediaEl.src;
    if (currentSrc !== src && currentSrc !== (currentSrc + "#t=0.001")) {
        if (src.startsWith("blob:") && !isVideo) {
            const tempImg = new Image();
            tempImg.onload = () => {
                const oldBlob = mediaEl._lastBlob;
                mediaEl.src = src;
                mediaEl._lastBlob = src;
                applyDimensions(tempImg.naturalWidth, tempImg.naturalHeight);
                if (oldBlob && oldBlob !== src && oldBlob.startsWith("blob:")) {
                    try { URL.revokeObjectURL(oldBlob); } catch(e){}
                }
            };
            tempImg.src = src;
        } else {
            mediaEl.src = isVideo ? src + "#t=0.001" : src;
        }
    } else {
        if (isVideo) {
            if (mediaEl.videoWidth) applyDimensions(mediaEl.videoWidth, mediaEl.videoHeight);
        } else {
            if (mediaEl.naturalWidth) applyDimensions(mediaEl.naturalWidth, mediaEl.naturalHeight);
        }
    }

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
                renderCardImages(cardObj, state);
            };

            const label = document.createElement("span");
            label.className = "comfy-sidebar-batch-label";
            label.textContent = `${idx + 1}/${state.images.length}`;
            label.style.cursor = "pointer";
            label.title = "View all images in this batch";
            
            label.onclick = (ev) => {
                ev.stopPropagation();
                if (!State.activeSubmenuBatchImages && !State.activeSubmenuPromptId) {
                    const scrollEl = getScrollContainer();
                    if (scrollEl) State.mainQueueScrollTop = scrollEl.scrollTop;
                }
                State.activeSubmenuBatchImages = {
                    pid: state.pid || cardObj.element.id.replace("card-", ""),
                    images: state.images,
                    workflow: state.workflow,
                    nodeOutputs: state.nodeOutputs
                };
                resetAllCardHoverStates();
                renderDOM();
            };

            const nextBtn = document.createElement("span");
            nextBtn.className = "pi pi-chevron-right";
            nextBtn.style.cursor = "pointer";
            nextBtn.onclick = (ev) => {
                ev.stopPropagation();
                cardObj.currentImageIndex = (cardObj.currentImageIndex + 1) % state.images.length;
                renderCardImages(cardObj, state);
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

const handleGlobalClick = (e) => {
    if (!State.activeSubmenuPromptId && !State.activeSubmenuBatchImages) {
        document.removeEventListener("click", handleGlobalClick, true);
        globalClickRegistered = false;
        return;
    }
    const sidebar = State.sidebarContainer;
    const clickedInsideSidebar = sidebar && sidebar.contains(e.target);
    const clickedFullscreenOverlay = e.target.closest('div[style*="zIndex: 999"], .comfy-sidebar-comparison-overlay');
    
    if (!clickedInsideSidebar && !clickedFullscreenOverlay) {
        State.activeSubmenuPromptId = null;
        State.activeSubmenuBatchImages = null;
        resetAllCardHoverStates();
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
        const showWorkingNode = app.ui.settings.getSettingValue("Comfy Sidebar.Show Working Node Name") ?? true;

        const headerTitle = State.sidebarContainer.querySelector("h3");
        const headerSearchIcon = State.sidebarContainer.querySelector(".pi-search");
        const headerActions = State.sidebarContainer.querySelector(".pi-eraser")?.parentNode;

        if (State.activeSubmenuBatchImages) {
            const batchInfo = State.activeSubmenuBatchImages;

            if (headerTitle) {
                headerTitle.textContent = `Batch of #${batchInfo.pid}`;
                headerTitle.style.cursor = "pointer";
                headerTitle.title = "Go Back to Queue";
                headerTitle.onclick = () => { 
                    State.activeSubmenuBatchImages = null; 
                    resetAllCardHoverStates(); 
                    renderDOM(); 
                };
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
                    p.className = "comfy-sidebar-text-clamp";

                    const hoverPanel = document.createElement("div");
                    hoverPanel.className = "comfy-sidebar-hover-panel";
                    Object.assign(hoverPanel.style, {
                        position: "absolute", bottom: "4px", right: "4px",
                        flexDirection: "column", gap: "4px", zIndex: "20"
                    });

                    const btnImg = document.createElement("span");
                    btnImg.className = "pi pi-image comfy-sidebar-card-action-btn";
                    btnImg.title = "Download Object";
                    hoverPanel.appendChild(btnImg);

                    const leftHoverPanel = document.createElement("div");
                    leftHoverPanel.className = "comfy-sidebar-left-hover-panel";
                    Object.assign(leftHoverPanel.style, {
                        position: "absolute", bottom: "4px", left: "4px",
                        flexDirection: "column", gap: "4px", zIndex: "20"
                    });

                    const btnFocus = document.createElement("span");
                    btnFocus.className = "pi pi-eye comfy-sidebar-card-action-btn";
                    btnFocus.title = "Show Node";
                    leftHoverPanel.appendChild(btnFocus);

                    card.append(timerEl, dimEl, grid, p, hoverPanel, leftHoverPanel);
                    cardObj = { element: card, timerEl, dimEl, grid, placeholder: p, hoverPanel, leftHoverPanel, btnFocus, btnImg, firstImgElement: null };
                    cardElements.set(cardId, cardObj);

                    card.addEventListener("mouseenter", () => {
                        syncCardButtonVisibility(cardObj, { status: "completed", images: [img], workflow: batchInfo.workflow, nodeOutputs: batchInfo.nodeOutputs });
                    });
                }

                cardObj.placeholder.style.display = "none";
                renderCardImages(cardObj, { pid: batchInfo.pid, status: "completed", images: [img], workflow: batchInfo.workflow, nodeOutputs: batchInfo.nodeOutputs });
                targetElements.push(cardObj.element);
            });

            targetElements.forEach((el, index) => { if (State.cardStack.children[index] !== el) State.cardStack.insertBefore(el, State.cardStack.children[index] || null); });
            while (State.cardStack.children.length > targetElements.length) State.cardStack.removeChild(State.cardStack.lastChild);

            const scrollEl = getScrollContainer();
            if (scrollEl) scrollEl.scrollTop = 0;
            updateScrollTopBtnVisibility();
            return;
        }

        if (State.activeSubmenuPromptId) {
            const st = promptStates.get(State.activeSubmenuPromptId);
            if (!st) {
                State.activeSubmenuPromptId = null;
                renderDOM();
                return;
            }

            if (headerTitle) {
                headerTitle.textContent = `Outputs of #${State.activeSubmenuPromptId}`;
                headerTitle.style.cursor = "pointer";
                headerTitle.title = "Go Back to Queue";
                headerTitle.onclick = () => { 
                    State.activeSubmenuPromptId = null; 
                    resetAllCardHoverStates(); 
                    renderDOM(); 
                };
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
                    p.className = "comfy-sidebar-text-clamp";

                    const hoverPanel = document.createElement("div");
                    hoverPanel.className = "comfy-sidebar-hover-panel";
                    Object.assign(hoverPanel.style, {
                        position: "absolute", bottom: "4px", right: "4px",
                        flexDirection: "column", gap: "4px", zIndex: "20"
                    });

                    const btnImg = document.createElement("span");
                    btnImg.className = "pi pi-image comfy-sidebar-card-action-btn";
                    btnImg.title = "Download Object";
                    hoverPanel.appendChild(btnImg);

                    const leftHoverPanel = document.createElement("div");
                    leftHoverPanel.className = "comfy-sidebar-left-hover-panel";
                    Object.assign(leftHoverPanel.style, {
                        position: "absolute", bottom: "4px", left: "4px",
                        flexDirection: "column", gap: "4px", zIndex: "20"
                    });

                    const btnFocus = document.createElement("span");
                    btnFocus.className = "pi pi-eye comfy-sidebar-card-action-btn";
                    btnFocus.title = "Show Node";
                    leftHoverPanel.appendChild(btnFocus);
                    
                    card.append(timerEl, dimEl, grid, p, hoverPanel, leftHoverPanel);
                    cardObj = { element: card, timerEl, dimEl, grid, placeholder: p, hoverPanel, leftHoverPanel, btnFocus, btnImg, firstImgElement: null };
                    cardElements.set(cardId, cardObj);

                    card.addEventListener("mouseenter", () => {
                        syncCardButtonVisibility(cardObj, { status: "completed", images: out.images, workflow: st.workflow, nodeOutputs: st.nodeOutputs });
                    });
                }

                if (out.images && out.images.length > 0) {
                    cardObj.placeholder.style.display = "none";
                    renderCardImages(cardObj, { pid: st.pid, status: "completed", images: out.images, workflow: st.workflow, nodeOutputs: st.nodeOutputs });
                } else {
                    cardObj.placeholder.style.display = "block";
                    cardObj.placeholder.textContent = "No Outputs";
                }

                targetElements.push(cardObj.element);
            });

            targetElements.forEach((el, index) => { if (State.cardStack.children[index] !== el) State.cardStack.insertBefore(el, State.cardStack.children[index] || null); });
            while (State.cardStack.children.length > targetElements.length) State.cardStack.removeChild(State.cardStack.lastChild);

            const scrollEl = getScrollContainer();
            if (scrollEl) scrollEl.scrollTop = 0;
            updateScrollTopBtnVisibility();
            return;
        }

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
            if (cardObj && isFinalStatus && state.rendered) {
                syncCardButtonVisibility(cardObj, state);
                return cardObj.element;
            }
            
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
                p.className = "comfy-sidebar-text-clamp";

                const pt = document.createElement("div"); Object.assign(pt.style, { width: "100%", height: "4px", background: "#333", borderRadius: "2px", marginTop: "8px", overflow: "hidden", display: "none" });
                const pb = document.createElement("div"); Object.assign(pb.style, { width: `0%`, height: "100%", background: "#3b82f6", transition: "width 0.1s linear" });
                pt.appendChild(pb);
                const statusText = document.createElement("div"); Object.assign(statusText.style, { fontSize: "11px", opacity: "0.9", color: "#3b82f6", textAlign: "center", marginTop: "6px", display: "none", fontWeight: "bold" });
                
                const hoverPanel = document.createElement("div"); 
                hoverPanel.className = "comfy-sidebar-hover-panel";
                Object.assign(hoverPanel.style, { 
                    position: "absolute", bottom: "4px", right: "4px", 
                    flexDirection: "column", gap: "4px", zIndex: "20" 
                });

                const btnImg = document.createElement("span"); btnImg.className = "pi pi-image comfy-sidebar-card-action-btn"; btnImg.title = "Download Object";
                const btnJson = document.createElement("span"); btnJson.className = "pi pi-file comfy-sidebar-card-action-btn"; btnJson.title = "Download JSON";
                const btnDel = document.createElement("span"); btnDel.className = "pi pi-trash comfy-sidebar-card-action-btn"; btnDel.title = "Delete Card";

                const leftHoverPanel = document.createElement("div"); 
                leftHoverPanel.className = "comfy-sidebar-left-hover-panel";
                Object.assign(leftHoverPanel.style, { 
                    position: "absolute", bottom: "4px", left: "4px", 
                    flexDirection: "column", gap: "4px", zIndex: "20" 
                });

                const btnFocus = document.createElement("span");
                btnFocus.className = "pi pi-eye comfy-sidebar-card-action-btn";
                btnFocus.title = "Show Node";

                const leftHoverBtn = document.createElement("span");
                leftHoverBtn.className = "pi pi-images comfy-sidebar-card-action-btn";
                leftHoverBtn.title = "View all intermediate outputs";

                hoverPanel.append(btnImg, btnJson, btnDel);
                leftHoverPanel.append(btnFocus, leftHoverBtn);

                card.append(timerEl, cancelX, sBadge, grid, p, pt, statusText, hoverPanel, leftHoverPanel);
                
                cardObj = { element: card, timerEl, statusBadge: sBadge, grid, placeholder: p, progressContainer: pt, progressBar: pb, cancelBtn: cancelX, hoverPanel, leftHoverPanel, btnFocus, leftHoverBtn, btnImg, btnJson, btnDel, statusText, firstImgElement: null, lastImagesSignature: "" };
                
                card.addEventListener("mouseenter", () => { 
                    syncCardButtonVisibility(cardObj, state);
                });
                
                card.addEventListener("dragstart", (e) => {
                    const isUnfinished = state.status && state.status !== "completed";
                    const hasNoImages = !state.images || state.images.length === 0;

                    if (state.workflow && (hasNoImages || isUnfinished)) {
                        if (cardObj.firstImgElement) {
                            try { e.dataTransfer.setDragImage(cardObj.firstImgElement, 15, 15); } catch(err){}
                        }
                        const jsonStr = JSON.stringify(state.workflow, null, 2);
                        const filename = `workflow_${state.pid}.json`;
                        const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

                        try { 
                            e.dataTransfer.setData("DownloadURL", `application/json:${filename}:data:application/json;base64,${base64Data}`);
                            e.dataTransfer.setData("application/json", jsonStr); 
                        } catch (err) {}
                        e.dataTransfer.effectAllowed = "copy";
                    }
                });
                cardObj.element.id = `card-${state.pid}`;
                cardElements.set(state.pid, cardObj);
            }

            syncCardButtonVisibility(cardObj, state);

            cardObj.element.className = `comfy-sidebar-card ${state.status}`;
            
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
                    await api.interrupt();
                    await syncQueueFn(); 
                };
            } else {
                cardObj.cancelBtn.style.display = "none";
            }

            let deleteTimeout = null, isDeletePending = false;
            const resetDeleteBtn = () => { 
                isDeletePending = false; 
                cardObj.btnDel.classList.remove("confirm-delete");
                cardObj.btnDel.title = "Delete Card"; 
                if (deleteTimeout) { clearTimeout(deleteTimeout); deleteTimeout = null; } 
            };
            
            cardObj.btnDel.onclick = async (ev) => {
                ev.stopPropagation();
                if (!isDeletePending) {
                    isDeletePending = true; 
                    cardObj.btnDel.classList.add("confirm-delete");
                    cardObj.btnDel.title = "Click again to confirm deletion";
                    deleteTimeout = setTimeout(resetDeleteBtn, 1500);
                } else {
                    resetDeleteBtn(); 
                    promptStates.delete(state.pid); 
                    await api.fetchApi("/history", { method: "POST", body: JSON.stringify({ delete: [state.pid] }) }); 
                    scheduleStateSave();
                    renderDOM();
                }
            };

            const currentImagesSignature = `${state.status || ""}:${state.images ? state.images.map(img => img.url || img.filename).join("|") : ""}`;
            if (cardObj.lastImagesSignature !== currentImagesSignature) {
                if (!state.images || state.images.length === 0) {
                    cardObj.grid.innerHTML = ""; cardObj.firstImgElement = null; cardObj.placeholder.style.display = "block";
                } else {
                    cardObj.placeholder.style.display = "none";
                    renderCardImages(cardObj, state);
                }
                cardObj.lastImagesSignature = currentImagesSignature;
            }

            if (state.images.length === 0) {
                if (state.texts && state.texts.length > 0) {
                    const fullText = state.texts.join("\n\n");
                    cardObj.placeholder.textContent = fullText;
                    cardObj.placeholder.title = "Click to read full text";
                    cardObj.placeholder.className = "comfy-sidebar-text-clamp";
                    cardObj.placeholder.style.display = "-webkit-box";
                    cardObj.placeholder.onclick = (e) => {
                        e.stopPropagation();
                        stopAllAudioPlayback();
                        showFullscreenPreview([{ text: fullText, pid: state.pid }]);
                    };
                } else {
                    cardObj.placeholder.textContent = state.progressText || "No Outputs";
                    cardObj.placeholder.className = "";
                    Object.assign(cardObj.placeholder.style, {
                        fontSize: "11px", opacity: "0.5", textAlign: "center", padding: "12px", marginTop: "12px",
                        userSelect: "none", whiteSpace: "normal", maxHeight: "none", display: "block", cursor: "default"
                    });
                    cardObj.placeholder.onclick = null;
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

        for (const [pid] of cardElements.entries()) { 
            if (pid !== "pending-summary-card" && pid !== "pending-cancel-all-standalone" && !promptStates.has(pid)) cardElements.delete(pid); 
        }

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

        if (State.mainQueueScrollTop !== null) {
            const restorePos = State.mainQueueScrollTop;
            State.mainQueueScrollTop = null;

            const scrollEl = getScrollContainer();
            if (scrollEl) {
                scrollEl.scrollTop = restorePos;
                requestAnimationFrame(() => {
                    scrollEl.scrollTop = restorePos;
                });
            }
        }

        updateScrollTopBtnVisibility();
    });
}