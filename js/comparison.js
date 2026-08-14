import { isVideoFormat, is3DFormat, isAudioFormat, getFilenameFromUrl } from "./utils.js";
import { State } from "./state.js";
import { create3DViewer } from "./viewer3d.js";
import { createTextReader } from "./text_reader.js";
import { stopAllAudioPlayback } from "./ui.js";

let activeComparisonViewer = null;
let globalKeydownHandler = null;

export function isAudioViewerOpen() {
    return !!(activeComparisonViewer && activeComparisonViewer.isAudio);
}

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

function createAudioViewer(baseSrc, onSwitchMedia = () => {}, onDestroy = () => {}) {
    if (globalKeydownHandler) {
        document.removeEventListener("keydown", globalKeydownHandler);
        globalKeydownHandler = null;
    }

    const container = document.createElement("div");
    container.className = "comfy-sidebar-comparison-overlay";
    Object.assign(container.style, {
        position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh",
        background: "rgba(10, 10, 10, 0.95)", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", zIndex: "1000",
        boxSizing: "border-box", overflow: "hidden", pointerEvents: "auto", userSelect: "none"
    });

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

    const playerBox = document.createElement("div");
    Object.assign(playerBox.style, {
        background: "linear-gradient(135deg, #1e1333 0%, #0f172a 100%)",
        border: "1px solid rgba(255,255,255,0.15)", borderRadius: "12px",
        padding: "24px 28px", width: "90%", maxWidth: "520px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.7)", display: "flex",
        flexDirection: "column", gap: "16px", zIndex: "20"
    });

    const parsedFilename = getFilenameFromUrl(baseSrc) || "audio.wav";
    const parsedExt = (parsedFilename.split(".").pop() || "AUDIO").toUpperCase();

    const titleRow = document.createElement("div");
    Object.assign(titleRow.style, { display: "flex", alignItems: "center", justifyContent: "space-between" });
    const title = document.createElement("span");
    title.textContent = parsedFilename;
    Object.assign(title.style, { fontSize: "14px", fontWeight: "bold", color: "#f1f5f9", fontFamily: "monospace", maxWidth: "75%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    const badge = document.createElement("span");
    badge.className = "comfy-sidebar-audio-badge";
    badge.style.position = "static";
    badge.textContent = parsedExt;
    titleRow.append(title, badge);

    // Waveform visualization
    const soundwave = document.createElement("div");
    soundwave.className = "comfy-sidebar-soundwave-container";
    soundwave.style.height = "56px";
    const barHeights = [14, 22, 38, 28, 48, 36, 20, 42, 54, 32, 18, 40, 50, 30, 22, 36, 48, 24, 18, 34, 46, 26, 16];
    barHeights.forEach((h, i) => {
        const bar = document.createElement("div");
        bar.className = "comfy-sidebar-soundwave-bar";
        bar.style.height = `${h}px`;
        bar.style.width = "4px";
        bar.style.animationDelay = `${(i * 0.06).toFixed(2)}s`;
        soundwave.appendChild(bar);
    });

    // Scrubber
    const scrubberContainer = document.createElement("div");
    Object.assign(scrubberContainer.style, {
        width: "100%", height: "6px", background: "#334155", borderRadius: "3px",
        position: "relative", cursor: "pointer"
    });
    const scrubberFill = document.createElement("div");
    Object.assign(scrubberFill.style, {
        width: "0%", height: "100%", background: "#c084fc", borderRadius: "3px"
    });
    scrubberContainer.appendChild(scrubberFill);

    // Controls Row
    const controlsRow = document.createElement("div");
    Object.assign(controlsRow.style, { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" });

    const leftControls = document.createElement("div");
    Object.assign(leftControls.style, { display: "flex", alignItems: "center", gap: "10px" });

    // Play & Stop SVGs
    const playIconSvg = `<svg viewBox="0 0 24 24" width="14" height="14" style="margin-left: 2px; pointer-events: none;"><polygon points="6,4 20,12 6,20" fill="#ffffff"/></svg>`;
    const stopIconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" style="pointer-events: none;"><rect x="5" y="5" width="14" height="14" rx="2" fill="#ffffff"/></svg>`;

    const playBtn = document.createElement("button");
    Object.assign(playBtn.style, {
        width: "36px", height: "36px", borderRadius: "50%", background: "#a855f7",
        border: "none", color: "#fff", cursor: "pointer", display: "flex",
        alignItems: "center", justifyContent: "center", fontSize: "14px"
    });
    playBtn.innerHTML = playIconSvg;

    const timeLabel = document.createElement("span");
    Object.assign(timeLabel.style, { fontSize: "11px", fontFamily: "monospace", color: "#94a3b8" });
    timeLabel.textContent = "0:00 / 0:00";

    leftControls.append(playBtn, timeLabel);

    const rightControls = document.createElement("div");
    Object.assign(rightControls.style, { display: "flex", alignItems: "center", gap: "8px" });

    const loopBtn = document.createElement("button");
    Object.assign(loopBtn.style, {
        background: "transparent", border: "1px solid #444", color: "#aaa",
        borderRadius: "4px", padding: "4px 8px", fontSize: "11px", cursor: "pointer"
    });
    loopBtn.innerHTML = `<i class="pi pi-replay"></i>`;
    loopBtn.title = "Toggle Loop";

    const speedSelect = document.createElement("select");
    Object.assign(speedSelect.style, {
        background: "#1e293b", border: "1px solid #444", color: "#eee",
        borderRadius: "4px", padding: "2px 4px", fontSize: "11px", outline: "none"
    });
    ["0.5x", "1.0x", "1.5x", "2.0x"].forEach(spd => {
        const opt = document.createElement("option");
        opt.value = spd.replace("x", "");
        opt.textContent = spd;
        if (spd === "1.0x") opt.selected = true;
        speedSelect.appendChild(opt);
    });

    rightControls.append(loopBtn, speedSelect);
    controlsRow.append(leftControls, rightControls);

    playerBox.append(titleRow, soundwave, scrubberContainer, controlsRow);
    container.appendChild(playerBox);

    const audioEl = document.createElement("audio");
    audioEl.src = baseSrc;
    audioEl.preload = "metadata";
    container.appendChild(audioEl);

    const formatTime = (t) => {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

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
        playBtn.innerHTML = playIconSvg;
        playerBox.classList.remove("playing");
        scrubberFill.style.width = "0%";
    };

    const togglePlay = () => {
        if (audioEl.paused) {
            stopAllAudioPlayback();
            audioEl.play().catch(()=>{});
            playBtn.innerHTML = stopIconSvg;
            playerBox.classList.add("playing");
        } else {
            audioEl.pause();
            audioEl.currentTime = 0;
            playBtn.innerHTML = playIconSvg;
            playerBox.classList.remove("playing");
            scrubberFill.style.width = "0%";
            timeLabel.textContent = `0:00 / ${formatTime(audioEl.duration || 0)}`;
        }
    };

    playBtn.onclick = togglePlay;

    loopBtn.onclick = () => {
        audioEl.loop = !audioEl.loop;
        loopBtn.style.borderColor = audioEl.loop ? "#a855f7" : "#444";
        loopBtn.style.color = audioEl.loop ? "#c084fc" : "#aaa";
    };

    speedSelect.onchange = (e) => {
        audioEl.playbackRate = Number(e.target.value);
    };

    scrubberContainer.onclick = (e) => {
        const rect = scrubberContainer.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        if (audioEl.duration > 0) {
            audioEl.currentTime = pos * audioEl.duration;
        }
    };

    const destroy = () => {
        window.removeEventListener("resize", updateOverlayBounds);
        if (globalKeydownHandler) {
            document.removeEventListener("keydown", globalKeydownHandler);
            globalKeydownHandler = null;
        }
        audioEl.pause();
        audioEl.src = "";
        container.remove();
        onDestroy();
    };

    closeBtn.onclick = destroy;
    container.onclick = (e) => {
        if (e.target === container) destroy();
    };

    const handleKeys = (e) => {
        if (e.key === "Escape") destroy();
        if (e.key === " ") {
            e.preventDefault();
            togglePlay();
        }
    };
    globalKeydownHandler = handleKeys;
    document.addEventListener("keydown", globalKeydownHandler);

    document.body.appendChild(container);
    audioEl.play().then(() => {
        playBtn.innerHTML = stopIconSvg;
        playerBox.classList.add("playing");
    }).catch(()=>{});

    return {
        isAudio: true,
        loadTarget(targetSrc) {
            if (!isAudioFormat(targetSrc)) {
                destroy();
                onSwitchMedia(targetSrc);
                return;
            }
            const newFilename = getFilenameFromUrl(targetSrc) || "audio.wav";
            title.textContent = newFilename;
            badge.textContent = (newFilename.split(".").pop() || "AUDIO").toUpperCase();
            audioEl.src = targetSrc;
            audioEl.play().then(() => {
                playBtn.innerHTML = stopIconSvg;
                playerBox.classList.add("playing");
            }).catch(()=>{});
        },
        destroy
    };
}

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

function createComparisonViewer(baseSrc, onDestroy = () => {}) {
    if (globalKeydownHandler) {
        document.removeEventListener("keydown", globalKeydownHandler);
        globalKeydownHandler = null;
    }

    const isBaseVideo = isVideoFormat(baseSrc);

    const container = document.createElement("div");
    container.className = "comfy-sidebar-comparison-overlay";
    Object.assign(container.style, {
        position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh",
        background: "rgba(10, 10, 10, 0.95)", display: "flex", flexDirection: "column",
        zIndex: "1000", boxSizing: "border-box", overflow: "hidden",
        pointerEvents: "auto", userSelect: "none", "-webkit-user-select": "none"
    });

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

    const syncImageScales = () => {
        if (!mediaA) return;

        const wA = mediaA.naturalWidth || mediaA.videoWidth || 0;
        const hA = mediaA.naturalHeight || mediaA.videoHeight || 0;

        if (!mediaB) {
            slider.style.display = "none";
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

        slider.style.display = "block";
        infoText.style.color = "#aaa";
        infoText.textContent = "Drag slider to compare. Click image to zoom (100%/Fit) | Shift+Click another card | Esc to close.";
        updateSliderPosition(50);

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

    wrapper.addEventListener("click", (e) => {
        if (dragMoved || isBaseVideo) return;
        toggleZoom();
    });

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
        onDestroy();
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
        is3D: false,
        isAudio: false,
        isText: false,
        loadTarget(targetSrc, isShiftClick) {
            const isTargetVideo = isVideoFormat(targetSrc);
            const isTarget3D = is3DFormat(targetSrc);
            const isTargetAudio = isAudioFormat(targetSrc);
            const isTargetText = typeof targetSrc === "object" && targetSrc.text;

            if (isBaseVideo || isTargetVideo || isTarget3D || isTargetAudio || isTargetText) {
                destroy();
                showFullscreenPreview([targetSrc], isShiftClick);
                return;
            }

            if (isShiftClick) {
                if (mediaB) {
                    cleanupMedia(mediaB);
                    mediaB.remove();
                    mediaB = null;
                }

                mediaB = createMediaElement(targetSrc, false);
                mediaB.style.pointerEvents = "none";
                mediaB.onload = () => {
                    syncImageScales();
                };
                wrapper.appendChild(mediaB);
                if (mediaB.complete && mediaB.naturalWidth) {
                    syncImageScales();
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
        },
        destroy
    };
}

export function showFullscreenPreview(imgSrcs, isShiftClick = false) {
    if (!imgSrcs || imgSrcs.length === 0) return;

    const item = imgSrcs[0];

    // Handle Text Output
    if (typeof item === "object" && item.text) {
        if (activeComparisonViewer) {
            if (activeComparisonViewer.isText) {
                activeComparisonViewer.loadTarget(item);
                return;
            }
            activeComparisonViewer.destroy();
            activeComparisonViewer = null;
        }
        activeComparisonViewer = createTextReader(
            item, 
            (target) => showFullscreenPreview([target]), 
            () => { activeComparisonViewer = null; }
        );
        return;
    }

    const src = typeof item === "string" ? item : (item.url || item.filename || "");

    // Delegate 3D formats
    if (is3DFormat(src)) {
        if (activeComparisonViewer) {
            if (activeComparisonViewer.is3D) {
                activeComparisonViewer.loadTarget(src);
                return;
            }
            activeComparisonViewer.destroy();
            activeComparisonViewer = null;
        }
        activeComparisonViewer = create3DViewer(
            src, 
            (targetSrc) => showFullscreenPreview([targetSrc]), 
            () => { activeComparisonViewer = null; }
        );
        return;
    }

    // Delegate Audio formats
    if (isAudioFormat(src)) {
        if (activeComparisonViewer) {
            if (activeComparisonViewer.isAudio) {
                activeComparisonViewer.loadTarget(src);
                return;
            }
            activeComparisonViewer.destroy();
            activeComparisonViewer = null;
        }
        activeComparisonViewer = createAudioViewer(
            src, 
            (targetSrc) => showFullscreenPreview([targetSrc]), 
            () => { activeComparisonViewer = null; }
        );
        return;
    }
    
    // Delegate 2D/Video formats
    if (activeComparisonViewer) {
        if (activeComparisonViewer.is3D || activeComparisonViewer.isAudio || activeComparisonViewer.isText) {
            activeComparisonViewer.destroy();
            activeComparisonViewer = null;
        } else {
            activeComparisonViewer.loadTarget(src, isShiftClick);
            return;
        }
    }

    activeComparisonViewer = createComparisonViewer(
        src, 
        () => { activeComparisonViewer = null; }
    );
}