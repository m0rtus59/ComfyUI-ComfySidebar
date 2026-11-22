import { t } from "../core/i18n.js";
import { deleteFileOnServer } from "./mediaActions.js";
import { attachDeleteConfirmation, setupSpotlightTracker } from "../utils/utils.js";
import { showNotification } from "../utils/nodeRenumber.js";
import { renderCardImages } from "./mediaPreview.js";
import { SidebarOverlay } from "../utils/overlay.js";

export async function openSimilarPromptsDialog(currentSubfolder = "") {
    let requestId = 0;
    let requestController = null;
    let debounce = null;

    const closeGroupViewer = () => {
        requestController?.abort();
        clearTimeout(debounce);
    };

    // The group viewer shares the same overlay system as fullscreen previews.
    // A preview opened from a card is appended later and becomes the top layer.
    const overlay = new SidebarOverlay({
        className: "comfy-sidebar-similar-prompts-overlay",
        background: "rgba(0, 0, 0, 0.58)",
        zIndex: 1000,
        onUserClose: closeGroupViewer
    });

    // Render directly on the shared overlay. Its bounds already account for
    // open sidebars, so the group UI naturally uses the remaining workspace.
    const content = document.createElement("div");
    Object.assign(content.style, {
        position: "absolute", inset: "0", width: "100%", height: "100%",
        minHeight: "0", display: "flex", flexDirection: "column", gap: "12px",
        padding: "20px 24px", boxSizing: "border-box", font: "inherit",
        pointerEvents: "auto", userSelect: "auto", overflow: "hidden", zIndex: "20"
    });

    const heading = document.createElement("div");
    Object.assign(heading.style, {
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flex: "none"
    });
    const title = document.createElement("strong");
    title.textContent = t("Similar prompt groups");
    const status = document.createElement("span");
    Object.assign(status.style, { marginLeft: "auto", marginRight: "44px", fontSize: "11px", opacity: "0.65" });
    // SidebarOverlay supplies the same round close control used by previews.
    heading.append(title, status);

    const controls = document.createElement("div");
    Object.assign(controls.style, {
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: "18px",
        fontSize: "12px", flex: "none", padding: "4px 0"
    });
    const thresholdLabel = document.createElement("label");
    thresholdLabel.textContent = t("Similarity threshold");
    Object.assign(thresholdLabel.style, { display: "flex", alignItems: "center", gap: "10px", lineHeight: "1" });
    const threshold = document.createElement("input");
    threshold.type = "range";
    threshold.min = "25";
    threshold.max = "90";
    threshold.step = "5";
    const savedSettings = (() => {
        try { return JSON.parse(localStorage.getItem("comfy-sidebar-similar-prompts-settings-v1") || "{}"); }
        catch (_) { return {}; }
    })();
    threshold.value = String(Math.max(25, Math.min(90, Number(savedSettings.threshold) || 55)));
    Object.assign(threshold.style, { verticalAlign: "middle", accentColor: "var(--primary, var(--p-primary-color, var(--primary-color, var(--accent, currentColor))))", cursor: "pointer" });
    const thresholdValue = document.createElement("span");
    Object.assign(thresholdValue.style, { alignSelf: "center", minWidth: "34px", fontVariantNumeric: "tabular-nums" });
    thresholdValue.textContent = threshold.value + "%";
    thresholdLabel.append(threshold, thresholdValue);
    controls.appendChild(thresholdLabel);

    const cardSizeLabel = document.createElement("label");
    cardSizeLabel.textContent = t("Card size");
    Object.assign(cardSizeLabel.style, { display: "flex", alignItems: "center", gap: "10px", lineHeight: "1" });
    const cardSize = document.createElement("input");
    cardSize.type = "range";
    cardSize.min = "100";
    cardSize.max = "280";
    cardSize.step = "10";
    cardSize.value = String(Math.max(100, Math.min(280, Number(savedSettings.cardSize) || 150)));
    Object.assign(cardSize.style, { verticalAlign: "middle", accentColor: "var(--primary, var(--p-primary-color, var(--primary-color, var(--accent, currentColor))))", cursor: "pointer" });
    cardSizeLabel.appendChild(cardSize);
    controls.appendChild(cardSizeLabel);

    const results = document.createElement("div");
    Object.assign(results.style, {
        overflowY: "auto", minHeight: "0", flex: "1", paddingRight: "4px",
        display: "flex", flexDirection: "column", gap: "12px"
    });
    content.append(heading, controls, results);
    overlay.container.appendChild(content);
    overlay.addCleanup(closeGroupViewer);
    setupSpotlightTracker(results, ".comfy-sidebar-card");

    const saveSettings = () => {
        try {
            localStorage.setItem("comfy-sidebar-similar-prompts-settings-v1", JSON.stringify({
                threshold: Number(threshold.value),
                cardSize: Number(cardSize.value)
            }));
        } catch (_) {}
    };
    // Masonry layout, same approach as the Gallery/Queue sidebars: flex columns,
    // each card goes into the currently shortest one so mixed aspect ratios pack
    // naturally instead of being forced into uniform grid rows.
    const GAP = 8;
    let groupViews = [];
    const layoutGroup = (view, force = false) => {
        const width = view.grid.clientWidth;
        if (!width) return;
        const cols = Math.max(1, Math.floor((width + GAP) / (Number(cardSize.value) + GAP)));
        if (!force && cols === view.cols) return;
        view.cols = cols;
        const columns = Array.from({ length: cols }, () => {
            const col = document.createElement("div");
            col.className = "comfy-sidebar-masonry-col";
            Object.assign(col.style, {
                flex: "1", display: "flex", flexDirection: "column", gap: GAP + "px", minWidth: "0"
            });
            return col;
        });
        view.grid.replaceChildren(...columns);
        const heights = new Array(cols).fill(0);
        view.cards.forEach(card => {
            let shortest = 0;
            for (let c = 1; c < cols; c++) if (heights[c] < heights[shortest]) shortest = c;
            columns[shortest].appendChild(card);
            heights[shortest] += (card.offsetHeight || 160) + GAP;
        });
    };
    const relayoutAll = () => groupViews.forEach(view => layoutGroup(view));
    const updateCardSize = () => {
        relayoutAll();
        saveSettings();
    };
    cardSize.addEventListener("input", updateCardSize);
    if (window.ResizeObserver) {
        let resizeFrame = 0;
        const resizeObserver = new ResizeObserver(() => {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(relayoutAll);
        });
        resizeObserver.observe(results);
        overlay.addCleanup(() => {
            cancelAnimationFrame(resizeFrame);
            resizeObserver.disconnect();
        });
    }

    const loadGroups = async () => {
        if (requestController) requestController.abort();
        const controller = new AbortController();
        requestController = controller;
        const id = ++requestId;
        status.textContent = t("Scanning prompts...");
        results.replaceChildren();
        groupViews = [];
        thresholdValue.textContent = threshold.value + "%";
        try {
            const params = new URLSearchParams({
                subfolder: currentSubfolder,
                threshold: (Number(threshold.value) / 100).toFixed(2)
            });
            const response = await fetch("/comfy-sidebar/gallery/similar-prompts?" + params.toString(), {
                signal: controller.signal
            });
            if (!response.ok) throw new Error("HTTP " + response.status);
            const data = await response.json();
            if (id !== requestId || overlay.destroyed) return;
            status.textContent = t("{count} groups · {scanned} PNGs scanned", {
                count: data.groups?.length || 0, scanned: data.scanned || 0
            });
            if (!data.groups?.length) {
                const empty = document.createElement("div");
                empty.textContent = t("No similar prompt groups found at this threshold.");
                empty.style.cssText = "padding:28px;text-align:center;opacity:.65;font-size:12px";
                results.appendChild(empty);
                return;
            }

            data.groups.forEach((group, groupIndex) => {
                const section = document.createElement("section");
                Object.assign(section.style, {
                    border: "1px solid var(--border-color, rgba(255,255,255,.12))",
                    borderRadius: "8px", padding: "10px", display: "flex",
                    flexDirection: "column", gap: "8px"
                });
                const groupHeader = document.createElement("div");
                Object.assign(groupHeader.style, {
                    display: "flex", justifyContent: "space-between", fontSize: "11px", opacity: ".8"
                });
                const groupName = document.createElement("strong");
                const view = { grid: null, cards: [], cols: 0 };
                const updateGroupTitle = () => {
                    groupName.textContent = t("Group") + " " + (groupIndex + 1) + " · " + view.cards.length + " " + t("images");
                };
                const removeCard = (card) => {
                    card.remove();
                    const at = view.cards.indexOf(card);
                    if (at >= 0) view.cards.splice(at, 1);
                    if (!view.cards.length) {
                        section.remove();
                        groupViews = groupViews.filter(v => v !== view);
                    } else {
                        updateGroupTitle();
                    }
                };
                const score = document.createElement("span");
                score.textContent = group.similarity + "% " + t("similarity");
                groupHeader.append(groupName, score);

                const grid = document.createElement("div");
                grid.className = "comfy-sidebar-similar-grid";
                Object.assign(grid.style, {
                    display: "flex", gap: GAP + "px", alignItems: "flex-start", width: "100%"
                });
                view.grid = grid;

                const previewAssets = group.items.map(item => ({
                    filename: item.filename,
                    subfolder: item.subfolder || "",
                    type: "output"
                }));

                group.items.forEach((item, itemIndex) => {
                    const card = document.createElement("div");
                    card.className = "comfy-sidebar-card completed";
                    Object.assign(card.style, {
                        position: "relative", cursor: "pointer", minWidth: "0"
                    });

                    const previewUrl = "/view?filename=" + encodeURIComponent(item.filename) +
                        "&type=output&subfolder=" + encodeURIComponent(item.subfolder || "");
                    const gridContent = document.createElement("div");
                    gridContent.style.width = "100%";
                    const cardObj = {
                        element: card,
                        grid: gridContent,
                        dimEl: null,
                        currentImageIndex: 0,
                        firstImgElement: null
                    };
                    const asset = {
                        filename: item.filename,
                        subfolder: item.subfolder || "",
                        type: "output",
                        url: previewUrl
                    };
                    previewAssets[itemIndex]._onPreviewAssetDeleted = () => removeCard(card);
                    // Use Gallery's media renderer so the image keeps its native
                    // aspect ratio and the spotlight remains on the card surface.
                    renderCardImages(cardObj, {
                        pid: `similar-${groupIndex}-${item.filename}`,
                        images: [asset],
                        _previewImages: previewAssets,
                        workflow: null
                    });

                    const nameBadge = document.createElement("div");
                    nameBadge.className = "comfy-sidebar-card-filename-badge";
                    nameBadge.textContent = item.filename;
                    nameBadge.title = item.filename;

                    const actions = document.createElement("div");
                    actions.className = "comfy-sidebar-hover-panel";
                    Object.assign(actions.style, {
                        position: "absolute", bottom: "4px", right: "4px",
                        flexDirection: "column", gap: "4px", zIndex: "20"
                    });
                    const deleteButton = document.createElement("span");
                    deleteButton.className = "pi pi-trash comfy-sidebar-card-action-btn comfy-sidebar-btn-del";
                    attachDeleteConfirmation(deleteButton, {
                        idleTitle: t("Delete file"),
                        confirmTitle: t("Click again to confirm deleting file"),
                        confirmDiskTitle: t("Ctrl+Click again to delete file from DISK / TRASH"),
                        onConfirm: async () => {
                            const action = await deleteFileOnServer({
                                filename: item.filename,
                                subfolder: item.subfolder || "",
                                type: "output"
                            });
                            if (action && action !== "missing") {
                                showNotification(
                                    action === "trashed" ? t("Moved file to Recycle Bin.") : t("Permanently deleted file."),
                                    "success", t("Delete File")
                                );
                            }
                            if (action) removeCard(card);
                        }
                    });
                    actions.appendChild(deleteButton);
                    card.append(gridContent, nameBadge, actions);
                    view.cards.push(card);
                });
                updateGroupTitle();
                section.append(groupHeader, grid);
                results.appendChild(section);
                groupViews.push(view);
                layoutGroup(view, true);
            });
        } catch (error) {
            if (error?.name === "AbortError" || id !== requestId) return;
            status.textContent = t("Could not scan prompts");
            const message = document.createElement("div");
            message.textContent = error?.message || String(error);
            message.style.cssText = "padding:20px;color:var(--error-text,#f87171);font-size:12px";
            results.appendChild(message);
        } finally {
            if (requestController === controller) requestController = null;
        }
    };

    threshold.addEventListener("input", () => {
        thresholdValue.textContent = threshold.value + "%";
        saveSettings();
        clearTimeout(debounce);
        debounce = setTimeout(loadGroups, 250);
    });

    await loadGroups();
    return overlay;
}
