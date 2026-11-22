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
        closeButton: false,
        onUserClose: closeGroupViewer
    });

    const panel = document.createElement("div");
    panel.className = "comfy-sidebar-similar-prompts-panel";
    Object.assign(panel.style, {
        position: "relative", zIndex: "20", pointerEvents: "auto",
        width: "min(1180px, 92vw)", height: "min(82vh, 900px)",
        maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 32px)",
        minWidth: "320px", padding: "16px", boxSizing: "border-box",
        border: "1px solid var(--border-color, rgba(255,255,255,.16))",
        borderRadius: "10px", background: "var(--comfy-menu-bg, var(--comfy-input-bg, #222))",
        color: "var(--fg-color, var(--foreground, #eee))",
        boxShadow: "var(--shadow-lg, 0 18px 60px rgba(0,0,0,.55))",
        overflow: "hidden", userSelect: "auto"
    });
    overlay.container.appendChild(panel);

    const content = document.createElement("div");
    Object.assign(content.style, {
        width: "100%", height: "100%", minHeight: "0", display: "flex",
        flexDirection: "column", gap: "12px", font: "inherit"
    });

    const heading = document.createElement("div");
    Object.assign(heading.style, {
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flex: "none"
    });
    const title = document.createElement("strong");
    title.textContent = t("Similar prompt groups");
    const status = document.createElement("span");
    Object.assign(status.style, { marginLeft: "auto", fontSize: "11px", opacity: "0.65" });
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "×";
    closeButton.title = t("Close");
    Object.assign(closeButton.style, {
        width: "30px", height: "30px", padding: "0", border: "0", borderRadius: "5px",
        background: "transparent", color: "inherit", cursor: "pointer", fontSize: "22px"
    });
    closeButton.addEventListener("click", () => overlay.destroy());
    heading.append(title, status, closeButton);

    const controls = document.createElement("div");
    Object.assign(controls.style, {
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px",
        fontSize: "12px", flex: "none"
    });
    const thresholdLabel = document.createElement("label");
    thresholdLabel.textContent = t("Similarity threshold");
    const threshold = document.createElement("input");
    threshold.type = "range";
    threshold.min = "25";
    threshold.max = "90";
    threshold.step = "5";
    threshold.value = "55";
    const thresholdValue = document.createElement("span");
    thresholdValue.textContent = "55%";
    thresholdLabel.appendChild(threshold);
    controls.append(thresholdLabel, thresholdValue);

    const cardSizeLabel = document.createElement("label");
    cardSizeLabel.textContent = t("Card size");
    const cardSize = document.createElement("input");
    cardSize.type = "range";
    cardSize.min = "100";
    cardSize.max = "280";
    cardSize.step = "10";
    cardSize.value = "150";
    cardSizeLabel.appendChild(cardSize);
    controls.appendChild(cardSizeLabel);

    const results = document.createElement("div");
    Object.assign(results.style, {
        overflowY: "auto", minHeight: "0", flex: "1", paddingRight: "4px",
        display: "flex", flexDirection: "column", gap: "12px"
    });
    content.append(heading, controls, results);
    panel.appendChild(content);
    overlay.addCleanup(closeGroupViewer);
    setupSpotlightTracker(results, ".comfy-sidebar-card");

    const updateCardSize = () => results.querySelectorAll(".comfy-sidebar-similar-grid").forEach(grid => {
        grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`;
    });
    cardSize.addEventListener("input", updateCardSize);

    const loadGroups = async () => {
        if (requestController) requestController.abort();
        const controller = new AbortController();
        requestController = controller;
        const id = ++requestId;
        status.textContent = t("Scanning prompts...");
        results.replaceChildren();
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
                groupName.textContent = t("Group") + " " + (groupIndex + 1) + " · " + group.items.length + " " + t("images");
                const score = document.createElement("span");
                score.textContent = group.similarity + "% " + t("similarity");
                groupHeader.append(groupName, score);

                const grid = document.createElement("div");
                grid.className = "comfy-sidebar-similar-grid";
                Object.assign(grid.style, {
                    display: "grid",
                    gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`,
                    gap: "8px"
                });

                const previewAssets = group.items.map(item => ({
                    filename: item.filename,
                    subfolder: item.subfolder || "",
                    type: "output"
                }));

                group.items.forEach(item => {
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
                            if (action) card.remove();
                        }
                    });
                    actions.appendChild(deleteButton);
                    card.append(gridContent, nameBadge, actions);
                    grid.appendChild(card);
                });
                section.append(groupHeader, grid);
                results.appendChild(section);
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
        clearTimeout(debounce);
        debounce = setTimeout(loadGroups, 250);
    });

    await loadGroups();
}
