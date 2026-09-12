import { isImageFormat, isVideoFormat, is3DFormat, isAudioFormat, getFilenameFromUrl } from "../utils/utils.js";
import { openFileOrFolder, removeImageFromNodeOutputs } from "./mediaActions.js";
import { stopAllAudioPlayback, isAudioViewerOpen, setCurrentlyPlayingAudio, getCurrentlyPlayingAudio } from "./audioController.js";
import { showFullscreenPreview } from "../utils/comparison.js";
import { store } from "../core/store.js";
import { PromptStatus } from "../core/constants.js";

export function render3DCardPreview(cardObj, wrapper, src, img, state) {
    let preview3D = wrapper.querySelector(".comfy-sidebar-3d-wrapper");
    const fullUrl = img.url ? img.url : window.location.origin + `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;

    const imageAssets = state?.images?.filter(i => isImageFormat(i.filename || i.url)) || [];
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
        if (ev.ctrlKey || ev.metaKey) {
            openFileOrFolder(img);
            return;
        }
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

export function renderAudioCardPreview(cardObj, wrapper, src, img, state) {
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
            if (getCurrentlyPlayingAudio() === audioEl) stopAllAudioPlayback();
        };

        const togglePlay = (e) => {
            e.stopPropagation();

            if (isAudioViewerOpen()) {
                stopAllAudioPlayback();
                showFullscreenPreview([fullUrl]);
                return;
            }

            if (audioEl.paused) {
                setCurrentlyPlayingAudio(audioEl);
                audioEl.play().catch(()=>{});
                playBtn.innerHTML = stopIconSvg;
                previewAudio.classList.add("playing");
            } else {
                audioEl.pause();
                audioEl.currentTime = 0;
                resetAudioUI();
                stopAllAudioPlayback();
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
            if (e.ctrlKey || e.metaKey) {
                openFileOrFolder(img);
                return;
            }
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

export function renderGenericFileCardPreview(cardObj, wrapper, src, img, state) {
    if (cardObj.dimEl) cardObj.dimEl.style.display = "none";
    const playIcon = wrapper.querySelector(".comfy-sidebar-play-icon");
    if (playIcon) playIcon.remove();
    let previewFile = wrapper.querySelector(".comfy-sidebar-file-wrapper");
    const fullUrl = img.url ? img.url : window.location.origin + `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || 'output'}&subfolder=${encodeURIComponent(img.subfolder || '')}`;
    const filename = img.filename || getFilenameFromUrl(src) || "output_file";
    const ext = (filename.split('.').pop() || "FILE").toUpperCase();
    const folderName = img.subfolder ? `${img.subfolder}/` : (img.type || "output");

    if (!previewFile) {
        wrapper.innerHTML = "";
        previewFile = document.createElement("div");
        previewFile.className = "comfy-sidebar-file-wrapper";

        const topRow = document.createElement("div");
        Object.assign(topRow.style, { display: "flex", justifyContent: "flex-end", width: "100%", minHeight: "18px" });

        const badge = document.createElement("span");
        badge.className = "comfy-sidebar-file-badge";
        badge.textContent = ext;
        topRow.appendChild(badge);

        const centerArea = document.createElement("div");
        Object.assign(centerArea.style, { display: "flex", alignItems: "center", gap: "8px", width: "100%", margin: "2px 0 6px 0" });

        const icon = document.createElement("span");
        icon.className = "pi pi-file comfy-sidebar-file-icon";

        const title = document.createElement("span");
        title.className = "comfy-sidebar-file-title";
        title.textContent = filename;
        title.title = filename;

        centerArea.append(icon, title);

        const bottomRow = document.createElement("div");
        Object.assign(bottomRow.style, { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" });

        const folderInfo = document.createElement("div");
        folderInfo.className = "comfy-sidebar-file-subtext";
        folderInfo.innerHTML = `<i class="pi pi-folder" style="font-size: 10px;"></i><span>${folderName}</span>`;

        const openHint = document.createElement("div");
        openHint.className = "comfy-sidebar-file-subtext";
        openHint.innerHTML = `<i class="pi pi-external-link" style="font-size: 9px;"></i><span>Open Folder</span>`;

        bottomRow.append(folderInfo, openHint);

        previewFile.append(topRow, centerArea, bottomRow);
        wrapper.appendChild(previewFile);
    } else {
        const title = previewFile.querySelector(".comfy-sidebar-file-title");
        if (title) { title.textContent = filename; title.title = filename; }
        const badge = previewFile.querySelector(".comfy-sidebar-file-badge");
        if (badge) badge.textContent = ext;
    }

    cardObj.firstImgElement = previewFile;

    previewFile.onclick = (ev) => {
        ev.stopPropagation();
        openFileOrFolder(img);
    };

    previewFile.setAttribute("draggable", "true");
    previewFile.ondragstart = (e) => {
        e.stopPropagation();
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

export function renderCardImages(cardObj, state, onNavigateBatch) {
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
    const isVideo = isVideoFormat(src) || isVideoFormat(img.filename);
    const is3D = is3DFormat(src) || is3DFormat(img.filename);
    const isAudio = isAudioFormat(src) || isAudioFormat(img.filename);
    const isImage = isImageFormat(src) || isImageFormat(img.filename) || (!isVideo && !is3D && !isAudio && !img.filename?.includes("."));

    let wrapper = cardObj.grid.querySelector(".comfy-sidebar-media-wrapper");
    if (!wrapper) {
        cardObj.grid.innerHTML = "";
        wrapper = document.createElement("div");
        wrapper.className = "comfy-sidebar-media-wrapper";
        Object.assign(wrapper.style, { position: "relative", width: "100%", display: "block" });
        cardObj.grid.appendChild(wrapper);
    }

    let ctrlOverlay = wrapper.querySelector(".comfy-sidebar-ctrl-overlay");
    if (!ctrlOverlay) {
        ctrlOverlay = document.createElement("div");
        ctrlOverlay.className = "comfy-sidebar-ctrl-overlay";
        ctrlOverlay.innerHTML = `<i class="pi pi-folder-open"></i><span>Open Location</span>`;
        wrapper.appendChild(ctrlOverlay);
    }

    if (is3D) {
        render3DCardPreview(cardObj, wrapper, src, img, state);
        return;
    }

    if (isAudio) {
        renderAudioCardPreview(cardObj, wrapper, src, img, state);
        return;
    }

    if (!isImage && !isVideo) {
        renderGenericFileCardPreview(cardObj, wrapper, src, img, state);
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
        if (ev.ctrlKey || ev.metaKey) {
            openFileOrFolder(img);
            return;
        }
        let activeSrc = mediaEl.currentSrc || mediaEl.src || src;
        // If it's a preview blob, snapshot the rendered pixels from the card so revoked blobs don't 404 in fullscreen
        if (activeSrc && activeSrc.startsWith("blob:") && mediaEl.naturalWidth > 0) {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = mediaEl.naturalWidth;
                canvas.height = mediaEl.naturalHeight;
                canvas.getContext("2d").drawImage(mediaEl, 0, 0);
                activeSrc = canvas.toDataURL("image/png");
            } catch (_) {}
        }
        showFullscreenPreview([activeSrc], ev.shiftKey, state?.pid); 
    };

    mediaEl.onerror = () => {
        mediaEl.onerror = null;
        if ((src && src.startsWith("blob:")) || is3D || isAudio) return;

        const cardId = cardObj.element?.id || "";

        // 1. If an intermediate output item is missing, remove only this item
        if (cardId.startsWith("card-submenu-")) {
            const parentState = store.getPrompt(state.pid);
            if (parentState && parentState.nodeOutputs) {
                if (state.nodeId && parentState.nodeOutputs[state.nodeId]) {
                    delete parentState.nodeOutputs[state.nodeId];
                } else {
                    removeImageFromNodeOutputs(parentState.nodeOutputs, img);
                }
                store.updatePrompt(parentState.pid, parentState);
            }
            cardObj.element?.remove();
            const remaining = store.ui.cardStack?.querySelectorAll('.comfy-sidebar-card');
            if (!remaining || remaining.length === 0) {
                store.closeSubmenu();
            }
            return;
        }

        // 2. If a batch item is missing, remove only this item from the batch
        if (cardId.startsWith("card-batch-")) {
            const parentPid = state.parentPromptId || state.pid;
            const parentState = store.getPrompt(parentPid);
            if (parentState) {
                if (Array.isArray(parentState.images)) {
                    const idx = parentState.images.findIndex(i => i.filename === img.filename && (i.subfolder || "") === (img.subfolder || ""));
                    if (idx > -1) parentState.images.splice(idx, 1);
                }
                if (parentState.nodeOutputs) {
                    removeImageFromNodeOutputs(parentState.nodeOutputs, img);
                }
                store.updatePrompt(parentPid, parentState);
            }
            cardObj.element?.remove();
            const remaining = store.ui.cardStack?.querySelectorAll('.comfy-sidebar-card');
            if (!remaining || remaining.length === 0) {
                store.closeSubmenu();
            }
            return;
        }

        // 3. Main card: if this file is gone, clean it up
        const liveState = store.getPrompt(state.pid);
        if (liveState) {
            if (Array.isArray(liveState.images)) {
                liveState.images = liveState.images.filter(i => 
                    !(i.filename === img.filename && (i.subfolder || "") === (img.subfolder || ""))
                );
            }
            if (liveState.nodeOutputs) {
                removeImageFromNodeOutputs(liveState.nodeOutputs, img);
            }

            // If the card still has other images (e.g. from a batch), persist and switch to next image
            if (liveState.images && liveState.images.length > 0) {
                cardObj.currentImageIndex = 0;
                cardObj.lastImagesSignature = "";
                store.updatePrompt(liveState.pid, liveState);
                return;
            }

            // If the card has text outputs or is still in progress, persist
            if ((liveState.texts && liveState.texts.length > 0) || (liveState.status && liveState.status !== PromptStatus.COMPLETED)) {
                cardObj.lastImagesSignature = "";
                store.updatePrompt(liveState.pid, liveState);
                return;
            }

            // Only delete the main card when all items belonging to it are gone
            store.deletePrompt(liveState.pid);
            cardObj.element?.remove();
            return;
        }

        renderGenericFileCardPreview(cardObj, wrapper, src, img, state);
    };

    const applyDimensions = (width, height) => {
        if (cardObj.dimEl && width && height) {
            // Don't show the dimension badge for active/running preview frames
            if (state.status === "active") {
                cardObj.dimEl.style.display = "none";
                return;
            }
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
                renderCardImages(cardObj, state, onNavigateBatch);
            };

            const label = document.createElement("span");
            label.className = "comfy-sidebar-batch-label";
            label.textContent = `${idx + 1}/${state.images.length}`;
            label.style.cursor = "pointer";
            label.title = "View all images in this batch";
            
            label.onclick = (ev) => {
                ev.stopPropagation();
                if (typeof onNavigateBatch === "function") {
                    onNavigateBatch(state);
                }
            };

            const nextBtn = document.createElement("span");
            nextBtn.className = "pi pi-chevron-right";
            nextBtn.style.cursor = "pointer";
            nextBtn.onclick = (ev) => {
                ev.stopPropagation();
                cardObj.currentImageIndex = (cardObj.currentImageIndex + 1) % state.images.length;
                renderCardImages(cardObj, state, onNavigateBatch);
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
