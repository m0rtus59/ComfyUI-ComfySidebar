import { app } from "/scripts/app.js";
import { SettingIds, PromptStatus } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { deleteFileOnServer, openFileOrFolder } from "./mediaActions.js";
import { extractWorkflowFromPng, isImageFormat, animateCardRemoval, getScrollContainer, calculateGridColumns, downloadJson, setupSpotlightTracker, attachDeleteConfirmation } from "../utils/utils.js";
import { getSetting } from "../core/settings.js";
import { renderCardImages } from "./mediaPreview.js";
import { showNotification } from "../utils/nodeRenumber.js";

let galleryContainerEl = null;
let cardStackEl = null;
let scrollToTopBtnEl = null;
let currentColumnCount = 1;
let currentSubfolder = "";
let currentSearchQuery = "";
let stickyHeaderGroupEl = null;
let lastScrollTop = 0;
let scrollDeltaAccumulator = 0;
let isHeaderHidden = false;
let galleryResizeObserver = null;

// Module-level so teardownGalleryView() can remove the exact same references
const handleCtrlDown = (e) => {
    if (e.key === "Control" || e.key === "Meta") document.body.classList.add("comfy-sidebar-ctrl-active");
};
const handleCtrlUp = (e) => {
    if (e.key === "Control" || e.key === "Meta") document.body.classList.remove("comfy-sidebar-ctrl-active");
};
const handleCtrlBlur = () => document.body.classList.remove("comfy-sidebar-ctrl-active");

// Persistent sort order
let sortOrder = "newest";
try {
    sortOrder = localStorage.getItem("ComfySidebar.GallerySortOrder") || "newest";
} catch (e) {}

let cachedFolders = [];
let cachedFiles = [];
let displayedFilesCount = 0;
const BATCH_SIZE = 36;
let isLoading = false;

function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return "";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function updateScrollTopVisibility() {
    if (!galleryContainerEl || !galleryContainerEl.isConnected) {
        if (scrollToTopBtnEl) scrollToTopBtnEl.style.display = "none";
        return;
    }
    const scrollEl = getScrollContainer(cardStackEl);
    if (scrollEl) {
        const viewportEl = scrollEl.parentElement || galleryContainerEl;
        if (viewportEl && scrollToTopBtnEl && scrollToTopBtnEl.parentNode !== viewportEl) {
            if (window.getComputedStyle(viewportEl).position === "static") {
                viewportEl.style.position = "relative";
            }
            viewportEl.appendChild(scrollToTopBtnEl);
        }

        if (scrollToTopBtnEl) {
            scrollToTopBtnEl.style.display = scrollEl.scrollTop > 200 ? "flex" : "none";
        }

        // Handle smart scroll-up reveal for header & navigation
        handleHeaderScroll(scrollEl);

        if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 300) {
            loadNextBatch();
        }
    }
}

function handleHeaderScroll(scrollEl) {
    if (!stickyHeaderGroupEl) return;

    // Never hide header if search bar is currently active
    const searchContainer = stickyHeaderGroupEl.querySelector(".comfy-sidebar-search-container");
    if (currentSearchQuery || (searchContainer && searchContainer.style.display !== "none")) {
        stickyHeaderGroupEl.style.transform = "translateY(0)";
        isHeaderHidden = false;
        return;
    }

    const currentScroll = scrollEl.scrollTop;
    const delta = currentScroll - lastScrollTop;
    lastScrollTop = currentScroll;

    // Near the very top: always keep visible & transparent
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
        // Scrolling DOWN: hide after small buffer
        if (scrollDeltaAccumulator < 0) scrollDeltaAccumulator = 0;
        scrollDeltaAccumulator += delta;

        if (scrollDeltaAccumulator > 25 && !isHeaderHidden) {
            stickyHeaderGroupEl.style.transform = "translateY(-100%)";
            isHeaderHidden = true;
        }
    } else if (delta < 0) {
        // Scrolling UP: reveal as soon as user scrolls up a little bit (~15px)
        if (scrollDeltaAccumulator > 0) scrollDeltaAccumulator = 0;
        scrollDeltaAccumulator += delta;

        if (scrollDeltaAccumulator < -15 && isHeaderHidden) {
            stickyHeaderGroupEl.style.transform = "translateY(0)";
            isHeaderHidden = false;
        }
    }
}

async function fetchGalleryData(subfolder = "", searchQuery = "") {
    try {
        isLoading = true;
        const normalized = subfolder.replace(/\\/g, "/");
        const queryParams = new URLSearchParams({ subfolder: normalized });
        if (searchQuery) queryParams.set("search", searchQuery);

        const res = await fetch(`/comfy-sidebar/gallery/list?${queryParams.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        cachedFolders = data.folders || [];
        cachedFiles = data.files || [];
        currentSubfolder = (data.subfolder || "").replace(/\\/g, "/");
        applySorting();
        displayedFilesCount = 0;
    } catch (e) {
        console.error("[ComfySidebar] Failed to load gallery", e);
        showNotification(t("Failed to load gallery from disk."), "error");
    } finally {
        isLoading = false;
    }
}

function applySorting() {
    if (sortOrder === "newest") {
        cachedFiles.sort((a, b) => b.mtime - a.mtime);
    } else {
        cachedFiles.sort((a, b) => a.mtime - b.mtime);
    }
}

function mountGalleryCards(cardStack, folderWrapperEl, cardEls, cols = 1, append = false) {
    if (!cardStack) return;

    const oldEmpty = cardStack.querySelector(".comfy-sidebar-gallery-empty-notice");
    if (oldEmpty) oldEmpty.remove();

    if (!append) {
        let subfolderArea = cardStack.querySelector(".comfy-sidebar-subfolders-area");
        if (!subfolderArea) {
            subfolderArea = document.createElement("div");
            subfolderArea.className = "comfy-sidebar-subfolders-area";
            cardStack.insertBefore(subfolderArea, cardStack.firstChild);
        }
        subfolderArea.innerHTML = "";
        if (folderWrapperEl) {
            subfolderArea.appendChild(folderWrapperEl);
            subfolderArea.style.display = "block";
        } else {
            subfolderArea.style.display = "none";
        }
    }

    let columnsWrapper = cardStack.querySelector(".comfy-sidebar-masonry-wrapper");
    if (!columnsWrapper) {
        columnsWrapper = document.createElement("div");
        columnsWrapper.className = "comfy-sidebar-masonry-wrapper";
        Object.assign(columnsWrapper.style, { display: "flex", gap: "12px", alignItems: "flex-start", width: "100%" });
        cardStack.appendChild(columnsWrapper);
    }

    if (!append && cardEls.length === 0 && !folderWrapperEl) {
        columnsWrapper.innerHTML = "";
        const emptyEl = document.createElement("div");
        emptyEl.className = "comfy-sidebar-card comfy-sidebar-gallery-empty-notice";
        Object.assign(emptyEl.style, {
            padding: "24px", textAlign: "center", color: "var(--desc-color, #888)", fontSize: "12px", width: "100%"
        });
        emptyEl.textContent = isLoading ? t("Loading files...") : t("No files found in this folder.");
        cardStack.appendChild(emptyEl);
        return;
    }

    while (columnsWrapper.children.length < cols) {
        const colDiv = document.createElement("div");
        colDiv.className = "comfy-sidebar-masonry-col";
        Object.assign(colDiv.style, { flex: "1", display: "flex", flexDirection: "column", gap: "12px", minWidth: "0" });
        columnsWrapper.appendChild(colDiv);
    }
    while (columnsWrapper.children.length > cols) {
        columnsWrapper.removeChild(columnsWrapper.lastChild);
    }

    const colHeights = Array.from(columnsWrapper.children).map(c => c.scrollHeight || 0);

    cardEls.forEach((cardEl) => {
        let shortestCol = 0;
        for (let c = 1; c < cols; c++) {
            if (colHeights[c] < colHeights[shortestCol]) shortestCol = c;
        }
        columnsWrapper.children[shortestCol].appendChild(cardEl);
        const cardH = cardEl.offsetHeight > 0 ? cardEl.offsetHeight : 160;
        colHeights[shortestCol] += cardH + 12;
    });
}

function createFileCard(file) {
    const card = document.createElement("div");
    card.className = "comfy-sidebar-card completed";
    card.style.position = "relative";
    card.style.cursor = "pointer";

    const previewUrl = `/view?filename=${encodeURIComponent(file.filename)}&type=output&subfolder=${encodeURIComponent(file.subfolder || "")}`;
    const isPng = file.filename.toLowerCase().endsWith(".png");

    const grid = document.createElement("div");
    grid.style.display = "flex";
    grid.style.flexDirection = "column";
    grid.style.width = "100%";

    const cardObj = {
        element: card,
        grid: grid,
        dimEl: null,
        currentImageIndex: 0,
        firstImgElement: null
    };

    const fileAsset = {
        filename: file.filename,
        subfolder: file.subfolder,
        type: "output",
        url: previewUrl
    };

    // Render using Queue's exact media pipeline (Images, Videos, 3D, Audio, Files)
    renderCardImages(cardObj, {
        pid: `gallery-${file.filename}`,
        status: PromptStatus.COMPLETED,
        images: [fileAsset],
        workflow: null
    });

    const sizeBadge = document.createElement("div");
    sizeBadge.className = "comfy-sidebar-card-timer";
    sizeBadge.textContent = formatFileSize(file.size);
    sizeBadge.style.display = file.size ? "block" : "none";

    const isMedia = isImageFormat(file.filename) || /\.(mp4|webm|mov|mkv|avi)$/i.test(file.filename);
    let nameBadge = null;
    if (isMedia) {
        nameBadge = document.createElement("div");
        nameBadge.className = "comfy-sidebar-card-filename-badge";
        nameBadge.textContent = file.filename;
        nameBadge.title = file.filename;
    }

    const hoverPanel = document.createElement("div");
    hoverPanel.className = "comfy-sidebar-hover-panel";
    Object.assign(hoverPanel.style, {
        position: "absolute", bottom: "4px", right: "4px", flexDirection: "column", gap: "4px", zIndex: "20"
    });

    const btnDownload = document.createElement("span");
    btnDownload.className = "pi pi-download comfy-sidebar-card-action-btn";
    btnDownload.title = t("Download Object");
    btnDownload.onclick = (ev) => {
        ev.stopPropagation();
        const a = document.createElement("a");
        a.href = previewUrl;
        a.download = file.filename;
        a.click();
    };

    let btnJson = null;
    if (isPng) {
        btnJson = document.createElement("span");
        btnJson.className = "pi pi-file comfy-sidebar-card-action-btn";
        btnJson.title = t("Download JSON");
        btnJson.onclick = async (ev) => {
            ev.stopPropagation();
            const wf = await extractWorkflowFromPng(previewUrl);
            if (!wf) {
                alert(t("No workflow metadata found in this file."));
                return;
            }
            downloadJson(wf, `workflow_${file.filename.replace(/\.[^/.]+$/, "")}.json`);
        };
    }

    const btnDel = document.createElement("span");
    btnDel.className = "pi pi-trash comfy-sidebar-card-action-btn comfy-sidebar-btn-del comfy-sidebar-gallery-btn-del";
    const btnDelLabel = document.createElement("span");
    btnDelLabel.className = "comfy-sidebar-del-label";
    btnDelLabel.textContent = t("Delete File");
    btnDel.appendChild(btnDelLabel);

    attachDeleteConfirmation(btnDel, {
        idleTitle: t("Delete file (Hold Ctrl to delete file from disk)"),
        confirmTitle: t("Click again to confirm deleting file"),
        confirmDiskTitle: t("Ctrl+Click again to delete file from DISK / TRASH"),
        onConfirm: async () => {
            const action = await deleteFileOnServer(fileAsset);
            if (action) {
                const msg = action === "trashed" ? t("Moved file to Recycle Bin.") : t("Permanently deleted file.");
                showNotification(msg, "success", t("Delete File"));
                cachedFiles = cachedFiles.filter(f => f.filename !== file.filename || f.subfolder !== file.subfolder);
                displayedFilesCount = Math.max(0, displayedFilesCount - 1);

                animateCardRemoval(card, () => {
                    card.remove();
                    if (cachedFiles.length === 0) {
                        renderGallery();
                    }
                });
            }
        }
    });

    hoverPanel.appendChild(btnDownload);
    if (btnJson) hoverPanel.appendChild(btnJson);
    hoverPanel.appendChild(btnDel);

    const leftHoverPanel = document.createElement("div");
    leftHoverPanel.className = "comfy-sidebar-left-hover-panel";
    Object.assign(leftHoverPanel.style, {
        position: "absolute", bottom: "4px", left: "4px", flexDirection: "column", gap: "4px", zIndex: "20"
    });

    const isImage = isImageFormat(file.filename);
    const btnCopy = document.createElement("span");
    btnCopy.className = "pi pi-copy comfy-sidebar-card-action-btn";
    btnCopy.title = t("Copy to Clipboard");
    if (!isImage) {
        btnCopy.style.display = "none";
    } else {
        btnCopy.onclick = async (ev) => {
            ev.stopPropagation();
            const success = await copyImageToClipboard(previewUrl);
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
    leftHoverPanel.appendChild(btnCopy);

    card.append(grid, sizeBadge);
    if (nameBadge) card.append(nameBadge);
    card.append(hoverPanel, leftHoverPanel);
    return card;
}

function updateBreadcrumbUI() {
    if (!galleryContainerEl) return;
    const breadcrumbBar = galleryContainerEl.querySelector(".comfy-sidebar-breadcrumb-bar");
    if (!breadcrumbBar) return;

    breadcrumbBar.innerHTML = "";

    const rootBtn = document.createElement("span");
    rootBtn.className = "comfy-sidebar-breadcrumb-item";
    rootBtn.innerHTML = `<i class="pi pi-home" style="margin-right: 4px; font-size: 11px; color: var(--primary, var(--p-primary-color, var(--primary-color, #a855f7)));"></i>output`;
    rootBtn.onclick = () => navigateToSubfolder("");
    breadcrumbBar.appendChild(rootBtn);

    const normalized = (currentSubfolder || "").replace(/\\/g, "/");
    if (normalized) {
        const parts = normalized.split("/").filter(Boolean);
        let accumulated = "";

        parts.forEach((part) => {
            accumulated = accumulated ? `${accumulated}/${part}` : part;
            const targetPath = accumulated;

            const sep = document.createElement("span");
            sep.className = "comfy-sidebar-breadcrumb-sep";
            sep.textContent = "/";
            breadcrumbBar.appendChild(sep);

            const crumb = document.createElement("span");
            crumb.className = "comfy-sidebar-breadcrumb-item";
            crumb.textContent = part;
            crumb.onclick = () => navigateToSubfolder(targetPath);
            breadcrumbBar.appendChild(crumb);
        });
    }
}

function loadNextBatch() {
    if (displayedFilesCount >= cachedFiles.length) return;
    const nextFiles = cachedFiles.slice(displayedFilesCount, displayedFilesCount + BATCH_SIZE);
    displayedFilesCount += nextFiles.length;
    const cardElements = nextFiles.map(file => createFileCard(file));
    mountGalleryCards(cardStackEl, null, cardElements, currentColumnCount, true);
}

export function renderGallery() {
    if (!galleryContainerEl || !cardStackEl) return;

    updateBreadcrumbUI();

    let subfolderWrapper = null;
    if (cachedFolders.length > 0 && !currentSearchQuery) {
        subfolderWrapper = document.createElement("div");
        subfolderWrapper.className = "comfy-sidebar-folders-grid";

        cachedFolders.forEach(folder => {
            const folderCard = document.createElement("div");
            folderCard.className = "comfy-sidebar-folder-card";
            folderCard.title = folder.name;

            const icon = document.createElement("span");
            icon.className = "pi pi-folder comfy-sidebar-folder-icon";

            const name = document.createElement("span");
            name.className = "comfy-sidebar-folder-name";
            name.textContent = folder.name;

            const ctrlOverlay = document.createElement("div");
            ctrlOverlay.className = "comfy-sidebar-ctrl-overlay";
            ctrlOverlay.innerHTML = `<i class="pi pi-folder-open"></i><span>${t("Open Folder")}</span>`;

            folderCard.appendChild(icon);
            folderCard.appendChild(name);
            folderCard.appendChild(ctrlOverlay);

            folderCard.onclick = async (e) => {
                if (e.ctrlKey || e.metaKey) {
                    e.stopPropagation();
                    await openFileOrFolder({ subfolder: folder.subfolder, type: "output" });
                    return;
                }
                await navigateToSubfolder(folder.subfolder);
            };

            subfolderWrapper.appendChild(folderCard);
        });
    }

    const threshold = getSetting(SettingIds.GRID_COLUMNS_THRESHOLD, 350);
    const containerWidth = galleryContainerEl.clientWidth || 0;
    if (containerWidth > 0) {
        currentColumnCount = calculateGridColumns(containerWidth, threshold);
    }

    let columnsWrapper = cardStackEl.querySelector(".comfy-sidebar-masonry-wrapper");
    if (columnsWrapper) columnsWrapper.innerHTML = "";

    const initialFiles = cachedFiles.slice(0, BATCH_SIZE);
    displayedFilesCount = initialFiles.length;
    const cardElements = initialFiles.map(file => createFileCard(file));

    mountGalleryCards(cardStackEl, subfolderWrapper, cardElements, currentColumnCount, false);
    updateScrollTopVisibility();
}

async function navigateToSubfolder(subfolder) {
    currentSubfolder = (subfolder || "").replace(/\\/g, "/");
    currentSearchQuery = "";
    await fetchGalleryData(currentSubfolder);
    const scrollEl = getScrollContainer(cardStackEl);
    if (scrollEl) scrollEl.scrollTop = 0;
    renderGallery();
}

export function setupGalleryView() {
    const container = document.createElement("div");
    galleryContainerEl = container;

    Object.assign(container.style, {
        display: "flex", flexDirection: "column", height: "100%", padding: "14px", boxSizing: "border-box",
        background: "transparent",
        color: "var(--fg-color, var(--p-text-color, #eee))", position: "relative"
    });

    const header = document.createElement("div");
    header.className = "comfy-sidebar-header-root";
    Object.assign(header.style, { position: "relative", marginBottom: "8px", height: "26px", display: "flex", alignItems: "center" });

    const standardHeader = document.createElement("div");
    Object.assign(standardHeader.style, { display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" });

    const titleGroup = document.createElement("div");
    Object.assign(titleGroup.style, { display: "flex", alignItems: "center", gap: "8px" });

    const searchIcon = document.createElement("span");
    searchIcon.className = "pi pi-search comfy-sidebar-icon-btn";
    searchIcon.title = t("Search Gallery (Filename or Prompt)");

    const title = document.createElement("h3");
    title.textContent = t("Gallery");
    Object.assign(title.style, { margin: "0", fontSize: "14px", fontWeight: "bold", opacity: "0.9", color: "var(--fg-color, #eee)" });

    titleGroup.appendChild(searchIcon);
    titleGroup.appendChild(title);
    standardHeader.appendChild(titleGroup);

    const actionsGroup = document.createElement("div");
    Object.assign(actionsGroup.style, { display: "flex", gap: "5px", alignItems: "center" });

    const createHeaderBtn = (iconClass, tooltip, onClickFn) => {
        const btn = document.createElement("button");
        btn.className = `${iconClass} comfy-sidebar-header-btn`;
        btn.title = tooltip;
        btn.onclick = async (ev) => {
            ev.stopPropagation();
            btn.style.transform = "scale(0.88)";
            setTimeout(() => { btn.style.transform = ""; }, 120);
            await onClickFn();
        };
        return btn;
    };

    const initialSortIcon = sortOrder === "newest" ? "pi-sort-amount-down" : "pi-sort-amount-up";
    const initialSortTitle = sortOrder === "newest" ? t("Sort: Newest First") : t("Sort: Oldest First");

    const btnSort = createHeaderBtn(`pi ${initialSortIcon}`, initialSortTitle, () => {
        sortOrder = sortOrder === "newest" ? "oldest" : "newest";
        try { localStorage.setItem("ComfySidebar.GallerySortOrder", sortOrder); } catch (e) {}
        btnSort.className = `pi ${sortOrder === "newest" ? "pi-sort-amount-down" : "pi-sort-amount-up"} comfy-sidebar-header-btn`;
        btnSort.title = sortOrder === "newest" ? t("Sort: Newest First") : t("Sort: Oldest First");
        applySorting();
        renderGallery();
    });

    const btnUp = createHeaderBtn("pi pi-arrow-up", t("Go Up One Level"), async () => {
        if (!currentSubfolder) return;
        const parts = currentSubfolder.split("/").filter(Boolean);
        parts.pop();
        await navigateToSubfolder(parts.join("/"));
    });

    const btnOpenFolder = createHeaderBtn("pi pi-folder-open", t("Open Current Folder in File Manager"), async () => {
        await openFileOrFolder({ subfolder: currentSubfolder, type: "output" });
    });

    const btnRefresh = createHeaderBtn("pi pi-refresh", t("Refresh Gallery"), async () => {
        await fetchGalleryData(currentSubfolder, currentSearchQuery);
        renderGallery();
    });

    actionsGroup.append(btnSort, btnUp, btnOpenFolder, btnRefresh);
    standardHeader.appendChild(actionsGroup);

    const searchContainer = document.createElement("div");
    searchContainer.className = "comfy-sidebar-search-container";
    Object.assign(searchContainer.style, {
        display: "none", width: "100%", alignItems: "center",
        background: "var(--card, var(--secondary, var(--comfy-input-bg, #181818)))",
        border: "1px solid var(--border, var(--border-color, #555))", borderRadius: "4px", padding: "2px 8px",
        boxSizing: "border-box", height: "26px"
    });
    const sIcon = document.createElement("span");
    sIcon.className = "pi pi-search";
    Object.assign(sIcon.style, { fontSize: "11px", opacity: "0.6", marginRight: "6px", transition: "transform 0.2s" });
    const sInput = document.createElement("input");
    Object.assign(sInput, { type: "text", placeholder: t("Search filenames or prompt metadata...") });
    Object.assign(sInput.style, {
        flex: "1", background: "transparent", border: "none", outline: "none",
        color: "var(--comfy-input-color, var(--fg-color, #eee))", fontSize: "11px", padding: "0"
    });
    const sClear = document.createElement("span");
    sClear.className = "pi pi-times comfy-sidebar-icon-btn";
    sClear.title = t("Clear & Close Search");
    Object.assign(sClear.style, { marginLeft: "6px" });

    searchContainer.append(sIcon, sInput, sClear);
    header.append(standardHeader, searchContainer);

    const stickyHeaderGroup = document.createElement("div");
    stickyHeaderGroup.className = "comfy-sidebar-sticky-header-group";
    stickyHeaderGroupEl = stickyHeaderGroup;
    stickyHeaderGroup.appendChild(header);

    let scrollBeforeSearch = 0;

    searchIcon.onclick = (e) => {
        e.stopPropagation();
        const scrollEl = getScrollContainer(cardStackEl);
        scrollBeforeSearch = scrollEl ? scrollEl.scrollTop : 0;
        standardHeader.style.display = "none";
        searchContainer.style.display = "flex";
        sInput.focus();
    };

    let searchDebounce = null;
    const closeSearch = () => {
        const hadFilter = Boolean(currentSearchQuery || sInput.value.trim());
        sInput.value = "";
        currentSearchQuery = "";
        sIcon.className = "pi pi-search";
        searchContainer.style.display = "none";
        standardHeader.style.display = "flex";

        // If the user didn't type a search query, do NOT re-fetch or wipe cards.
        // The scroll position stays right where you are.
        if (hadFilter) {
            fetchGalleryData(currentSubfolder, "").then(() => {
                renderGallery();
                const scrollEl = getScrollContainer(cardStackEl);
                if (scrollEl && scrollBeforeSearch > 0) {
                    scrollEl.scrollTop = scrollBeforeSearch;
                    requestAnimationFrame(() => { scrollEl.scrollTop = scrollBeforeSearch; });
                }
            });
        }
    };

    sClear.onclick = (e) => { e.stopPropagation(); closeSearch(); };
    sInput.onkeydown = (e) => { if (e.key === "Escape") closeSearch(); };
    sInput.oninput = () => {
        currentSearchQuery = sInput.value.trim();
        if (searchDebounce) clearTimeout(searchDebounce);

        sIcon.className = "pi pi-spin pi-spinner";

        searchDebounce = setTimeout(async () => {
            try {
                await fetchGalleryData(currentSubfolder, currentSearchQuery);
                renderGallery();
            } finally {
                sIcon.className = "pi pi-search";
            }
        }, 350);
    };

    const breadcrumbBar = document.createElement("div");
    breadcrumbBar.className = "comfy-sidebar-breadcrumb-bar";
    stickyHeaderGroup.appendChild(breadcrumbBar);
    container.appendChild(stickyHeaderGroup);

    const cardStack = document.createElement("div");
    cardStackEl = cardStack;
    Object.assign(cardStack.style, {
        flex: "1", overflowY: "visible", display: "flex", flexDirection: "column", paddingBottom: "46px"
    });
    container.appendChild(cardStack);

    scrollToTopBtnEl = document.createElement("button");
    scrollToTopBtnEl.className = "pi pi-chevron-up comfy-sidebar-scroll-top-btn";
    scrollToTopBtnEl.title = t("Scroll to Top");
    scrollToTopBtnEl.onclick = (e) => {
        e.stopPropagation();
        const scrollEl = getScrollContainer(cardStackEl);
        if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: "smooth" });
    };
    container.appendChild(scrollToTopBtnEl);

    window.addEventListener("keydown", handleCtrlDown);
    window.addEventListener("keyup", handleCtrlUp);
    window.addEventListener("blur", handleCtrlBlur);
   
    // Reveal Spotlight: track cursor position over Gallery card and folder borders
    setupSpotlightTracker(container, ".comfy-sidebar-card, .comfy-sidebar-folder-card");

    document.addEventListener("scroll", updateScrollTopVisibility, { capture: true, passive: true });

    galleryResizeObserver = new ResizeObserver((entries) => {
        const threshold = getSetting(SettingIds.GRID_COLUMNS_THRESHOLD, 350);
        const cols = calculateGridColumns(entries[0].contentRect.width, threshold);
        if (cols !== currentColumnCount) {
            currentColumnCount = cols;
            renderGallery();
        }
    });
    galleryResizeObserver.observe(container);

    fetchGalleryData("").then(() => renderGallery());

    return container;
}

export function teardownGalleryView() {
    document.removeEventListener("scroll", updateScrollTopVisibility, { capture: true, passive: true });
    window.removeEventListener("keydown", handleCtrlDown);
    window.removeEventListener("keyup", handleCtrlUp);
    window.removeEventListener("blur", handleCtrlBlur);
    document.body.classList.remove("comfy-sidebar-ctrl-active");
    if (galleryResizeObserver) {
        galleryResizeObserver.disconnect();
        galleryResizeObserver = null;
    }
    // Reset header-reveal state so a re-opened gallery starts with a visible header
    lastScrollTop = 0;
    scrollDeltaAccumulator = 0;
    isHeaderHidden = false;
    cachedFolders = [];
    cachedFiles = [];
    stickyHeaderGroupEl = null;
    galleryContainerEl = null;
    cardStackEl = null;
    if (scrollToTopBtnEl && scrollToTopBtnEl.parentNode) {
        scrollToTopBtnEl.parentNode.removeChild(scrollToTopBtnEl);
    }
    scrollToTopBtnEl = null;
}