import { State } from "./state.js";
import { isVideoFormat } from "./utils.js";

let activeComparisonViewer = null;
let videoSyncActive = false;
let syncAnimationFrameId = null;

// Track the global keydown reference across instances defensively
let globalKeydownHandler = null;

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
        objectFit: "contain", pointerEvents: "none"
    });
    el.src = isVideo ? src + "#t=0.001" : src;
    return el;
};

const setupVideoPlayback = (vid, container) => {
    if (!vid) return;

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
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
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

    videoSyncActive = true;
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
        window.removeEventListener("mousemove", handleWindowMove);
        window.removeEventListener("touchmove", handleWindowMove);
        window.removeEventListener("mouseup", handleWindowUp);
        window.removeEventListener("touchend", handleWindowUp);
        vid.removeEventListener("loadedmetadata", onMetaLoaded);
        controlBar.remove();
    };
};

function createComparisonViewer(baseSrc) {
    // DEFENSIVE CHECK: Force-remove any globally orphaned keydown handlers before binding a new one
    if (globalKeydownHandler) {
        document.removeEventListener("keydown", globalKeydownHandler);
        globalKeydownHandler = null;
    }

    const isBaseVideo = isVideoFormat(baseSrc);
    const canvasEl = document.querySelector("#graph-canvas, canvas");
    const targetContainer = canvasEl ? canvasEl.parentNode : document.body;

    if (targetContainer && targetContainer !== document.body) {
        targetContainer.style.position = "relative";
    }

    const container = document.createElement("div");
    container.className = "comfy-sidebar-comparison-overlay";
    Object.assign(container.style, {
        position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
        background: "rgba(10, 10, 10, 0.95)", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        zIndex: "10", 
        pointerEvents: "auto", userSelect: "none", "-webkit-user-select": "none"
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
        position: "absolute", top: "16px", display: "flex", gap: "16px",
        zIndex: "30", color: "#aaa", fontSize: "12px", fontFamily: "sans-serif",
        pointerEvents: "none"
    });
    const infoText = document.createElement("span");
    infoText.textContent = isBaseVideo 
        ? "Video playback. Press Esc to close." 
        : "Reference loaded. Click another card image in the sidebar to compare.";
    header.appendChild(infoText);
    container.appendChild(header);

    const closeBtn = document.createElement("span");
    closeBtn.className = "pi pi-times";
    closeBtn.title = "Close Comparison (Esc)";
    Object.assign(closeBtn.style, {
        position: "absolute", top: "16px", right: "24px", zIndex: "30",
        cursor: "pointer", fontSize: "20px", color: "#aaa", transition: "color 0.15s ease"
    });
    closeBtn.onmouseenter = () => closeBtn.style.color = "#fff";
    closeBtn.onmouseleave = () => closeBtn.style.color = "#aaa";
    container.appendChild(closeBtn);

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
        position: "relative", display: "grid", placeItems: "center",
        maxWidth: "85%", maxHeight: "85%"
    });
    container.appendChild(wrapper);

    container.onclick = (e) => {
        if (e.target === container) {
            destroy();
        }
    };

    let mediaA = createMediaElement(baseSrc, false);
    wrapper.appendChild(mediaA);

    let mediaB = null;

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
    let isDragging = false;
    let destroyVideoPlaybackFn = null;

    const updateSliderPosition = (percent) => {
        splitRatio = Math.max(0, Math.min(100, percent));
        slider.style.left = `${splitRatio}%`;
        if (mediaB) {
            mediaB.style.clipPath = `polygon(${splitRatio}% 0, 100% 0, 100% 100%, ${splitRatio}% 100%)`;
        }
    };

    const startDrag = (e) => { 
        e.preventDefault(); 
        e.stopPropagation();
        isDragging = true; 
        
        const rect = wrapper.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const percent = ((clientX - rect.left) / rect.width) * 100;
        updateSliderPosition(percent);
    };
    const doDrag = (e) => {
        if (!isDragging) return;
        const rect = wrapper.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const percent = ((clientX - rect.left) / rect.width) * 100;
        updateSliderPosition(percent);
    };
    const endDrag = () => { isDragging = false; };

    wrapper.addEventListener("mousedown", startDrag);
    wrapper.addEventListener("touchstart", startDrag);
    
    window.addEventListener("mousemove", doDrag);
    window.addEventListener("touchmove", doDrag);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchend", endDrag);

    const destroy = () => {
        window.removeEventListener("mousemove", doDrag);
        window.removeEventListener("touchmove", doDrag);
        window.removeEventListener("mouseup", endDrag);
        window.removeEventListener("touchend", endDrag);
        
        if (globalKeydownHandler) {
            document.removeEventListener("keydown", globalKeydownHandler);
            globalKeydownHandler = null;
        }
        
        videoSyncActive = false;
        if (syncAnimationFrameId) cancelAnimationFrame(syncAnimationFrameId);
        if (destroyVideoPlaybackFn) destroyVideoPlaybackFn();

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
    
    // Assign to our module-scoped tracker and register
    globalKeydownHandler = handleKeys;
    document.addEventListener("keydown", globalKeydownHandler);

    targetContainer.appendChild(container);

    if (isBaseVideo) {
        destroyVideoPlaybackFn = setupVideoPlayback(mediaA, container);
    }

    return {
        loadTarget(targetSrc) {
            const isTargetVideo = isVideoFormat(targetSrc);

            if (isBaseVideo) {
                destroy();
                showFullscreenPreview([targetSrc]);
                return;
            }

            if (isTargetVideo) {
                return;
            }

            if (mediaB) mediaB.remove();

            mediaB = createMediaElement(targetSrc, false);
            mediaB.style.pointerEvents = "none";
            wrapper.appendChild(mediaB);

            slider.style.display = "block";
            infoText.textContent = "Drag the slider to compare. Click other card images to update target | Esc to close.";
            updateSliderPosition(50);
        }
    };
}

export function showFullscreenPreview(imgSrcs) {
    if (!imgSrcs || imgSrcs.length === 0) return;
    
    if (activeComparisonViewer) {
        activeComparisonViewer.loadTarget(imgSrcs[0]);
        return;
    }

    activeComparisonViewer = createComparisonViewer(imgSrcs[0]);
}