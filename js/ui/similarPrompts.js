import { ComfyDialog } from "/scripts/ui.js";
import { t } from "../core/i18n.js";
import { showFullscreenPreview } from "../utils/comparison.js";
import { deleteFileOnServer } from "./mediaActions.js";
import { attachDeleteConfirmation, setupSpotlightTracker } from "../utils/utils.js";
import { showNotification } from "./nodeRenumber.js";

export async function openSimilarPromptsDialog(currentSubfolder = "") {
    const dialog = new ComfyDialog();
    const content = document.createElement("div");
    content.className = "comfy-sidebar-similar-prompts-dialog";
    Object.assign(content.style, {
        width: "min(1180px, 92vw)", maxWidth: "calc(100vw - 32px)",
        minWidth: "320px", height: "min(82vh, 900px)", maxHeight: "82vh", display: "flex",
        flexDirection: "column", gap: "12px", color: "var(--fg-color, #eee)"
    });
    const heading = document.createElement("div");
    Object.assign(heading.style, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" });
    const title = document.createElement("strong");
    title.textContent = t("Similar prompt groups");
    const status = document.createElement("span");
    Object.assign(status.style, { fontSize: "11px", opacity: "0.65" });
    heading.append(title, status);

    const controls = document.createElement("div");
    Object.assign(controls.style, { display: "flex", alignItems: "center", gap: "10px", fontSize: "12px" });
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
    cardSize.type = "range"; cardSize.min = "100"; cardSize.max = "280"; cardSize.step = "10"; cardSize.value = "150";
    cardSizeLabel.appendChild(cardSize);
    controls.appendChild(cardSizeLabel);

    const results = document.createElement("div");
    Object.assign(results.style, {
        overflowY: "auto", minHeight: "180px", paddingRight: "4px",
        display: "flex", flexDirection: "column", gap: "12px"
    });
    content.append(heading, controls, results);

    let requestId = 0;
    let requestController = null;
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
            if (id !== requestId) return;
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
                Object.assign(groupHeader.style, { display: "flex", justifyContent: "space-between", fontSize: "11px", opacity: ".8" });
                const groupName = document.createElement("strong");
                groupName.textContent = t("Group") + " " + (groupIndex + 1) + " · " + group.items.length + " " + t("images");
                const score = document.createElement("span");
                score.textContent = group.similarity + "% " + t("similarity");
                groupHeader.append(groupName, score);
                const grid = document.createElement("div");
                grid.className = "comfy-sidebar-similar-grid";
                Object.assign(grid.style, {
                    display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`,
                    gap: "8px"
                });
                group.items.forEach(item => {
                    const card = document.createElement("div");
                    card.className = "comfy-sidebar-card completed";
                    Object.assign(card.style, { minWidth: "0", display: "flex", flexDirection: "column", gap: "5px", position: "relative", overflow: "hidden" });
                    const image = document.createElement("img");
                    image.loading = "lazy";
                    image.src = "/view?filename=" + encodeURIComponent(item.filename) + "&type=output&subfolder=" + encodeURIComponent(item.subfolder || "");
                    image.alt = item.filename;
                    Object.assign(image.style, {
                        width: "100%", aspectRatio: "1 / 1", objectFit: "contain",
                        background: "rgba(0,0,0,.18)", borderRadius: "5px", cursor: "pointer"
                    });
                    image.onclick = () => {
                        const urls = group.items.map(entry =>
                            "/view?filename=" + encodeURIComponent(entry.filename) +
                            "&type=output&subfolder=" + encodeURIComponent(entry.subfolder || "")
                        );
                        const selected = group.items.findIndex(entry =>
                            entry.filename === item.filename && (entry.subfolder || "") === (item.subfolder || "")
                        );
                        dialog.close();
                        showFullscreenPreview(urls, false, null, Math.max(0, selected));
                    };
                    const actions = document.createElement("div");
                    actions.className = "comfy-sidebar-hover-panel";
                    Object.assign(actions.style, { position: "absolute", right: "4px", bottom: "4px", zIndex: "2" });
                    const deleteButton = document.createElement("span");
                    deleteButton.className = "pi pi-trash comfy-sidebar-card-action-btn comfy-sidebar-btn-del";
                    deleteButton.title = t("Delete file");
                    attachDeleteConfirmation(deleteButton, {
                        idleTitle: t("Delete file"),
                        confirmTitle: t("Click again to confirm deleting file"),
                        confirmDiskTitle: t("Ctrl+Click again to delete file from DISK / TRASH"),
                        onConfirm: async (deleteFromDisk) => {
                            const asset = { filename: item.filename, subfolder: item.subfolder || "", type: "output" };
                            const action = await deleteFileOnServer(asset);
                            if (action && action !== "missing") {
                                showNotification(action === "trashed" ? t("Moved file to Recycle Bin.") : t("Permanently deleted file."), "success", t("Delete File"));
                            }
                            if (action) {
                                card.remove();
                            }
                        }
                    });
                    actions.appendChild(deleteButton);
                    const name = document.createElement("span");
                    name.textContent = item.filename;
                    name.title = item.filename;
                    Object.assign(name.style, { fontSize: "10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
                    card.append(image, name, actions);
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
    let debounce = null;
    threshold.addEventListener("input", () => {
        thresholdValue.textContent = threshold.value + "%";
        clearTimeout(debounce);
        debounce = setTimeout(loadGroups, 250);
    });
    dialog.show(content);
    await loadGroups();
}

