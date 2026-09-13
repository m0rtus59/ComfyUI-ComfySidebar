import { app } from "/scripts/app.js";
import { PromptStatus } from "../core/constants.js";
import { store } from "../core/store.js";
import { renderCardImages } from "./mediaPreview.js";
import { copyImageToClipboard, openFileOrFolder, deleteFileOnServer, findNodeIdForImage, removeImageFromNodeOutputs } from "./mediaActions.js";
import { centerAndSelectCanvasNode } from "../comfy/adapter.js";
import { getRunOutputs, extractWorkflowFromPng, isImageFormat } from "../utils/utils.js";
import { showFullscreenPreview } from "../utils/comparison.js";
import { stopAllAudioPlayback } from "./audioController.js";
import { deleteHistoryItem, cancelPendingTask, interruptActive } from "../queue/queueService.js";

export const cardPool = new Map();

export function resetAllCardHoverStates() {
    for (const cardObj of cardPool.values()) {
        if (cardObj.hoverPanel) cardObj.hoverPanel.style.display = "none";
        if (cardObj.leftHoverPanel) cardObj.leftHoverPanel.style.display = "none";
    }
}

export function syncCardButtonVisibility(cardObj, state) {
    if (!cardObj) return;

    const isPendingOrActive = state.status === PromptStatus.PENDING || state.status === PromptStatus.ACTIVE;
    if (isPendingOrActive) {
        if (cardObj.hoverPanel) cardObj.hoverPanel.style.setProperty("display", "none", "important");
        if (cardObj.leftHoverPanel) cardObj.leftHoverPanel.style.setProperty("display", "none", "important");
        return;
    } else {
        if (cardObj.hoverPanel) cardObj.hoverPanel.style.removeProperty("display");
        if (cardObj.leftHoverPanel) cardObj.leftHoverPanel.style.removeProperty("display");
    }

    // Check if the card has an actual verified file saved on disk
    const hasRealDiskFiles = state.images && state.images.length > 0 && 
        state.images.some(img => img.filename && !img.isFallback && (!img.url || !img.url.startsWith("blob:")));

    const hasRealImages = hasRealDiskFiles && !state.images.some(img => img.url && img.url.startsWith("blob:"));
    const currentImg = hasRealImages ? state.images[cardObj.currentImageIndex || 0] : null;
    const isPng = currentImg && (currentImg.filename || "").toLowerCase().endsWith(".png");

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

    if (cardObj.btnCopy) {
        const isCopyableImage = hasRealImages && currentImg && isImageFormat(currentImg.filename || currentImg.url);
        if (isCopyableImage) {
            cardObj.btnCopy.style.removeProperty("display");
            cardObj.btnCopy.style.display = "inline-flex";
            cardObj.btnCopy.onclick = async (ev) => {
                ev.stopPropagation();
                const src = currentImg.url ? currentImg.url : `/view?filename=${encodeURIComponent(currentImg.filename)}&type=${currentImg.type || 'output'}&subfolder=${encodeURIComponent(currentImg.subfolder || '')}`;
                const success = await copyImageToClipboard(src);
                if (success) {
                    cardObj.btnCopy.className = "pi pi-check comfy-sidebar-card-action-btn";
                    cardObj.btnCopy.style.color = "#4ade80";
                    setTimeout(() => {
                        cardObj.btnCopy.className = "pi pi-copy comfy-sidebar-card-action-btn";
                        cardObj.btnCopy.style.color = "";
                    }, 1500);
                }
            };
        } else {
            cardObj.btnCopy.style.setProperty("display", "none", "important");
        }
    }

    if (cardObj.btnJson) {
        if (state.workflow || isPng) {
            cardObj.btnJson.style.removeProperty("display");
            cardObj.btnJson.style.display = "inline-flex";
            cardObj.btnJson.onclick = async (ev) => {
                ev.stopPropagation();
                let wf = state.workflow;
                if (!wf && currentImg) {
                    const src = currentImg.url ? currentImg.url : `/view?filename=${encodeURIComponent(currentImg.filename)}&type=${currentImg.type || 'output'}&subfolder=${encodeURIComponent(currentImg.subfolder || '')}`;
                    wf = await extractWorkflowFromPng(src);
                    if (wf) state.workflow = wf;
                }
                if (!wf) {
                    alert("No workflow metadata found in this file.");
                    return;
                }
                const blob = new Blob([JSON.stringify(wf, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `workflow_${state.pid || "comfy"}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1500);
            };
        } else {
            cardObj.btnJson.style.setProperty("display", "none", "important");
        }
    }

    if (cardObj.btnDel) {
        // Always show the delete button so cards can be cleared from history
        cardObj.btnDel.style.removeProperty("display");
        cardObj.btnDel.style.display = "inline-flex";

        cardObj.canDeleteFromDisk = hasRealDiskFiles;
        if (cardObj.btnDelLabel) {
            cardObj.btnDelLabel.style.display = hasRealDiskFiles ? "" : "none";
        }
        cardObj.btnDel.title = hasRealDiskFiles 
            ? "Delete Card (Hold Ctrl to delete file from disk)" 
            : "Delete Card";
    }

    if (cardObj.btnFocus) {
        // Focus the image's node, or the node where the workflow stopped/errored
        const nodeId = (currentImg ? findNodeIdForImage(state, currentImg) : null) || state.activeNodeId;
        if (nodeId) {
            cardObj.btnFocus.style.removeProperty("display");
            cardObj.btnFocus.style.display = "inline-flex";
            cardObj.btnFocus.title = (!currentImg && state.activeNodeId) ? "Show Stopped/Failed Node" : "Show Node";
            cardObj.btnFocus.onclick = (ev) => {
                ev.stopPropagation();
                centerAndSelectCanvasNode(nodeId);
            };
        } else {
            cardObj.btnFocus.style.setProperty("display", "none", "important");
        }
    }

    if (cardObj.leftHoverBtn) {
        const outputs = getRunOutputs(state.nodeOutputs, state.workflow);
        const validOutputs = outputs.filter(o => o.images && o.images.length > 0);

        const primarySignatures = new Set((state.images || []).map(i => `${i.subfolder || ""}/${i.filename}`));
        const distinctOutputs = [];

        for (const out of validOutputs) {
            const hasNewImage = out.images.some(img => !primarySignatures.has(`${img.subfolder || ""}/${img.filename}`));
            if (hasNewImage) {
                distinctOutputs.push(out);
            }
        }

        // Show intermediate button if run completed with multiple outputs, or if stopped with saved outputs
        const hasIntermediates = (validOutputs.length > 1 && distinctOutputs.length > 0) || 
            (state.status !== PromptStatus.COMPLETED && validOutputs.length > 0);

        if (hasIntermediates) {
            // Check if intermediate files still exist on disk
            for (const out of distinctOutputs) {
                for (const img of out.images) {
                    const src = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
                    if (!src.startsWith("blob:")) {
                        fetch(src, { method: "HEAD" }).then(res => {
                            if (res.status === 404) {
                                const liveState = store.getPrompt(state.pid);
                                if (liveState && liveState.nodeOutputs) {
                                    removeImageFromNodeOutputs(liveState.nodeOutputs, img);
                                    store.updatePrompt(liveState.pid, liveState);
                                    syncCardButtonVisibility(cardObj, liveState);
                                }
                            }
                        }).catch(() => {});
                    }
                }
            }

            cardObj.leftHoverBtn.style.removeProperty("display");
            cardObj.leftHoverBtn.style.display = "inline-flex";

            cardObj.leftHoverBtn.onclick = async (ev) => {
                ev.stopPropagation();

                // On click: verify distinct outputs still exist before opening
                const liveState = store.getPrompt(state.pid) || state;
                const curOutputs = getRunOutputs(liveState.nodeOutputs, liveState.workflow);
                const primSigs = new Set((liveState.images || []).map(i => `${i.subfolder || ""}/${i.filename}`));
                const curDistinct = curOutputs.filter(o => o.images && o.images.some(img => !primSigs.has(`${img.subfolder || ""}/${img.filename}`)));

                if (curDistinct.length === 0) {
                    cardObj.leftHoverBtn.style.setProperty("display", "none", "important");
                    return;
                }

                let anyMissing = false;
                for (const out of curDistinct) {
                    for (const img of out.images) {
                        const src = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
                        if (!src.startsWith("blob:")) {
                            try {
                                const res = await fetch(src, { method: "HEAD" });
                                if (res.status === 404) {
                                    removeImageFromNodeOutputs(liveState.nodeOutputs, img);
                                    anyMissing = true;
                                }
                            } catch (e) {}
                        }
                    }
                }

                if (anyMissing) {
                    store.updatePrompt(liveState.pid, liveState);
                    syncCardButtonVisibility(cardObj, liveState);
                    const remaining = getRunOutputs(liveState.nodeOutputs, liveState.workflow)
                        .filter(o => o.images && o.images.some(img => !primSigs.has(`${img.subfolder || ""}/${img.filename}`)));
                    if (remaining.length === 0) {
                        return; // All intermediate outputs were wiped; button is now hidden
                    }
                }

                const scrollEl = document.querySelector('.sidebar-content-container, [class*="sidebar-content-container"], [class*="overflow-y-auto"]') 
                    || store.ui.cardStack?.parentElement 
                    || store.ui.cardStack;
                if (scrollEl) {
                    store.ui.mainQueueScrollTop = scrollEl.scrollTop;
                }
                store.openOutputsSubmenu(liveState.pid);
            };
        } else {
            cardObj.leftHoverBtn.style.setProperty("display", "none", "important");
        }
    }
}

export function updateCardProgressTargeted(cardObj, progress, activeNodeName, showWorkingNode = true, state = null) {
    if (!cardObj) return;
    if (cardObj.progressBar) {
        cardObj.progressBar.style.width = `${progress}%`;
    }
    if (cardObj.statusText && showWorkingNode) {
        cardObj.statusText.style.display = "block";
        const nodeText = activeNodeName ? (activeNodeName === "Finishing..." ? "Finishing..." : `[${activeNodeName}]`) : "Processing...";
        cardObj.statusText.textContent = `${nodeText} ${progress}%`;
    }

    // Fast-path: update live preview image directly on active card
    if (state && state.images && state.images.length > 0) {
        const firstImg = state.images[0];
        const previewUrl = firstImg.url || (firstImg.filename ? `/view?filename=${encodeURIComponent(firstImg.filename)}&type=${firstImg.type || 'output'}&subfolder=${encodeURIComponent(firstImg.subfolder || '')}` : null);
        if (previewUrl && cardObj.firstImgElement && cardObj.firstImgElement.tagName === "IMG") {
            const currentSrc = cardObj.firstImgElement.getAttribute("src") || cardObj.firstImgElement.src;
            if (currentSrc !== previewUrl && !cardObj.firstImgElement.src.endsWith(previewUrl)) {
                cardObj.firstImgElement.src = previewUrl;
            }
        } else {
            updateCardDOM(cardObj, state, true, showWorkingNode);
        }
    }
}

export function getOrCreateCard(state, callbacks = {}) {
    let cardObj = cardPool.get(state.pid);
    if (cardObj) return cardObj;

    const card = document.createElement("div");
    card.id = `card-${state.pid}`;
    card.className = `comfy-sidebar-card ${state.status || "completed"}`;
    card.style.position = "relative";

    const timerEl = document.createElement("div");
    timerEl.className = "comfy-sidebar-card-timer";

    const cancelX = document.createElement("span");
    cancelX.className = "pi pi-times comfy-sidebar-queue-cancel-btn";
    Object.assign(cancelX.style, {
        position: "absolute", top: "4px", right: "4px", display: "none", zIndex: "10"
    });

    const sBadge = document.createElement("div");
    Object.assign(sBadge.style, {
        position: "absolute", top: "6px", right: "8px", fontSize: "9px", fontWeight: "bold",
        padding: "2px 6px", borderRadius: "2px", textTransform: "uppercase", display: "none",
        pointerEvents: "none", zIndex: "10"
    });

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

    const pt = document.createElement("div");
    Object.assign(pt.style, {
        width: "100%", height: "4px", background: "#333", borderRadius: "2px", marginTop: "8px",
        overflow: "hidden", display: "none"
    });
    const pb = document.createElement("div");
    Object.assign(pb.style, {
        width: "0%", height: "100%", background: "#3b82f6", transition: "width 0.1s linear"
    });
    pt.appendChild(pb);

    const statusText = document.createElement("div");
    Object.assign(statusText.style, {
        fontSize: "11px", opacity: "0.9", color: "#3b82f6", textAlign: "center", marginTop: "6px",
        display: "none", fontWeight: "bold"
    });

    const hoverPanel = document.createElement("div");
    hoverPanel.className = "comfy-sidebar-hover-panel";
    Object.assign(hoverPanel.style, {
        position: "absolute", bottom: "4px", right: "4px", flexDirection: "column", gap: "4px", zIndex: "20"
    });

    const btnImg = document.createElement("span");
    btnImg.className = "pi pi-image comfy-sidebar-card-action-btn";
    btnImg.title = "Download Object";

    const btnCopy = document.createElement("span");
    btnCopy.className = "pi pi-copy comfy-sidebar-card-action-btn";
    btnCopy.title = "Copy to Clipboard";
    btnCopy.style.display = "none";

    const btnJson = document.createElement("span");
    btnJson.className = "pi pi-file comfy-sidebar-card-action-btn";
    btnJson.title = "Download JSON";

    const btnDel = document.createElement("span");
    btnDel.className = "pi pi-trash comfy-sidebar-card-action-btn comfy-sidebar-btn-del";
    btnDel.title = "Delete Card (Hold Ctrl to delete file from disk)";
    const btnDelLabel = document.createElement("span");
    btnDelLabel.className = "comfy-sidebar-del-label";
    btnDelLabel.textContent = "Delete File";
    btnDel.appendChild(btnDelLabel);

    const leftHoverPanel = document.createElement("div");
    leftHoverPanel.className = "comfy-sidebar-left-hover-panel";
    Object.assign(leftHoverPanel.style, {
        position: "absolute", bottom: "4px", left: "4px", flexDirection: "column", gap: "4px", zIndex: "20"
    });

    const btnFocus = document.createElement("span");
    btnFocus.className = "pi pi-eye comfy-sidebar-card-action-btn";
    btnFocus.title = "Show Node";

    const leftHoverBtn = document.createElement("span");
    leftHoverBtn.className = "pi pi-images comfy-sidebar-card-action-btn";
    leftHoverBtn.title = "View all intermediate outputs";

    hoverPanel.append(btnImg, btnJson, btnDel);
    leftHoverPanel.append(btnCopy, btnFocus, leftHoverBtn);

    card.append(timerEl, cancelX, sBadge, dimEl, grid, p, pt, statusText, hoverPanel, leftHoverPanel);

    cardObj = {
        element: card,
        timerEl,
        statusBadge: sBadge,
        dimEl,
        grid,
        placeholder: p,
        progressContainer: pt,
        progressBar: pb,
        cancelBtn: cancelX,
        hoverPanel,
        leftHoverPanel,
        btnFocus,
        leftHoverBtn,
        btnImg,
        btnCopy,
        btnJson,
        btnDel,
        btnDelLabel,
        canDeleteFromDisk: true,
        statusText,
        firstImgElement: null,
        lastImagesSignature: "",
        currentImageIndex: 0
    };

    card.addEventListener("mouseenter", () => {
        // Only run automatic button visibility sync on main queue cards (avoid synthetic submenu IDs)
        if (store.hasPrompt(state.pid)) {
            const liveState = store.getPrompt(state.pid);
            syncCardButtonVisibility(cardObj, liveState);
        }
    });

    card.addEventListener("dragstart", (e) => {
        const liveState = store.getPrompt(state.pid) || state;
        const isUnfinished = liveState.status && liveState.status !== PromptStatus.COMPLETED;
        const hasNoImages = !liveState.images || liveState.images.length === 0;

        if (liveState.workflow && (hasNoImages || isUnfinished)) {
            if (cardObj.firstImgElement) {
                try { e.dataTransfer.setDragImage(cardObj.firstImgElement, 15, 15); } catch(err){}
            }
            const jsonStr = JSON.stringify(liveState.workflow, null, 2);
            const filename = `workflow_${liveState.pid}.json`;
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            try {
                e.dataTransfer.setData("DownloadURL", `application/json:${filename}:data:application/json;base64,${base64Data}`);
                e.dataTransfer.setData("application/json", jsonStr);
            } catch (err) {}
            e.dataTransfer.effectAllowed = "copy";
        }
    });

    let deleteTimeout = null, isDeletePending = false, isDiskDelete = false;
    const resetDeleteBtn = () => {
        isDeletePending = false;
        isDiskDelete = false;
        cardObj.btnDel.classList.remove("confirm-delete", "confirm-delete-disk");
        cardObj.btnDel.title = "Delete Card (Ctrl+Click to delete from disk)";
        if (deleteTimeout) { clearTimeout(deleteTimeout); deleteTimeout = null; }
    };

    btnDel.onclick = async (ev) => {
        ev.stopPropagation();
        const wantsDiskDelete = (ev.ctrlKey || ev.metaKey) && cardObj.canDeleteFromDisk !== false;

        if (!isDeletePending) {
            isDeletePending = true;
            isDiskDelete = wantsDiskDelete;
            cardObj.btnDel.classList.add(wantsDiskDelete ? "confirm-delete-disk" : "confirm-delete");
            cardObj.btnDel.title = wantsDiskDelete
                ? "Ctrl+Click again to delete file from DISK / TRASH"
                : "Click again to confirm removing card";
            deleteTimeout = setTimeout(resetDeleteBtn, 2000);
        } else {
            const shouldDeleteFromDisk = isDiskDelete || wantsDiskDelete;
            resetDeleteBtn();

            const liveState = store.getPrompt(state.pid) || state;

            if (shouldDeleteFromDisk) {
                const filesToDelete = [];
                const seen = new Set();
                const addFile = (item) => {
                    if (item && item.filename) {
                        const key = `${item.type || ""}/${item.subfolder || ""}/${item.filename}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            filesToDelete.push(item);
                        }
                    }
                };

                (liveState.images || []).forEach(addFile);
                const allOutputs = getRunOutputs(liveState.nodeOutputs, liveState.workflow);
                allOutputs.forEach(out => (out.images || []).forEach(addFile));

                for (const fileItem of filesToDelete) {
                    await deleteFileOnServer(fileItem);
                }
            }

            deleteHistoryItem(state.pid);
        }
    };

    cardPool.set(state.pid, cardObj);
    return cardObj;
}

export function updateCardDOM(cardObj, state, showPendingSummary = true, showWorkingNode = true) {
    cardObj.element.className = `comfy-sidebar-card ${state.status}`;
    cardObj.element.style.position = "relative";

    const isUnfinished = state.status && state.status !== PromptStatus.COMPLETED;
    if (state.images && state.images.length > 0 && !isUnfinished) {
        cardObj.element.removeAttribute("draggable");
    } else {
        cardObj.element.setAttribute("draggable", "true");
    }

    if (state.status === PromptStatus.ACTIVE) {
        cardObj.timerEl.textContent = state.startTime ? ((Date.now() - state.startTime) / 1000).toFixed(2) + "s" : "...";
        cardObj.timerEl.style.display = "block";
    } else if (state.duration !== undefined && state.duration !== null) {
        cardObj.timerEl.textContent = state.duration.toFixed(2) + "s";
        cardObj.timerEl.style.display = "block";
    } else {
        cardObj.timerEl.style.display = "none";
    }

    if (state.status === PromptStatus.CANCELLED) {
        Object.assign(cardObj.statusBadge.style, { display: "block", background: "#ffc107", color: "#000" });
        cardObj.statusBadge.textContent = "Cancelled";
    } else if (state.status === PromptStatus.ERROR) {
        Object.assign(cardObj.statusBadge.style, { display: "block", background: "#dc3545", color: "#fff" });
        cardObj.statusBadge.textContent = "Error";
    } else {
        cardObj.statusBadge.style.display = "none";
    }

    if (state.status === PromptStatus.PENDING && !showPendingSummary) {
        cardObj.cancelBtn.style.display = "flex";
        cardObj.cancelBtn.title = "Cancel Queued Task";
        cardObj.cancelBtn.onclick = async (ev) => {
            ev.stopPropagation();
            cancelPendingTask(state.pid);
        };
    } else if (state.status === PromptStatus.ACTIVE) {
        cardObj.cancelBtn.style.display = "flex";
        cardObj.cancelBtn.title = "Interrupt Execution";
        cardObj.cancelBtn.onclick = async (ev) => {
            ev.stopPropagation();
            interruptActive();
        };
    } else {
        cardObj.cancelBtn.style.display = "none";
    }

    const currentImagesSignature = `${state.status || ""}:${state.images ? state.images.map(img => img.url || img.filename).join("|") : ""}`;
    if (cardObj.lastImagesSignature !== currentImagesSignature) {
        if (!state.images || state.images.length === 0) {
            cardObj.grid.innerHTML = "";
            cardObj.firstImgElement = null;
            cardObj.placeholder.style.display = "block";
        } else {
            cardObj.placeholder.style.display = "none";
            renderCardImages(cardObj, state, (st) => {
                const scrollEl = document.querySelector('.sidebar-content-container, [class*="sidebar-content-container"], [class*="overflow-y-auto"]') 
                    || store.ui.cardStack?.parentElement 
                    || store.ui.cardStack;
                if (scrollEl) {
                    store.ui.mainQueueScrollTop = scrollEl.scrollTop;
                }
                store.openBatchSubmenu({
                    pid: st.pid,
                    images: st.images,
                    workflow: st.workflow,
                    nodeOutputs: st.nodeOutputs
                });
            });
        }
        cardObj.lastImagesSignature = currentImagesSignature;
    }

    if (state.images.length === 0) {
        if (state.texts && state.texts.length > 0) {
            const fullText = state.texts.join("\n\n");
            cardObj.placeholder.textContent = fullText;
            cardObj.placeholder.title = "Click to read full text";
            cardObj.placeholder.className = "comfy-sidebar-text-clamp";
            cardObj.placeholder.style.cssText = "";
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

    if (state.status === PromptStatus.ACTIVE) {
        if (showWorkingNode) {
            cardObj.statusText.style.display = "block";
            const nodeText = state.activeNodeName ? (state.activeNodeName === "Finishing..." ? "Finishing..." : `[${state.activeNodeName}]`) : "Processing...";
            cardObj.statusText.textContent = `${nodeText}${state.progress ? ` ${state.progress}%` : ""}`;
        } else {
            cardObj.statusText.style.display = "none";
        }
        cardObj.progressContainer.style.display = "block";
        cardObj.progressBar.style.width = `${state.progress || 0}%`;
    } else {
        cardObj.statusText.style.display = "none";
        cardObj.progressContainer.style.display = "none";
    }

    syncCardButtonVisibility(cardObj, state);
    return cardObj.element;
}