import { app } from "/scripts/app.js";
import { PromptStatus, StoreEvents, SettingIds } from "../core/constants.js";
import { store } from "../core/store.js";
import { t } from "../core/i18n.js";
import { getOrCreateCard, updateCardDOM, resetAllCardHoverStates, cardPool } from "./cardRenderer.js";
import { clearCancelledOrFailed, clearAllHistory, cancelAllPending } from "../queue/queueService.js";
import { updateSidebarBadge, centerAndSelectCanvasNode } from "../comfy/adapter.js";
import { matchesFilter, getRunOutputs, isImageFormat, animateCardRemoval, getScrollContainer, calculateGridColumns, setupSpotlightTracker, attachDeleteConfirmation } from "../utils/utils.js";
import { getSetting } from "../core/settings.js";
import { renderCardImages } from "./mediaPreview.js";
import { deleteFileOnServer, moveTempImageToOutput, updateMovedImageReferences, removeImageFromNodeOutputs, copyImageToClipboard, findNodeIdForImage } from "./mediaActions.js";
import { toggleIgnoreActiveNode } from "../comfy/nodes.js";
import { renumberNodesTopologically, showNotification } from "../utils/nodeRenumber.js";

let scrollToTopBtnEl = null;
let globalClickRegistered = false;
let renderAnimationFrameId = null;
let activeTimerInterval = null;
let currentColumnCount = 1;
let stickyHeaderGroupEl = null;
let lastScrollTop = 0;
let scrollDeltaAccumulator = 0;
let isHeaderHidden = false;

function mountCards(cardStack, fullWidthEls, cardEls, cols = 1) {
    if (!cardStack) return;

    // 1. Full-width container (for banners like Pending Queue summary)
    let bannerContainer = cardStack.querySelector('.comfy-sidebar-banners');
    if (!bannerContainer) {
        bannerContainer = document.createElement('div');
        bannerContainer.className = 'comfy-sidebar-banners';
        Object.assign(bannerContainer.style, { display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' });
        cardStack.insertBefore(bannerContainer, cardStack.firstChild);
    }
    fullWidthEls.forEach((el, i) => {
        if (bannerContainer.children[i] !== el) {
            bannerContainer.insertBefore(el, bannerContainer.children[i] || null);
        }
    });
    while (bannerContainer.children.length > fullWidthEls.length) {
        bannerContainer.removeChild(bannerContainer.lastChild);
    }
    bannerContainer.style.display = fullWidthEls.length > 0 ? 'flex' : 'none';
    bannerContainer.style.marginBottom = fullWidthEls.length > 0 ? '12px' : '0';

    // 2. Masonry Columns container
    let columnsWrapper = cardStack.querySelector('.comfy-sidebar-masonry-wrapper');
    if (!columnsWrapper) {
        columnsWrapper = document.createElement('div');
        columnsWrapper.className = 'comfy-sidebar-masonry-wrapper';
        Object.assign(columnsWrapper.style, { display: 'flex', gap: '12px', alignItems: 'flex-start', width: '100%' });
        cardStack.appendChild(columnsWrapper);
    }

    while (columnsWrapper.children.length < cols) {
        const colDiv = document.createElement('div');
        colDiv.className = 'comfy-sidebar-masonry-col';
        Object.assign(colDiv.style, { flex: '1', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '0' });
        columnsWrapper.appendChild(colDiv);
    }
    while (columnsWrapper.children.length > cols) {
        columnsWrapper.removeChild(columnsWrapper.lastChild);
    }

    // Distribute cards into the shortest column so short cards stack next to tall cards
    const colBuckets = Array.from({ length: cols }, () => []);
    const colHeights = new Array(cols).fill(0);

    cardEls.forEach((cardEl) => {
        let shortestCol = 0;
        for (let c = 1; c < cols; c++) {
            if (colHeights[c] < colHeights[shortestCol]) {
                shortestCol = c;
            }
        }
        colBuckets[shortestCol].push(cardEl);

        const cardH = cardEl.offsetHeight > 0 ? cardEl.offsetHeight : (cardEl._cachedHeight || 160);
        cardEl._cachedHeight = cardH;
        colHeights[shortestCol] += cardH + 12;
    });

    for (let c = 0; c < cols; c++) {
        const colDiv = columnsWrapper.children[c];
        const bucket = colBuckets[c];
        bucket.forEach((el, i) => {
            if (colDiv.children[i] !== el) {
                colDiv.insertBefore(el, colDiv.children[i] || null);
            }
        });
        while (colDiv.children.length > bucket.length) {
            colDiv.removeChild(colDiv.lastChild);
        }
    }
}

function handleQueueHeaderScroll(scrollEl) {
    if (!stickyHeaderGroupEl) return;

    const currentScroll = scrollEl.scrollTop;
    const searchContainer = stickyHeaderGroupEl.querySelector(".comfy-sidebar-search-container");
    const searchIsOpen = searchContainer && searchContainer.style.display !== "none";

    // Keep the frosted surface visible while search is open, matching Gallery.
    stickyHeaderGroupEl.classList.toggle("is-scrolled", currentScroll > 35);

    if (searchIsOpen) {
        lastScrollTop = currentScroll;
        scrollDeltaAccumulator = 0;
        stickyHeaderGroupEl.style.transform = "translateY(0)";
        isHeaderHidden = false;
        return;
    }

    const delta = currentScroll - lastScrollTop;
    lastScrollTop = currentScroll;

    if (currentScroll <= 35) {
        stickyHeaderGroupEl.classList.remove("is-scrolled");
        if (isHeaderHidden) {
            stickyHeaderGroupEl.style.transform = "translateY(0)";
            isHeaderHidden = false;
        }
        scrollDeltaAccumulator = 0;
        return;
    }

    stickyHeaderGroupEl.classList.add("is-scrolled");

    if (delta > 0) {
        if (scrollDeltaAccumulator < 0) scrollDeltaAccumulator = 0;
        scrollDeltaAccumulator += delta;

        if (scrollDeltaAccumulator > 25 && !isHeaderHidden) {
            stickyHeaderGroupEl.style.transform = "translateY(-100%)";
            isHeaderHidden = true;
        }
    } else if (delta < 0) {
        if (scrollDeltaAccumulator > 0) scrollDeltaAccumulator = 0;
        scrollDeltaAccumulator += delta;

        if (scrollDeltaAccumulator < -15 && isHeaderHidden) {
            stickyHeaderGroupEl.style.transform = "translateY(0)";
            isHeaderHidden = false;
        }
    }
}

function updateScrollTopBtnVisibility() {
    if (!scrollToTopBtnEl) return;
    if (!store.ui.sidebarContainer || !store.ui.sidebarContainer.isConnected) {
        scrollToTopBtnEl.style.display = "none";
        return;
    }
    const scrollEl = getScrollContainer(store.ui.cardStack);
    if (scrollEl) {
        const viewportEl = scrollEl.parentElement || store.ui.sidebarContainer;
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

        handleQueueHeaderScroll(scrollEl);
    }
}

const handleGlobalKeyDown = (e) => {
    if (e.key === "Control" || e.key === "Meta") {
        document.body.classList.add("comfy-sidebar-ctrl-active");
    }
};

const handleGlobalKeyUp = (e) => {
    if (e.key === "Control" || e.key === "Meta") {
        document.body.classList.remove("comfy-sidebar-ctrl-active");
    }
};

const handleGlobalBlur = () => {
    document.body.classList.remove("comfy-sidebar-ctrl-active");
};

const handleGlobalClick = (e) => {
    if (!store.ui.activeSubmenuPromptId && !store.ui.activeSubmenuBatchImages) {
        document.removeEventListener("click", handleGlobalClick, true);
        globalClickRegistered = false;
        return;
    }
    const sidebar = store.ui.sidebarContainer;
    const clickedInsideSidebar = sidebar && sidebar.contains(e.target);
    const clickedFullscreenOverlay = e.target.closest('div[style*="zIndex: 999"], .comfy-sidebar-comparison-overlay');

    if (!clickedInsideSidebar && !clickedFullscreenOverlay) {
        store.closeSubmenu();
        resetAllCardHoverStates();
        renderSidebar();
        document.removeEventListener("click", handleGlobalClick, true);
        globalClickRegistered = false;
    }
};

export function setupSidebarView() {
    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener("keyup", handleGlobalKeyUp);
    window.addEventListener("blur", handleGlobalBlur);

    const container = document.createElement("div");
    store.ui.sidebarContainer = container;

    Object.assign(container.style, {
        display: "flex", flexDirection: "column", height: "100%", padding: "14px", boxSizing: "border-box",
        background: "transparent",
        color: "var(--fg-color, var(--p-text-color, #eee))", position: "relative"
    });

    const header = document.createElement("div");
    header.className = "comfy-sidebar-header-root";
    Object.assign(header.style, { position: "relative", marginBottom: "12px", height: "26px", display: "flex", alignItems: "center" });

    const standardHeader = document.createElement("div");
    standardHeader.className = "comfy-sidebar-standard-header";
    Object.assign(standardHeader.style, { display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" });

    const titleGroup = document.createElement("div");
    Object.assign(titleGroup.style, { display: "flex", alignItems: "center", gap: "8px" });

    const searchIcon = document.createElement("span");
    searchIcon.className = "pi pi-search comfy-sidebar-icon-btn";
    searchIcon.title = t("Search History");

    const title = document.createElement("h3");
    title.textContent = t("Queue");
    Object.assign(title.style, { margin: "0", fontSize: "14px", fontWeight: "bold", opacity: "0.9", color: "var(--fg-color, #eee)" });

    titleGroup.appendChild(searchIcon);
    titleGroup.appendChild(title);
    standardHeader.appendChild(titleGroup);

    const actionsGroup = document.createElement("div");
    Object.assign(actionsGroup.style, { display: "flex", gap: "5px", alignItems: "center" });

    const createInstantBtn = (iconClass, tooltip, onClickFn) => {
        const btn = document.createElement("button");
        btn.className = `${iconClass} comfy-sidebar-header-btn`;
        btn.title = tooltip;
        btn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            btn.style.transform = "scale(0.88)";
            setTimeout(() => { btn.style.transform = ""; }, 120);
            await onClickFn();
        });
        return btn;
    };

    const createActionBtn = (iconClass, tooltip, hoverColor, onClickFn) => {
        const btn = document.createElement("button");
        btn.className = `${iconClass} comfy-sidebar-header-btn`;
        btn.title = tooltip;

        let timeout = null, isPending = false;
        const reset = () => {
            isPending = false;
            Object.assign(btn.style, {
                color: "", background: "",
                borderColor: "", boxShadow: ""
            });
            if (timeout) { clearTimeout(timeout); timeout = null; }
        };

        btn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            if (!isPending) {
                isPending = true;
                Object.assign(btn.style, {
                    color: "#fff", background: hoverColor, borderColor: hoverColor,
                    boxShadow: `0 0 8px ${hoverColor}80`
                });
                timeout = setTimeout(reset, 1500);
            } else {
                reset();
                await onClickFn();
            }
        });
        return btn;
    };

    const btnToggleIgnore = createInstantBtn("pi pi-eye-slash", t("Toggle Ignore Selected Node(s) in Queue (Ctrl+Q)"), () => {
        const raw = app.canvas?.selected_nodes;
        const selected = raw instanceof Map || raw instanceof Set
            ? Array.from(raw.values())
            : (Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : []));
        const selectedNodes = selected.length > 0 ? selected : (app.canvas?.selected_node ? [app.canvas.selected_node] : []);

        if (selectedNodes.length === 0) {
            showNotification(t("No nodes selected. Click a node on the canvas first to toggle ignore."), "warn");
            return;
        }

        toggleIgnoreActiveNode(() => renderSidebar());
    });

    const btnRenumber = createInstantBtn("pi pi-sort-numeric-down", t("Renumber All Nodes by Execution Order (Alt+R)"), async () => {
        await renumberNodesTopologically();
    });

    const divider = document.createElement("div");
    Object.assign(divider.style, {
        width: "1px", height: "14px", background: "var(--border, var(--border-color, #444))",
        margin: "0 2px", opacity: "0.6"
    });

    const btnClearInterrupted = createActionBtn("pi pi-eraser", t("Clear Cancelled & Failed"), "#ffc107", async () => {
        await clearCancelledOrFailed();
        renderSidebar();
    });

    const btnClearAll = createActionBtn("pi pi-trash", t("Clear All History"), "#dc3545", async () => {
        await clearAllHistory();
        renderSidebar();
    });

    actionsGroup.appendChild(btnToggleIgnore);
    actionsGroup.appendChild(btnRenumber);
    actionsGroup.appendChild(divider);
    actionsGroup.appendChild(btnClearInterrupted);
    actionsGroup.appendChild(btnClearAll);
    standardHeader.appendChild(actionsGroup);

    const searchContainer = document.createElement("div");
    searchContainer.className = "comfy-sidebar-search-container";
    Object.assign(searchContainer.style, {
        display: "none", width: "100%", alignItems: "center",
        background: "var(--card, var(--secondary, var(--comfy-input-bg, #181818)))",
        border: "1px solid var(--border, var(--border-color, #555))", borderRadius: "4px", padding: "2px 8px",
        boxSizing: "border-box", height: "26px"
    });
    const searchInputIcon = document.createElement("span");
    searchInputIcon.className = "pi pi-search";
    Object.assign(searchInputIcon.style, { fontSize: "11px", opacity: "0.5", marginRight: "6px" });
    const searchInput = document.createElement("input");
    Object.assign(searchInput, { type: "text", placeholder: t("Filter by text, images, nodes...") });
    Object.assign(searchInput.style, {
        flex: "1", background: "transparent", border: "none", outline: "none",
        color: "var(--comfy-input-color, var(--fg-color, #eee))", fontSize: "11px", padding: "0"
    });
    const clearSearchBtn = document.createElement("span");
    clearSearchBtn.className = "pi pi-times comfy-sidebar-icon-btn";
    clearSearchBtn.title = t("Clear & Close Search");
    Object.assign(clearSearchBtn.style, { marginLeft: "6px" });

    searchContainer.appendChild(searchInputIcon);
    searchContainer.appendChild(searchInput);
    searchContainer.appendChild(clearSearchBtn);

    header.appendChild(standardHeader);
    header.appendChild(searchContainer);

    const stickyHeaderGroup = document.createElement("div");
    stickyHeaderGroup.className = "comfy-sidebar-sticky-header-group";
    stickyHeaderGroupEl = stickyHeaderGroup;
    stickyHeaderGroup.appendChild(header);
    container.appendChild(stickyHeaderGroup);

    searchIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        standardHeader.style.display = "none";
        searchContainer.style.display = "flex";
        searchInput.focus();
    });

    const closeSearch = () => {
        searchInput.value = "";
        store.setSearchQuery("");
        searchContainer.style.display = "none";
        standardHeader.style.display = "flex";
        renderSidebar();
    };

    clearSearchBtn.addEventListener("click", (e) => { e.stopPropagation(); closeSearch(); });
    searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSearch(); });
    searchInput.addEventListener("input", () => {
        store.setSearchQuery(searchInput.value.trim());
        renderSidebar();
    });

    const cardStack = document.createElement("div");
    store.ui.cardStack = cardStack;
    Object.assign(cardStack.style, {
        flex: "1",
        overflowY: "visible",
        display: "flex",
        flexDirection: "column",
        paddingBottom: "46px"
    });
    container.appendChild(cardStack);

    scrollToTopBtnEl = document.createElement("button");
    scrollToTopBtnEl.className = "pi pi-chevron-up comfy-sidebar-scroll-top-btn";
    scrollToTopBtnEl.title = t("Scroll to Top");

    scrollToTopBtnEl.addEventListener("click", (e) => {
        e.stopPropagation();
        const scrollEl = getScrollContainer(store.ui.cardStack);
        if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: "smooth" });
    });

    container.appendChild(scrollToTopBtnEl);

    // Reveal Spotlight: track cursor position over Queue card borders
    setupSpotlightTracker(container, ".comfy-sidebar-card");

    document.addEventListener("scroll", updateScrollTopBtnVisibility, { capture: true, passive: true });

    new ResizeObserver((entries) => {
        const threshold = getSetting(SettingIds.GRID_COLUMNS_THRESHOLD, 350);
        const cols = calculateGridColumns(entries[0].contentRect.width, threshold);
        if (cols !== currentColumnCount) {
            currentColumnCount = cols;
            renderSidebar();
        }
    }).observe(container);

    activeTimerInterval = setInterval(() => {
        const activePid = store.ui.currentlyActivePromptId;
        if (!activePid) return;
        const prompt = store.getPrompt(activePid);
        if (prompt && prompt.status === PromptStatus.ACTIVE && prompt.startTime) {
            const cardObj = cardPool.get(activePid);
            if (cardObj && cardObj.timerEl) {
                cardObj.timerEl.textContent = ((Date.now() - prompt.startTime) / 1000).toFixed(2) + "s";
            }
        }
    }, 250);

    store.on(StoreEvents.QUEUE_SYNCED, () => {
        const pendingCount = store.getAllPrompts().filter(t => t.status === PromptStatus.PENDING).length;
        const runningCount = store.getAllPrompts().filter(t => t.status === PromptStatus.ACTIVE).length;
        updateSidebarBadge(pendingCount + (runningCount > 0 ? 1 : 0));
        renderSidebar();
    });

    store.on(StoreEvents.PROMPT_ADDED, () => renderSidebar());
    store.on(StoreEvents.PROMPT_DELETED, () => renderSidebar());
    store.on(StoreEvents.PROMPTS_CLEARED, () => renderSidebar());
    store.on(StoreEvents.SUBMENU_CHANGED, () => renderSidebar());

    return container;
}

export function renderSidebar() {
    if (renderAnimationFrameId) cancelAnimationFrame(renderAnimationFrameId);
    renderAnimationFrameId = requestAnimationFrame(() => {
        if (!store.ui.sidebarContainer || !store.ui.cardStack) return;

        const showPendingSummary = getSetting(SettingIds.SHOW_PENDING_COUNT_ONLY, true);
        const showWorkingNode = getSetting(SettingIds.SHOW_WORKING_NODE_NAME, true);

        const headerTitle = store.ui.sidebarContainer.querySelector("h3");
        const headerSearchIcon = store.ui.sidebarContainer.querySelector(".comfy-sidebar-header-root .pi-search");
        const headerActions = store.ui.sidebarContainer.querySelector(".comfy-sidebar-header-btn")?.parentNode;

        // Submenu 1: Batch Images View
        if (store.ui.activeSubmenuBatchImages) {
            const batchInfo = store.ui.activeSubmenuBatchImages;

            if (headerTitle) {
                headerTitle.textContent = `${t("Batch of #")}${batchInfo.pid}`;
                headerTitle.style.cursor = "pointer";
                headerTitle.title = t("Go Back");
                headerTitle.onclick = () => {
                    if (batchInfo.parentPromptId) {
                        store.openOutputsSubmenu(batchInfo.parentPromptId);
                    } else {
                        store.closeSubmenu();
                    }
                    resetAllCardHoverStates();
                    renderSidebar();
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
                let cardObj = cardPool.get(cardId);

                if (!cardObj) {
                    const card = document.createElement("div");
                    card.id = `card-${cardId}`;
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
                        display: "none", transform: "translateZ(0)"
                    });

                    const grid = document.createElement("div");
                    grid.style.display = "flex";
                    grid.style.flexDirection = "column";
                    grid.style.gap = "6px";

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
                    btnImg.title = t("Download Object");
                    btnImg.onclick = (ev) => {
                        ev.stopPropagation();
                        const a = document.createElement("a");
                        a.href = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
                        a.download = img.filename || "output";
                        a.click();
                    };

                    const btnDel = document.createElement("span");
                    btnDel.className = "pi pi-trash comfy-sidebar-card-action-btn comfy-sidebar-btn-del";
                    const btnDelLabel = document.createElement("span");
                    btnDelLabel.className = "comfy-sidebar-del-label";
                    btnDelLabel.textContent = t("Delete File");
                    btnDel.appendChild(btnDelLabel);

                    attachDeleteConfirmation(btnDel, {
                        idleTitle: t("Remove from batch (Hold Ctrl to delete file from disk)"),
                        confirmTitle: t("Click again to confirm removing from batch"),
                        confirmDiskTitle: t("Ctrl+Click again to delete file from DISK / TRASH"),
                        onConfirm: async (shouldDeleteFromDisk) => {
                            animateCardRemoval(card, async () => {
                                if (shouldDeleteFromDisk && img && img.filename) {
                                    const action = await deleteFileOnServer(img);
                                    if (action) {
                                        const msg = action === "trashed" ? t("Moved file to Recycle Bin.") : t("Permanently deleted file.");
                                        showNotification(msg, "success", t("Delete File"));
                                    }
                                }

                                const pid = batchInfo.parentPromptId || batchInfo.pid;
                                const state = store.getPrompt(pid);
                                const imgIdx = batchInfo.images.indexOf(img);
                                if (imgIdx > -1) batchInfo.images.splice(imgIdx, 1);

                                if (state) {
                                    if (Array.isArray(state.images)) {
                                        const stIdx = state.images.findIndex(i => i.filename === img.filename && (i.subfolder || "") === (img.subfolder || ""));
                                        if (stIdx > -1) state.images.splice(stIdx, 1);
                                    }
                                    if (state.nodeOutputs) {
                                        removeImageFromNodeOutputs(state.nodeOutputs, img);
                                    }
                                    state.rendered = false;
                                    store.updatePrompt(pid, state);
                                }

                                const mainCardObj = cardPool.get(pid);
                                if (mainCardObj) {
                                    mainCardObj.currentImageIndex = 0;
                                    mainCardObj.lastImagesSignature = "";
                                }

                                if (batchInfo.images.length === 0) {
                                    if (batchInfo.parentPromptId) {
                                        store.openOutputsSubmenu(batchInfo.parentPromptId);
                                    } else {
                                        store.closeSubmenu();
                                    }
                                }

                                renderSidebar();
                            });
                        }
                    });

                    hoverPanel.append(btnImg, btnDel);

                    const leftHoverPanel = document.createElement("div");
                    leftHoverPanel.className = "comfy-sidebar-left-hover-panel";
                    Object.assign(leftHoverPanel.style, {
                        position: "absolute", bottom: "4px", left: "4px",
                        flexDirection: "column", gap: "4px", zIndex: "20"
                    });

                    const btnCopy = document.createElement("span");
                    btnCopy.className = "pi pi-copy comfy-sidebar-card-action-btn";
                    btnCopy.title = t("Copy to Clipboard");
                    const isCopyable = isImageFormat(img.filename || img.url);
                    if (!isCopyable) {
                        btnCopy.style.display = "none";
                    } else {
                        btnCopy.onclick = async (ev) => {
                            ev.stopPropagation();
                            const src = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
                            const success = await copyImageToClipboard(src);
                            if (success) {
                                btnCopy.className = "pi pi-check comfy-sidebar-card-action-btn";
                                btnCopy.style.color = "#4ade80";
                                setTimeout(() => {
                                    btnCopy.className = "pi pi-copy comfy-sidebar-card-action-btn";
                                    btnCopy.style.color = "";
                                }, 1500);
                            }
                        };
                    }

                    const btnFocus = document.createElement("span");
                    btnFocus.className = "pi pi-eye comfy-sidebar-card-action-btn";
                    btnFocus.title = t("Show Node");
                    const nodeId = findNodeIdForImage({ nodeOutputs: batchInfo.nodeOutputs }, img);
                    if (nodeId) {
                        btnFocus.onclick = (ev) => {
                            ev.stopPropagation();
                            centerAndSelectCanvasNode(nodeId);
                        };
                    } else {
                        btnFocus.style.display = "none";
                    }

                    leftHoverPanel.append(btnCopy, btnFocus);
                    card.append(timerEl, dimEl, grid, p, hoverPanel, leftHoverPanel);

                    cardObj = {
                        element: card,
                        timerEl,
                        dimEl,
                        grid,
                        placeholder: p,
                        hoverPanel,
                        leftHoverPanel,
                        btnImg,
                        btnCopy,
                        btnFocus,
                        btnDel,
                        firstImgElement: null
                    };

                    cardPool.set(cardId, cardObj);
                }

                cardObj.placeholder.style.display = "none";
                renderCardImages(cardObj, {
                    pid: batchInfo.pid,
                    status: PromptStatus.COMPLETED,
                    images: [img],
                    workflow: batchInfo.workflow,
                    nodeOutputs: batchInfo.nodeOutputs
                });

                targetElements.push(cardObj.element);
            });

            mountCards(store.ui.cardStack, [], targetElements, currentColumnCount);

            const scrollEl = getScrollContainer(store.ui.cardStack);
            if (scrollEl) scrollEl.scrollTop = 0;
            updateScrollTopBtnVisibility();
            return;
        }

        // Submenu 2: Intermediate Outputs View
        if (store.ui.activeSubmenuPromptId) {
            const st = store.getPrompt(store.ui.activeSubmenuPromptId);
            if (!st) {
                store.closeSubmenu();
                renderSidebar();
                return;
            }

            if (headerTitle) {
                headerTitle.textContent = `${t("Outputs of #")}${store.ui.activeSubmenuPromptId}`;
                headerTitle.style.cursor = "pointer";
                headerTitle.title = t("Go Back to Queue");
                headerTitle.onclick = () => {
                    store.closeSubmenu();
                    resetAllCardHoverStates();
                    renderSidebar();
                };
            }
            if (headerSearchIcon) headerSearchIcon.style.display = "none";
            if (headerActions) headerActions.style.display = "none";

            if (!globalClickRegistered) {
                document.addEventListener("click", handleGlobalClick, true);
                globalClickRegistered = true;
            }

            const rawOutputs = getRunOutputs(st.nodeOutputs, st.workflow);
            const seenFiles = new Set();
            const outputs = [];

            rawOutputs.forEach(out => {
                const uniqueImgs = (out.images || []).filter(img => {
                    const key = `${img.subfolder || ""}/${img.filename}`;
                    if (seenFiles.has(key)) return false;
                    seenFiles.add(key);
                    return true;
                });
                if (uniqueImgs.length > 0) {
                    outputs.push({ nodeId: out.nodeId, images: uniqueImgs, nodeTitle: out.nodeTitle });
                }
            });

            const targetElements = [];

            if (outputs.length === 0) {
                const emptyCard = document.createElement("div");
                emptyCard.className = "comfy-sidebar-card completed";
                Object.assign(emptyCard.style, {
                    padding: "16px", textAlign: "center", color: "var(--desc-color, #aaa)", fontSize: "12px",
                    gridColumn: "1 / -1"
                });
                emptyCard.textContent = t("No separate intermediate outputs found.");
                targetElements.push(emptyCard);
            } else {
                outputs.forEach((out) => {
                    const cardId = `submenu-${st.pid}-${out.nodeId}`;
                    let cardObj = cardPool.get(cardId);

                    if (!cardObj) {
                        const card = document.createElement("div");
                        card.id = `card-${cardId}`;
                        card.className = "comfy-sidebar-card completed";
                        card.style.position = "relative";

                        const titleFromState = st.nodeTitles?.[out.nodeId];
                        const node = st.workflow?.nodes?.find(n => String(n.id) === String(out.nodeId));
                        const resolvedTitle = titleFromState || (node ? (node.title || node.type) : out.nodeTitle) || "Node";

                        const timerEl = document.createElement("div");
                        timerEl.className = "comfy-sidebar-card-timer";
                        timerEl.textContent = `${resolvedTitle} (#${out.nodeId})`;
                        timerEl.style.display = "block";

                        const dimEl = document.createElement("div");
                        Object.assign(dimEl.style, {
                            position: "absolute", top: "6px", right: "8px", fontSize: "10px",
                            fontFamily: "monospace", opacity: "0.7", background: "rgba(0, 0, 0, 0.6)",
                            padding: "2px 4px", borderRadius: "3px", pointerEvents: "none", zIndex: "5", color: "#fff",
                            display: "none", transform: "translateZ(0)"
                        });

                        const grid = document.createElement("div");
                        grid.style.display = "flex";
                        grid.style.flexDirection = "column";
                        grid.style.gap = "6px";

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
                        btnImg.title = t("Download Object");
                        btnImg.onclick = (ev) => {
                            ev.stopPropagation();
                            out.images.forEach(img => {
                                const a = document.createElement("a");
                                a.href = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
                                a.download = img.filename || "output";
                                a.click();
                            });
                        };

                        const btnDel = document.createElement("span");
                        btnDel.className = "pi pi-trash comfy-sidebar-card-action-btn comfy-sidebar-btn-del";
                        const btnDelLabel = document.createElement("span");
                        btnDelLabel.className = "comfy-sidebar-del-label";
                        btnDelLabel.textContent = t("Delete File");
                        btnDel.appendChild(btnDelLabel);

                        const btnMove = document.createElement("span");
                        btnMove.className = "pi pi-folder-open comfy-sidebar-card-action-btn comfy-sidebar-btn-move";
                        btnMove.title = t("Move selected image to Outputs (Ctrl+Click)");
                        const btnMoveLabel = document.createElement("span");
                        btnMoveLabel.className = "comfy-sidebar-move-label";
                        btnMoveLabel.textContent = t("Move to Outputs");
                        btnMove.appendChild(btnMoveLabel);

                        attachDeleteConfirmation(btnDel, {
                            idleTitle: t("Delete node output (Hold Ctrl to delete file from disk)"),
                            confirmTitle: t("Click again to confirm removing output"),
                            confirmDiskTitle: t("Ctrl+Click again to delete this node's files from DISK / TRASH"),
                            onConfirm: async (shouldDeleteFromDisk) => {
                                animateCardRemoval(card, async () => {
                                    if (shouldDeleteFromDisk && out.images) {
                                        let count = 0;
                                        let lastAct = "trashed";
                                        for (const imgItem of out.images) {
                                            const action = await deleteFileOnServer(imgItem);
                                            if (action) { count++; lastAct = action; }
                                        }
                                        if (count > 0) {
                                            const msg = lastAct === "trashed"
                                                ? `Moved ${count} file${count > 1 ? "s" : ""} to Recycle Bin.`
                                                : `Permanently deleted ${count} file${count > 1 ? "s" : ""}.`;
                                            showNotification(msg, "success", "Delete Files");
                                        }
                                    }

                                    if (st.nodeOutputs && st.nodeOutputs[out.nodeId]) {
                                        delete st.nodeOutputs[out.nodeId];
                                    }

                                    const remainingOutputs = getRunOutputs(st.nodeOutputs, st.workflow);
                                    if (remainingOutputs.length > 0) {
                                        st.images = remainingOutputs[remainingOutputs.length - 1].images || [];
                                    } else {
                                        st.images = [];
                                        store.closeSubmenu();
                                    }

                                    store.updatePrompt(st.pid, st);
                                    renderSidebar();
                                });
                            }
                        });

                        hoverPanel.append(btnImg, btnMove, btnDel);

                        const leftHoverPanel = document.createElement("div");
                        leftHoverPanel.className = "comfy-sidebar-left-hover-panel";
                        Object.assign(leftHoverPanel.style, {
                            position: "absolute", bottom: "4px", left: "4px",
                            flexDirection: "column", gap: "4px", zIndex: "20"
                        });

                        const btnCopy = document.createElement("span");
                        btnCopy.className = "pi pi-copy comfy-sidebar-card-action-btn";
                        btnCopy.title = t("Copy to Clipboard");
                        const firstImg = out.images[0];
                        const isCopyable = firstImg && isImageFormat(firstImg.filename || firstImg.url);
                        if (!isCopyable) {
                            btnCopy.style.display = "none";
                        } else {
                            btnCopy.onclick = async (ev) => {
                                ev.stopPropagation();
                                const src = firstImg.url ? firstImg.url : `/view?filename=${encodeURIComponent(firstImg.filename)}&type=${firstImg.type || 'output'}&subfolder=${encodeURIComponent(firstImg.subfolder || '')}`;
                                const success = await copyImageToClipboard(src);
                                if (success) {
                                    btnCopy.className = "pi pi-check comfy-sidebar-card-action-btn";
                                    btnCopy.style.color = "#4ade80";
                                    setTimeout(() => {
                                        btnCopy.className = "pi pi-copy comfy-sidebar-card-action-btn";
                                        btnCopy.style.color = "";
                                    }, 1500);
                                }
                            };
                        }

                        const btnFocus = document.createElement("span");
                        btnFocus.className = "pi pi-eye comfy-sidebar-card-action-btn";
                        btnFocus.title = t("Show Node");
                        btnFocus.onclick = (ev) => {
                            ev.stopPropagation();
                            centerAndSelectCanvasNode(out.nodeId);
                        };

                        leftHoverPanel.append(btnCopy, btnFocus);
                        card.append(timerEl, dimEl, grid, p, hoverPanel, leftHoverPanel);

                        cardObj = {
                            element: card,
                            timerEl,
                            dimEl,
                            grid,
                            placeholder: p,
                            hoverPanel,
                            leftHoverPanel,
                            btnImg,
                            btnCopy,
                            btnFocus,
                            btnDel,
                            btnMove,
                            firstImgElement: null
                        };

                        cardPool.set(cardId, cardObj);
                    }

                    if (cardObj.btnMove) {
                        const selectedImage = out.images?.[cardObj.currentImageIndex || 0];
                        const canMoveSelectedImage = Boolean(
                            selectedImage &&
                            selectedImage.type === "temp" &&
                            isImageFormat(selectedImage.filename || selectedImage.url)
                        );

                        if (canMoveSelectedImage) {
                            cardObj.btnMove.title = t("Move selected image to Outputs (Ctrl+Click)");
                            cardObj.btnMove.onclick = async (ev) => {
                                ev.stopPropagation();
                                if (!ev.ctrlKey && !ev.metaKey) return;
                                if (cardObj._isMovingTempImage) return;

                                const liveState = store.getPrompt(st.pid) || st;
                                const imageToMove = out.images?.[cardObj.currentImageIndex || 0];
                                if (!imageToMove || imageToMove.type !== "temp") return;

                                cardObj._isMovingTempImage = true;
                                cardObj.btnMove.style.opacity = "0.5";
                                const moved = await moveTempImageToOutput(imageToMove);

                                if (moved?.success) {
                                    updateMovedImageReferences(liveState.images, imageToMove, moved);
                                    updateMovedImageReferences(liveState.nodeOutputs, imageToMove, moved);
                                    updateMovedImageReferences(out.images, imageToMove, moved);
                                    store.updatePrompt(liveState.pid, liveState);
                                    showNotification(t("Moved selected image to Outputs."), "success", t("Move to Outputs"));
                                    renderSidebar();
                                } else {
                                    showNotification(t("Failed to move image to Outputs."), "error", t("Move to Outputs"));
                                }

                                cardObj._isMovingTempImage = false;
                                cardObj.btnMove.style.opacity = "";
                            };
                        } else {
                            cardObj.btnMove.onclick = null;
                        }
                    }

                    if (out.images && out.images.length > 0) {
                        cardObj.placeholder.style.display = "none";
                        renderCardImages(cardObj, {
                            pid: st.pid,
                            nodeId: out.nodeId,
                            status: PromptStatus.COMPLETED,
                            images: out.images,
                            workflow: st.workflow,
                            nodeOutputs: st.nodeOutputs
                        }, () => {
                            // Clicking (1/N) opens batch drill-down for this specific intermediate node
                            const scrollEl = getScrollContainer(store.ui.cardStack);
                            if (scrollEl) {
                                store.ui.mainQueueScrollTop = scrollEl.scrollTop;
                            }
                            const nodeTitle = st.nodeTitles?.[out.nodeId] || out.nodeTitle || "Node";
                            store.openBatchSubmenu({
                                pid: `${st.pid} - ${nodeTitle} (#${out.nodeId})`,
                                parentPromptId: st.pid,
                                images: out.images,
                                workflow: st.workflow,
                                nodeOutputs: { [out.nodeId]: st.nodeOutputs?.[out.nodeId] }
                            });
                        });
                    } else {
                        cardObj.placeholder.style.display = "block";
                        cardObj.placeholder.textContent = t("No Outputs");
                    }

                    targetElements.push(cardObj.element);
                });
            }

            if (outputs.length === 0) {
                mountCards(store.ui.cardStack, targetElements, [], currentColumnCount);
            } else {
                mountCards(store.ui.cardStack, [], targetElements, currentColumnCount);
            }

            updateScrollTopBtnVisibility();
            return;
        }

        // Main Queue View
        if (headerTitle) {
            headerTitle.textContent = t("Queue");
            headerTitle.style.cursor = "default";
            headerTitle.onclick = null;
        }
        if (headerSearchIcon) headerSearchIcon.style.display = "inline";
        if (headerActions) headerActions.style.display = "flex";

        let tasksArray = store.getAllPrompts();
        if (showPendingSummary) {
            tasksArray = tasksArray.filter(t => t.status !== PromptStatus.PENDING);
        }
        if (store.ui.searchQuery) {
            tasksArray = tasksArray.filter(t => matchesFilter(t, store.ui.searchQuery));
        }
        tasksArray.sort((a, b) => b.timestamp - a.timestamp);

        const activeTasks = tasksArray.filter(t => t.status === PromptStatus.ACTIVE);
        const completedTasks = tasksArray.filter(t => t.status === PromptStatus.COMPLETED || t.status === PromptStatus.CANCELLED || t.status === PromptStatus.ERROR);
        const pendingTasks = tasksArray.filter(t => t.status === PromptStatus.PENDING).sort((a, b) => (b.queueNumber || 0) - (a.queueNumber || 0));

        const syncTaskCard = (state) => {
            const cardObj = getOrCreateCard(state);
            return updateCardDOM(cardObj, state, showPendingSummary, showWorkingNode);
        };

        const bannerElements = [];
        const cardElements = [];
        const pendingCount = store.getAllPrompts().filter(t => t.status === PromptStatus.PENDING).length;

        if (pendingCount > 0) {
            if (showPendingSummary) {
                let pCard = cardPool.get("pending-summary-card");
                if (!pCard) {
                    const el = document.createElement("div");
                    Object.assign(el.style, {
                        background: "var(--card, var(--secondary, var(--comfy-input-bg, #181818)))", border: "2px solid var(--border, #6c757d)", borderRadius: "4px", padding: "10px",
                        textAlign: "center", fontSize: "12px", fontWeight: "bold",
                        color: "var(--muted-foreground, var(--desc-color, #aaa))", display: "flex", flexDirection: "column", gap: "8px"
                    });
                    const textDiv = document.createElement("div");
                    el.appendChild(textDiv);
                    const cancelBtn = document.createElement("button");
                    cancelBtn.className = "comfy-sidebar-cancel-all-btn";
                    cancelBtn.textContent = t("Cancel All Pending");
                    cancelBtn.onclick = async () => {
                        await cancelAllPending();
                    };
                    el.appendChild(cancelBtn);
                    pCard = { element: el, textDiv };
                    cardPool.set("pending-summary-card", pCard);
                }
                pCard.textDiv.textContent = `${t("Pending Queue:")} ${pendingCount} ${t("tasks")}`;
                bannerElements.push(pCard.element);
            } else {
                let btnCard = cardPool.get("pending-cancel-all-standalone");
                if (!btnCard) {
                    const btn = document.createElement("button");
                    btn.className = "comfy-sidebar-cancel-all-btn";
                    btn.textContent = t("Cancel All Pending");
                    btn.onclick = async () => {
                        await cancelAllPending();
                    };
                    btnCard = { element: btn };
                    cardPool.set("pending-cancel-all-standalone", btnCard);
                }
                bannerElements.push(btnCard.element);
                pendingTasks.forEach(st => cardElements.push(syncTaskCard(st)));
            }
        }

        activeTasks.forEach(st => cardElements.push(syncTaskCard(st)));
        completedTasks.forEach(st => cardElements.push(syncTaskCard(st)));

        const threshold = getSetting(SettingIds.GRID_COLUMNS_THRESHOLD, 350);
        const containerWidth = store.ui.sidebarContainer?.clientWidth || 0;
        if (containerWidth > 0) {
            currentColumnCount = calculateGridColumns(containerWidth, threshold);
        }

        mountCards(store.ui.cardStack, bannerElements, cardElements, currentColumnCount);

        if (store.ui.mainQueueScrollTop !== null) {
            const restorePos = store.ui.mainQueueScrollTop;
            store.ui.mainQueueScrollTop = null;
            const scrollEl = getScrollContainer(store.ui.cardStack);
            if (scrollEl) {
                scrollEl.scrollTop = restorePos;
                requestAnimationFrame(() => { scrollEl.scrollTop = restorePos; });
            }
        }

        updateScrollTopBtnVisibility();
    });
}

export function teardownSidebarView() {
    window.removeEventListener("keydown", handleGlobalKeyDown);
    window.removeEventListener("keyup", handleGlobalKeyUp);
    window.removeEventListener("blur", handleGlobalBlur);
    document.removeEventListener("click", handleGlobalClick, true);
    document.removeEventListener("scroll", updateScrollTopBtnVisibility, { capture: true, passive: true });

    if (activeTimerInterval) {
        clearInterval(activeTimerInterval);
        activeTimerInterval = null;
    }
    if (renderAnimationFrameId) {
        cancelAnimationFrame(renderAnimationFrameId);
        renderAnimationFrameId = null;
    }
    cardPool.clear();
    if (scrollToTopBtnEl && scrollToTopBtnEl.parentNode) {
        scrollToTopBtnEl.parentNode.removeChild(scrollToTopBtnEl);
    }
    scrollToTopBtnEl = null;
}