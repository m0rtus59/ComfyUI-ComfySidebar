import { isVideoFormat, is3DFormat } from "./utils.js";
import { app } from "/scripts/app.js";
import { State } from "./state.js";

let activeComparisonViewer = null;
let globalKeydownHandler = null;

// Safe clientX resolver for mouse and touch events
const getClientX = (e) => {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientX;
    return e.clientX || 0;
};

const getClientY = (e) => {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientY;
    return e.clientY || 0;
};

const createMediaElement = (src, muted = false) => {
    const isVideo = isVideoFormat(src);
    const el = isVideo ? document.createElement("video") : document.createElement("img");
    if (isVideo) {
        el.muted = muted;
        el.playsInline = true;
        el.autoplay = true;
        el.loop = true;
        el.controls = false; 
    }
    Object.assign(el.style, {
        gridArea: "1 / 1", maxWidth: "100%", maxHeight: "80vh",
        width: "auto", height: "auto", objectFit: "contain",
        pointerEvents: "none", userSelect: "none", webkitUserSelect: "none"
    });
    el.src = isVideo ? src + "#t=0.001" : src;
    return el;
};

const setupVideoPlayback = (vid, container) => {
    if (!vid) return () => {};

    let videoSyncActive = true;
    let syncAnimationFrameId = null;

    const onMetaLoaded = () => {
        vid.play().catch(()=>{});
    };
    vid.addEventListener("loadedmetadata", onMetaLoaded);
    if (vid.readyState >= 1) onMetaLoaded();

    const controlBar = document.createElement("div");
    Object.assign(controlBar.style, {
        position: "absolute", bottom: "16px", left: "50%",
        display: "flex", alignItems: "center", gap: "12px", background: "rgba(10,10,10,0.85)",
        padding: "8px 16px", borderRadius: "8px", zIndex: "40", fontSize: "11px",
        fontFamily: "monospace", color: "#eee", width: "80%", maxWidth: "500px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.5)", transform: "translate3d(-50%, 0, 0)",
        pointerEvents: "auto"
    });

    const playBtn = document.createElement("span");
    playBtn.className = vid.paused ? "pi pi-play" : "pi pi-pause";
    playBtn.style.cursor = "pointer";
    playBtn.style.fontSize = "14px";
    playBtn.onclick = (e) => {
        e.stopPropagation();
        if (vid.paused) {
            vid.play().catch(()=>{});
            playBtn.className = "pi pi-pause";
        } else {
            vid.pause();
            playBtn.className = "pi pi-play";
        }
    };

    const scrubberContainer = document.createElement("div");
    Object.assign(scrubberContainer.style, {
        flex: "1", height: "4px", background: "#444", borderRadius: "2px",
        position: "relative", cursor: "pointer"
    });
    const scrubberFill = document.createElement("div");
    Object.assign(scrubberFill.style, {
        width: "0%", height: "100%", background: "#3b82f6", borderRadius: "2px"
    });
    scrubberContainer.appendChild(scrubberFill);

    const timeLabel = document.createElement("span");
    timeLabel.textContent = "0:00 / 0:00";

    const scrub = (e) => {
        const rect = scrubberContainer.getBoundingClientRect();
        const clientX = getClientX(e);
        const percent = Math.max(0, Math.min(100, (clientX - rect.left) / rect.width));
        const duration = vid.duration || 0;
        if (duration > 0) {
            vid.currentTime = (percent / 100) * duration;
            scrubberFill.style.width = `${percent}%`;
        }
    };

    let isScrubbing = false;
    scrubberContainer.onmousedown = (e) => { e.stopPropagation(); isScrubbing = true; scrub(e); };
    scrubberContainer.ontouchstart = (e) => { e.stopPropagation(); isScrubbing = true; scrub(e); };

    const handleWindowMove = (e) => { if (isScrubbing) scrub(e); };
    const handleWindowUp = () => { isScrubbing = false; };
    window.addEventListener("mousemove", handleWindowMove);
    window.addEventListener("touchmove", handleWindowMove);
    window.addEventListener("mouseup", handleWindowUp);
    window.addEventListener("touchend", handleWindowUp);

    controlBar.append(playBtn, scrubberContainer, timeLabel);
    container.appendChild(controlBar);

    const syncLoop = () => {
        if (!videoSyncActive) return;

        const cur = vid.currentTime || 0;
        const dur = vid.duration || 0;
        if (dur > 0) {
            scrubberFill.style.width = `${(cur / dur) * 100}%`;
            const formatTime = (t) => {
                const m = Math.floor(t / 60);
                const s = Math.floor(t % 60);
                return `${m}:${s < 10 ? '0' : ''}${s}`;
            };
            timeLabel.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
        }

        playBtn.className = vid.paused ? "pi pi-play" : "pi pi-pause";
        syncAnimationFrameId = requestAnimationFrame(syncLoop);
    };
    requestAnimationFrame(syncLoop);

    return () => {
        videoSyncActive = false;
        if (syncAnimationFrameId) cancelAnimationFrame(syncAnimationFrameId);
        window.removeEventListener("mousemove", handleWindowMove);
        window.removeEventListener("touchmove", handleWindowMove);
        window.removeEventListener("mouseup", handleWindowUp);
        window.removeEventListener("touchend", handleWindowUp);
        vid.removeEventListener("loadedmetadata", onMetaLoaded);
        controlBar.remove();
    };
};

function createComparisonViewer(baseSrc) {
    if (globalKeydownHandler) {
        document.removeEventListener("keydown", globalKeydownHandler);
        globalKeydownHandler = null;
    }

    const isBaseVideo = isVideoFormat(baseSrc);

    // Root overlay fixed to the screen
    const container = document.createElement("div");
    container.className = "comfy-sidebar-comparison-overlay";
    Object.assign(container.style, {
        position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh",
        background: "rgba(10, 10, 10, 0.95)", display: "flex", flexDirection: "column",
        zIndex: "1000", boxSizing: "border-box", overflow: "hidden",
        pointerEvents: "auto", userSelect: "none", "-webkit-user-select": "none"
    });

    // Dynamic bounds updater: perfectly shifts the overlay outside the active sidebar
    const updateOverlayBounds = () => {
        const sidebarEl = State.sidebarContainer?.closest('.comfyui-sidebar, .comfy-sidebar, .p-sidebar, [class*="sidebar"]') || State.sidebarContainer;
        
        if (sidebarEl && sidebarEl.offsetWidth > 0 && sidebarEl.isConnected) {
            const rect = sidebarEl.getBoundingClientRect();
            if (rect.left < window.innerWidth / 2) {
                const leftOffset = Math.max(0, rect.right);
                container.style.left = `${leftOffset}px`;
                container.style.width = `calc(100vw - ${leftOffset}px)`;
                container.style.right = "0px";
            } else {
                const rightOffset = Math.max(0, window.innerWidth - rect.left);
                container.style.left = "0px";
                container.style.width = `calc(100vw - ${rightOffset}px)`;
                container.style.right = `${rightOffset}px`;
            }
            container.style.top = `${Math.max(0, rect.top)}px`;
            container.style.height = `calc(100vh - ${Math.max(0, rect.top)}px)`;
        } else {
            container.style.left = "0px";
            container.style.width = "100vw";
            container.style.top = "0px";
            container.style.height = "100vh";
        }
    };

    updateOverlayBounds();
    window.addEventListener("resize", updateOverlayBounds);

    let resizeObserver = null;
    const sidebarEl = State.sidebarContainer?.closest('.comfyui-sidebar, .comfy-sidebar, .p-sidebar, [class*="sidebar"]') || State.sidebarContainer;
    if (sidebarEl && window.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => updateOverlayBounds());
        resizeObserver.observe(sidebarEl);
    }

    // Scrollable viewport container: allows 100% zoom navigation without moving fixed controls
    const scrollContainer = document.createElement("div");
    Object.assign(scrollContainer.style, {
        position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
        display: "flex", overflow: "auto", boxSizing: "border-box",
        padding: "54px 28px 48px 28px", scrollbarWidth: "thin",
        scrollbarColor: "#555 rgba(0, 0, 0, 0.3)", zIndex: "15"
    });
    container.appendChild(scrollContainer);

    const header = document.createElement("div");
    Object.assign(header.style, {
        position: "absolute", top: "16px", left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: "16px", zIndex: "30", color: "#aaa", fontSize: "12px",
        fontFamily: "sans-serif", pointerEvents: "none", background: "rgba(10,10,10,0.75)",
        padding: "4px 10px", borderRadius: "4px", backdropFilter: "blur(4px)",
        boxShadow: "0 2px 6px rgba(0,0,0,0.4)", maxWidth: "85%", textAlign: "center"
    });
    const infoText = document.createElement("span");
    infoText.textContent = isBaseVideo 
        ? "Video playback. Press Esc to close." 
        : "Click image to zoom (100%/Fit) | Shift+Click another card to compare.";
    header.appendChild(infoText);
    container.appendChild(header);

    const closeBtn = document.createElement("span");
    closeBtn.className = "pi pi-times";
    closeBtn.title = "Close (Esc)";
    Object.assign(closeBtn.style, {
        position: "absolute", top: "16px", right: "24px", zIndex: "30",
        cursor: "pointer", fontSize: "20px", color: "#aaa", transition: "color 0.15s ease",
        background: "rgba(10,10,10,0.6)", borderRadius: "50%", padding: "4px"
    });
    closeBtn.onmouseenter = () => closeBtn.style.color = "#fff";
    closeBtn.onmouseleave = () => closeBtn.style.color = "#aaa";
    container.appendChild(closeBtn);

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
        position: "relative", display: "grid", placeItems: "center",
        maxWidth: "85%", maxHeight: "85%", margin: "auto",
        flexShrink: "0", cursor: isBaseVideo ? "default" : "zoom-in"
    });
    scrollContainer.appendChild(wrapper);

    const hintPrompt = document.createElement("div");
    Object.assign(hintPrompt.style, {
        position: "absolute", bottom: "16px", left: "50%", transform: "translateX(-50%)",
        zIndex: "30", color: "#888", fontSize: "12px", fontFamily: "sans-serif",
        pointerEvents: "none", background: "rgba(10,10,10,0.75)", padding: "4px 10px",
        borderRadius: "4px", backdropFilter: "blur(4px)", boxShadow: "0 2px 6px rgba(0,0,0,0.4)"
    });
    hintPrompt.innerHTML = 'Tip: Hold <span style="color:#aaa;font-weight:bold;">Shift</span> while clicking sidebar cards to compare outputs side-by-side.';
    if (isBaseVideo) {
        hintPrompt.style.display = "none";
    }
    container.appendChild(hintPrompt);

    let mediaA = createMediaElement(baseSrc, false);
    wrapper.appendChild(mediaA);

    let mediaB = null;
    let isZoomed = false;

    const slider = document.createElement("div");
    Object.assign(slider.style, {
        position: "absolute", top: "0", bottom: "0", left: "50%",
        width: "2px", background: "#fff", cursor: "ew-resize",
        zIndex: "25", display: "none", pointerEvents: "auto",
        boxShadow: "0 0 8px rgba(0,0,0,0.5)"
    });
    const sliderButton = document.createElement("div");
    Object.assign(sliderButton.style, {
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)", width: "32px", height: "32px",
        borderRadius: "50%", background: "#fff", color: "#333",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 2px 6px rgba(0,0,0,0.4)", pointerEvents: "auto",
        userSelect: "none", webkitUserSelect: "none"
    });
    sliderButton.innerHTML = `<span class="pi pi-arrows-h" style="font-size: 12px;"></span>`;
    slider.appendChild(sliderButton);
    wrapper.appendChild(slider);

    let splitRatio = 50; 
    let destroyVideoPlaybackFn = null;

    const updateSliderPosition = (percent) => {
        splitRatio = Math.max(0, Math.min(100, percent));
        slider.style.left = `${splitRatio}%`;
        if (mediaB) {
            mediaB.style.clipPath = `polygon(${splitRatio}% 0, 100% 0, 100% 100%, ${splitRatio}% 100%)`;
        }
    };

    // Synchronize dimensions, aspect ratios, and upscaler scaling
    const syncImageScales = () => {
        if (!mediaA) return;

        const wA = mediaA.naturalWidth || mediaA.videoWidth || 0;
        const hA = mediaA.naturalHeight || mediaA.videoHeight || 0;

        if (!mediaB) {
            // Single image mode
            if (isZoomed && wA && hA) {
                wrapper.style.maxWidth = "none";
                wrapper.style.maxHeight = "none";
                wrapper.style.width = `${wA}px`;
                wrapper.style.height = `${hA}px`;
                wrapper.style.cursor = "zoom-out";

                mediaA.style.maxWidth = "none";
                mediaA.style.maxHeight = "none";
                mediaA.style.width = "100%";
                mediaA.style.height = "100%";
                mediaA.style.objectFit = "fill";
            } else {
                wrapper.style.maxWidth = "85%";
                wrapper.style.maxHeight = "85%";
                wrapper.style.width = "auto";
                wrapper.style.height = "auto";
                wrapper.style.cursor = isBaseVideo ? "default" : "zoom-in";

                mediaA.style.maxWidth = "100%";
                mediaA.style.maxHeight = "80vh";
                mediaA.style.width = "auto";
                mediaA.style.height = "auto";
                mediaA.style.objectFit = "contain";
            }
            return;
        }

        const wB = mediaB.naturalWidth || mediaB.videoWidth || 0;
        const hB = mediaB.naturalHeight || mediaB.videoHeight || 0;

        if (!wA || !hA || !wB || !hB) return;

        // Aspect ratio verification (5% tolerance)
        const arA = wA / hA;
        const arB = wB / hB;
        const arDiff = Math.abs(arA - arB) / Math.max(arA, arB);

        if (arDiff > 0.05) {
            infoText.textContent = `Aspect ratio mismatch (${wA}x${hA} vs ${wB}x${hB}). Images must have matching proportions to compare.`;
            infoText.style.color = "#f87171";
            setTimeout(() => {
                if (infoText) {
                    infoText.style.color = "#aaa";
                    infoText.textContent = "Click image to zoom (100%/Fit) | Shift+Click another card to compare.";
                }
            }, 3500);

            cleanupMedia(mediaB);
            mediaB.remove();
            mediaB = null;
            slider.style.display = "none";
            syncImageScales();
            return;
        }

        // Proportions match: stretch to the larger image size for perfect upscaler comparison
        const maxW = Math.max(wA, wB);
        const maxH = Math.max(hA, hB);

        if (isZoomed) {
            wrapper.style.maxWidth = "none";
            wrapper.style.maxHeight = "none";
            wrapper.style.width = `${maxW}px`;
            wrapper.style.height = `${maxH}px`;
            wrapper.style.cursor = "zoom-out";

            [mediaA, mediaB].forEach(el => {
                if (el) {
                    el.style.maxWidth = "none";
                    el.style.maxHeight = "none";
                    el.style.width = "100%";
                    el.style.height = "100%";
                    el.style.objectFit = "fill";
                }
            });
        } else {
            wrapper.style.maxWidth = "85%";
            wrapper.style.maxHeight = "85%";
            wrapper.style.width = "auto";
            wrapper.style.height = "auto";
            wrapper.style.aspectRatio = `${maxW} / ${maxH}`;
            wrapper.style.cursor = "zoom-in";

            [mediaA, mediaB].forEach(el => {
                if (el) {
                    el.style.maxWidth = "100%";
                    el.style.maxHeight = "80vh";
                    el.style.width = "100%";
                    el.style.height = "100%";
                    el.style.objectFit = "fill";
                    el.style.aspectRatio = `${maxW} / ${maxH}`;
                }
            });
        }
    };

    mediaA.onload = syncImageScales;
    if (mediaA.complete) syncImageScales();

    const toggleZoom = () => {
        if (isBaseVideo) return;
        isZoomed = !isZoomed;
        syncImageScales();
        if (!isZoomed) {
            scrollContainer.scrollTop = 0;
            scrollContainer.scrollLeft = 0;
        }
    };

    // Clean drag & click arbitration
    let isDraggingSlider = false;
    let dragMoved = false;
    let dragStartX = 0;
    let dragStartY = 0;

    const startDrag = (e) => { 
        if (e.button && e.button !== 0) return;
        dragStartX = getClientX(e);
        dragStartY = getClientY(e);
        dragMoved = false;
        isDraggingSlider = true;
    };

    const doDrag = (e) => {
        if (!isDraggingSlider) return;
        const clientX = getClientX(e);
        const clientY = getClientY(e);
        
        if (!dragMoved && (Math.abs(clientX - dragStartX) > 4 || Math.abs(clientY - dragStartY) > 4)) {
            dragMoved = true;
        }

        if (dragMoved && mediaB) {
            const rect = wrapper.getBoundingClientRect();
            const percent = ((clientX - rect.left) / rect.width) * 100;
            updateSliderPosition(percent);
        }
    };

    const endDrag = () => { 
        if (!isDraggingSlider) return;
        isDraggingSlider = false;
        if (dragMoved) {
            setTimeout(() => { dragMoved = false; }, 50);
        }
    };

    wrapper.addEventListener("mousedown", startDrag);
    wrapper.addEventListener("touchstart", startDrag);
    
    window.addEventListener("mousemove", doDrag);
    window.addEventListener("touchmove", doDrag);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchend", endDrag);

    // Clicking image area toggles zoom
    wrapper.addEventListener("click", (e) => {
        if (dragMoved || isBaseVideo) return;
        toggleZoom();
    });

    // Clicking backdrop cleanly closes in 1 click
    scrollContainer.addEventListener("click", (e) => {
        if (dragMoved) return;
        if (e.target === scrollContainer || e.target === container) {
            destroy();
        }
    });

    const cleanupMedia = (el) => {
        if (el && el.tagName === "VIDEO") {
            el.pause();
            el.src = "";
            el.load();
        }
    };

    const destroy = () => {
        window.removeEventListener("resize", updateOverlayBounds);
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }

        window.removeEventListener("mousemove", doDrag);
        window.removeEventListener("touchmove", doDrag);
        window.removeEventListener("mouseup", endDrag);
        window.removeEventListener("touchend", endDrag);
        
        if (globalKeydownHandler) {
            document.removeEventListener("keydown", globalKeydownHandler);
            globalKeydownHandler = null;
        }
        
        if (destroyVideoPlaybackFn) destroyVideoPlaybackFn();

        cleanupMedia(mediaA);
        cleanupMedia(mediaB);

        container.remove();
        activeComparisonViewer = null;
    };

    closeBtn.onclick = destroy;

    const handleKeys = (e) => {
        if (e.key === "Escape") destroy();
        if (e.key === " " && mediaB) {
            e.preventDefault();
            updateSliderPosition(splitRatio > 50 ? 0 : 100);
        }
    };
    
    globalKeydownHandler = handleKeys;
    document.addEventListener("keydown", globalKeydownHandler);

    document.body.appendChild(container);

    if (isBaseVideo) {
        destroyVideoPlaybackFn = setupVideoPlayback(mediaA, container);
    }

    return {
        loadTarget(targetSrc, isShiftClick) {
            const isTargetVideo = isVideoFormat(targetSrc);

            if (isBaseVideo || isTargetVideo) {
                destroy();
                showFullscreenPreview([targetSrc], isShiftClick);
                return;
            }

            if (isShiftClick) {
                if (mediaB) {
                    cleanupMedia(mediaB);
                    mediaB.remove();
                }

                mediaB = createMediaElement(targetSrc, false);
                mediaB.style.pointerEvents = "none";
                mediaB.onload = () => {
                    syncImageScales();
                    slider.style.display = "block";
                    infoText.style.color = "#aaa";
                    infoText.textContent = "Drag slider to compare. Click image to zoom (100%/Fit) | Shift+Click another card | Esc to close.";
                    updateSliderPosition(50);
                };
                wrapper.appendChild(mediaB);
                if (mediaB.complete && mediaB.naturalWidth) {
                    mediaB.onload();
                }
            } else {
                if (mediaB) {
                    cleanupMedia(mediaB);
                    mediaB.remove();
                    mediaB = null;
                }
                slider.style.display = "none";
                mediaA.src = targetSrc;
                mediaA.onload = () => {
                    infoText.style.color = "#aaa";
                    infoText.textContent = "Click image to zoom (100%/Fit) | Shift+Click another card to compare.";
                    syncImageScales();
                };
            }
        }
    };
}

export function showFullscreenPreview(imgSrcs, isShiftClick = false) {
    if (!imgSrcs || imgSrcs.length === 0) return;

    const src = imgSrcs[0];

    // Handle 3D assets natively or by focusing 3D node
    if (is3DFormat(src)) {
        if (window.app?.ui?.show3DViewer) {
            window.app.ui.show3DViewer(src);
            return;
        }

        if (app.graph && app.canvas) {
            const nodes = app.graph._nodes || [];
            const node = nodes.find(n => 
                n.type?.includes("Preview3D") || n.type?.includes("Load3D") || 
                n.type?.includes("SaveGLB") || n.type?.includes("Save 3D")
            );
            if (node) {
                app.canvas.centerOnNode(node);
                app.canvas.selectNode(node);
            }
        }
        return;
    }
    
    if (activeComparisonViewer) {
        activeComparisonViewer.loadTarget(src, isShiftClick);
        return;
    }

    activeComparisonViewer = createComparisonViewer(src);
}