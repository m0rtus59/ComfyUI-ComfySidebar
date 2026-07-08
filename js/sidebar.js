import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// --- Global Drag & Search Payloads ---
let currentDraggedImgData = null;
let currentSearchQuery = "";
const promptStates = new Map();     
const cardElements = new Map();     

let globalOrderCounter = 0;
let sidebarContainer = null;
let cardStack = null;
let currentlyActivePromptId = null; // Track executing ID to fix node name display

// Inject native CSS to offload hover, borders, and theme variables to the browser's style engine
const style = document.createElement("style");
style.textContent = `
    .comfy-sidebar-card {
        background: var(--comfy-input-bg, #181818);
        border-radius: 4px;
        padding: 8px;
        position: relative;
        min-height: 80px;
        margin-bottom: 12px;
        break-inside: avoid;
        user-select: none;
        -webkit-user-select: none;
        transition: border-color 0.2s, background-color 0.2s;
        border: 2px solid var(--border-color, #333);
        color: var(--comfy-input-color, var(--fg-color, #eee));
    }
    .comfy-sidebar-card:hover {
        border-color: var(--p-primary-color, var(--primary-color, #555)) !important;
    }
    .comfy-sidebar-card.active { --border-color: #3b82f6; --hover-color: #60a5fa; }
    .comfy-sidebar-card.pending { --border-color: #6c757d; --hover-color: #adb5bd; }
    .comfy-sidebar-card.cancelled { --border-color: #ffc107; --hover-color: #ffe082; }
    .comfy-sidebar-card.error { --border-color: #dc3545; --hover-color: #f87171; }

    /* Red (X) Cancel action shows up only on card hover */
    .comfy-sidebar-card.pending .pi-times {
        display: none !important;
    }
    .comfy-sidebar-card.pending:hover .pi-times {
        display: flex !important;
    }

    /* Small timer style in the top-left corner of the card */
    .comfy-sidebar-card-timer {
        position: absolute;
        top: 6px;
        left: 8px;
        font-size: 10px;
        font-family: monospace;
        opacity: 0.7;
        background: rgba(0, 0, 0, 0.6);
        padding: 2px 4px;
        border-radius: 3px;
        pointer-events: none;
        z-index: 5;
        color: #fff;
    }
`;
document.head.appendChild(style);

// Helper to determine if a URL represents a video format
const isVideoFormat = (url) => {
    const s = url.toLowerCase();
    return s.includes(".mp4") || s.includes(".webm");
};

// Filters metadata inside the prompt structure
function matchesFilter(state, query) {
    if (!query) return true;
    const q = query.toLowerCase();

    // 1. Check Prompt ID
    if (state.pid && String(state.pid).toLowerCase().includes(q)) {
        return true;
    }

    // 2. Check Text outputs
    if (state.texts && state.texts.some(t => String(t).toLowerCase().includes(q))) {
        return true;
    }

    // 3. Check Image/Video output filenames
    if (state.images && state.images.some(img => {
        const filename = img.filename || "";
        return filename.toLowerCase().includes(q);
    })) {
        return true;
    }

    // 4. Check active/working node name
    if (state.activeNodeName && state.activeNodeName.toLowerCase().includes(q)) {
        return true;
    }

    // 5. Structural lookup within snapshotted workflow JSON (nodes, widget values, etc.)
    if (state.workflow && Array.isArray(state.workflow.nodes)) {
        for (const node of state.workflow.nodes) {
            if (node.title && node.title.toLowerCase().includes(q)) return true;
            if (node.type && node.type.toLowerCase().includes(q)) return true;
            if (Array.isArray(node.widgets)) {
                for (const w of node.widgets) {
                    if (w && w.value !== undefined && w.value !== null) {
                        if (String(w.value).toLowerCase().includes(q)) return true;
                    }
                }
            }
        }
    }

    return false;
}

// Prunes historical tasks from state matching the client queue history setting
function pruneHistory() {
    const maxItems = app.ui.settings.getSettingValue("Comfy.Queue.MaxHistoryItems") ?? 64;
    
    // Select non-pending, non-active tasks
    const tasks = Array.from(promptStates.entries())
        .filter(([pid, state]) => state.status !== "pending" && state.status !== "active");
    
    // Sort ascending by timestamp (oldest first)
    tasks.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    if (tasks.length > maxItems) {
        const deleteCount = tasks.length - maxItems;
        for (let i = 0; i < deleteCount; i++) {
            const [pid] = tasks[i];
            promptStates.delete(pid);
            cardElements.delete(pid);
        }
    }
}

// Creates a dark fullscreen preview overlay supporting both images and video formats
function showFullscreenPreview(imgSrcs) {
    if (!imgSrcs || imgSrcs.length === 0) return;
    
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
        position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh",
        background: "rgba(0,0,0,0.9)", zIndex: "10000", display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center",
        cursor: "zoom-out"
    });
    
    const content = document.createElement("div");
    Object.assign(content.style, { maxWidth: "90%", maxHeight: "85%", display: "flex", justifyContent: "center" });

    imgSrcs.forEach(src => {
        if (isVideoFormat(src)) {
            const video = document.createElement("video");
            video.src = src;
            video.autoplay = true;
            video.controls = true;
            video.loop = true;
            video.style.maxWidth = "100%";
            video.style.maxHeight = "100%";
            content.appendChild(video);
        } else {
            const img = document.createElement("img");
            img.src = src;
            img.style.maxWidth = "100%";
            img.style.maxHeight = "100%";
            img.style.objectFit = "contain";
            content.appendChild(img);
        }
    });

    overlay.appendChild(content);
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
}

// --- Background Copier for LoadImage Nodes ---
async function uploadDroppedImageToInput(imageObj) {
    const src = `/view?filename=${encodeURIComponent(imageObj.filename)}&type=${imageObj.type || 'output'}&subfolder=${encodeURIComponent(imageObj.subfolder || '')}`;
    try {
        const response = await fetch(src);
        const blob = await response.blob();
        const file = new File([blob], imageObj.filename || "dropped_image.png", { type: blob.type });
        const formData = new FormData();
        formData.append("image", file);
        formData.append("overwrite", "true");
        formData.append("type", "input");
        const uploadRes = await fetch("/upload/image", { method: "POST", body: formData });
        const uploadData = await uploadRes.json();
        return uploadData.name;
    } catch(e) {
        console.error("Comfy Sidebar: Failed to copy image to input folder.", e);
        return null;
    }
}

// --- Global Targeted Drop Listener ---
document.addEventListener("dragover", (e) => {
    if (currentDraggedImgData) {
        e.preventDefault(); 
        e.dataTransfer.dropEffect = "copy";
    }
});

document.addEventListener("drop", async (e) => {
    if (!currentDraggedImgData) return;
    
    const canvas = app.canvas;
    if (canvas && canvas.graph) {
        let targetNode = null;
        if (canvas.convertEventToCanvasOffset) {
            const pos = canvas.convertEventToCanvasOffset(e);
            targetNode = canvas.graph.getNodeOnPos(pos[0], pos[1]);
        } else {
            const rect = canvas.canvas.getBoundingClientRect();
            targetNode = canvas.graph.getNodeOnPos((e.clientX - rect.left - canvas.ds.offset[0]) / canvas.ds.scale, (e.clientY - rect.top - canvas.ds.offset[1]) / canvas.ds.scale);
        }

        let droppedOnImageNode = false;

        // 1. If dropped on Load Image Node
        if (targetNode && (targetNode.type.includes("LoadImage") || targetNode.widgets?.some(w => w.name === "image"))) {
            if (currentDraggedImgData.filename) { // Only attempt node upload if drag target represents a real file
                e.preventDefault();
                e.stopPropagation();
                droppedOnImageNode = true;
                const widget = targetNode.widgets.find(w => w.name === "image");
                if (widget) {
                    const newFilename = await uploadDroppedImageToInput(currentDraggedImgData);
                    if (newFilename) {
                        widget.value = newFilename;
                        if (widget.callback) widget.callback(widget.value);
                        targetNode.imgs = null;
                        app.graph.setDirtyCanvas(true, true);
                    }
                }
            }
        }

        // 2. If dropped on Empty Canvas (Synthesize native File drop to load workflow)
        if (!droppedOnImageNode) {
            e.preventDefault();
            e.stopPropagation();
            try {
                if (currentDraggedImgData.workflow) {
                    // Direct loading for text-only/empty cards carrying workflow data
                    if (app.loadGraphData) {
                        app.loadGraphData(currentDraggedImgData.workflow);
                    } else if (app.handleFile) {
                        const jsonStr = JSON.stringify(currentDraggedImgData.workflow);
                        const file = new File([jsonStr], "workflow.json", { type: "application/json" });
                        await app.handleFile(file);
                    }
                } else if (currentDraggedImgData.filename) {
                    const src = currentDraggedImgData.url || `/view?filename=${encodeURIComponent(currentDraggedImgData.filename)}&type=${currentDraggedImgData.type || 'output'}&subfolder=${encodeURIComponent(currentDraggedImgData.subfolder || '')}`;
                    const res = await fetch(src);
                    const blob = await res.blob();
                    const file = new File([blob], currentDraggedImgData.filename || "workflow.png", { type: blob.type });

                    if (app.handleFile) {
                        await app.handleFile(file);
                    } else if (app.canvas?.handleDropItem) {
                        app.canvas.handleDropItem({ getAsFile: () => file });
                    }
                }
            } catch (err) {
                console.error("Comfy Sidebar: Failed to synthesize workflow file drop:", err);
            }
        }
    }
    currentDraggedImgData = null;
}, true);

function findImagesInOutputs(outputs) {
    const list = [];
    if (!outputs) return list;
    for (const nodeId in outputs) {
        for (const key in outputs[nodeId]) {
            const val = outputs[nodeId][key];
            if (Array.isArray(val)) {
                val.forEach(item => {
                    if (item && typeof item === 'object' && item.filename) list.push(item);
                });
            }
        }
    }
    return list;
}

// Scrapes and yields formatted text outputs found across active generation scopes
function findTextsInOutputs(outputs) {
    const list = [];
    if (!outputs) return list;
    for (const nodeId in outputs) {
        for (const key in outputs[nodeId]) {
            const val = outputs[nodeId][key];
            if (Array.isArray(val)) {
                val.forEach(item => {
                    if (typeof item === 'string') {
                        list.push(item);
                    } else if (item && typeof item === 'object' && item.text) {
                        if (Array.isArray(item.text)) {
                            list.push(...item.text);
                        } else if (typeof item.text === 'string') {
                            list.push(item.text);
                        }
                    }
                });
            } else if (typeof val === 'string') {
                list.push(val);
            } else if (val && typeof val === 'object' && val.text) {
                if (Array.isArray(val.text)) {
                    list.push(...val.text);
                } else if (typeof val.text === 'string') {
                    list.push(val.text);
                }
            }
        }
    }
    return list;
}

const updateSidebarBadge = (count) => {
    const icons = document.querySelectorAll('.pi-images');
    icons.forEach(icon => {
        const btn = icon.closest('.comfyui-sidebar-tab, button, [role="tab"]');
        if (btn) {
            let badge = btn.querySelector('.comfy-sidebar-badge');
            if (count > 0) {
                if (!badge) {
                    btn.style.position = 'relative';
                    badge = document.createElement('div');
                    badge.className = 'comfy-sidebar-badge';
                    Object.assign(badge.style, {
                        position: 'absolute', top: '2px', right: '2px', background: '#0ea5e9', color: '#fff',
                        borderRadius: '50%', width: '16px', height: '16px', fontSize: '10px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', pointerEvents: 'none'
                    });
                    btn.appendChild(badge);
                }
                badge.textContent = count > 99 ? '99+' : count;
            } else if (badge) {
                badge.remove();
            }
        }
    });
};

// Tooling query selectors to safely find standard and custom tabs in the side rail
const findOurSidebarButton = () => {
    const icon = document.querySelector('.pi-images');
    if (icon) {
        return icon.closest('.comfyui-sidebar-tab, button, [role="tab"]');
    }
    return null;
};

const findStandardQueueButton = () => {
    const possibleIcons = [".pi-history", ".pi-clock", ".pi-server", ".pi-list", ".pi-sliders-h"];
    for (const iconSelector of possibleIcons) {
        const icon = document.querySelector(iconSelector);
        if (icon) {
            const btn = icon.closest('.comfyui-sidebar-tab, button, [role="tab"]');
            if (btn && !btn.querySelector('.pi-images')) {
                return btn;
            }
        }
    }
    const buttons = document.querySelectorAll('.comfyui-sidebar-tab, button, [role="tab"]');
    for (const btn of buttons) {
        const title = btn.title || btn.getAttribute('aria-label') || '';
        if (title.toLowerCase().includes('queue') || title.toLowerCase().includes('history')) {
            if (!btn.querySelector('.pi-images') && !btn.id?.includes('classic-comfy-sidebar')) {
                return btn;
            }
        }
    }
    return null;
};

// Handles button relocation and redirection when overriding the stock tab
const applySidebarOverride = () => {
    const overrideStock = app.ui.settings.getSettingValue("Comfy Sidebar.Override Stock Job History Tab") ?? false;
    const stdBtn = findStandardQueueButton();
    const ourBtn = findOurSidebarButton();
    
    if (stdBtn) {
        if (!stdBtn._originalDisplay) {
            stdBtn._originalDisplay = window.getComputedStyle(stdBtn).display || "block";
        }
        
        if (overrideStock) {
            stdBtn.style.setProperty("display", "none", "important");
            
            // Redirect standard panel clicks (e.g., active generation link clicks) to our panel
            if (!stdBtn._overrideClickListener) {
                stdBtn._overrideClickListener = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const b = findOurSidebarButton();
                    if (b) b.click();
                };
                stdBtn.addEventListener('click', stdBtn._overrideClickListener, true);
            }
            
            // Move our sidebar tab button right before the hidden standard Queue tab (replaces top slot)
            if (ourBtn && stdBtn.parentNode && ourBtn.nextSibling !== stdBtn) {
                stdBtn.parentNode.insertBefore(ourBtn, stdBtn);
            }
        } else {
            stdBtn.style.setProperty("display", stdBtn._originalDisplay === "none" ? "block" : stdBtn._originalDisplay);
            if (stdBtn._overrideClickListener) {
                stdBtn.removeEventListener('click', stdBtn._overrideClickListener, true);
                stdBtn._overrideClickListener = null;
            }
            // Restore our button to the bottom of the stack
            if (ourBtn && stdBtn.parentNode && ourBtn.parentNode === stdBtn.parentNode && ourBtn !== stdBtn.parentNode.lastChild) {
                stdBtn.parentNode.appendChild(ourBtn);
            }
        }
    }
};

// Cache and Restore helper to survive page refreshes
const saveStatesToLocalStorage = () => {
    try {
        const serializable = [];
        for (const [pid, state] of promptStates.entries()) {
            // Filter out temporary blob URLs from the serialized images
            const cleanedImages = (state.images || []).map(img => {
                if (img.url && img.url.startsWith("blob:")) {
                    return null; // Skip temporary blob URLs
                }
                return img;
            }).filter(Boolean);

            serializable.push({
                pid: state.pid,
                status: state.status,
                images: cleanedImages,
                texts: state.texts || [],
                workflow: state.workflow,
                progress: state.progress || 0,
                queueNumber: state.queueNumber,
                progressText: state.progressText || "",
                timestamp: state.timestamp,
                activeNodeName: state.activeNodeName || "",
                rendered: state.rendered || false,
                startTime: state.startTime,
                endTime: state.endTime,
                duration: state.duration
            });
        }
        localStorage.setItem("comfy_sidebar_prompt_states", JSON.stringify(serializable));
    } catch (e) {
        console.error("Comfy Sidebar: Failed to save state to localStorage", e);
    }
};

const loadStatesFromLocalStorage = () => {
    try {
        const data = localStorage.getItem("comfy_sidebar_prompt_states");
        if (data) {
            const list = JSON.parse(data);
            list.forEach(state => {
                promptStates.set(state.pid, state);
                if (state.timestamp > globalOrderCounter) {
                    globalOrderCounter = state.timestamp;
                }
            });
        }
    } catch (e) {
        console.error("Comfy Sidebar: Failed to load state from localStorage", e);
    }
};

app.registerExtension({
    name: "ComfySidebar.ClassicRestore",
    
    init() {
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Grid Columns Threshold", name: "Width Threshold for Queue Columns (px)", type: "number", defaultValue: 350 });
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Keep Object Aspect Ratio", name: "If disabled, cards in the queue will be cropped to the same size.", type: "boolean", defaultValue: true });
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Show Pending Count Only", name: "If disabled, each queued job will have a separate individual card", type: "boolean", defaultValue: true });
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Show Working Node Name", name: "Shows the name of the node which is currently in the process", type: "boolean", defaultValue: true });
        app.ui.settings.addSetting({ id: "Comfy Sidebar.Override Stock Job History Tab", name: "Replaces the stock Job History sidebar with Comfy Queue", type: "boolean", defaultValue: false });
    },

    async setup() {
        if (!app.extensionManager || !app.extensionManager.registerSidebarTab) return;

        sidebarContainer = document.createElement("div");
        Object.assign(sidebarContainer.style, {
            display: "flex", flexDirection: "column", height: "100%", padding: "14px", boxSizing: "border-box",
            background: "var(--comfy-menu-bg, #121212)", color: "var(--fg-color, #eee)"
        });

        // --- Flexbox layout header container with fixed boundary height ---
        const header = document.createElement("div");
        Object.assign(header.style, {
            position: "relative",
            marginBottom: "12px",
            height: "26px",
            display: "flex",
            alignItems: "center"
        });

        // 1. Standard Header Panel (Title + Magnifying Glass + Action Trigger Button)
        const standardHeader = document.createElement("div");
        Object.assign(standardHeader.style, {
            display: "flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "space-between"
        });

        const titleGroup = document.createElement("div");
        Object.assign(titleGroup.style, {
            display: "flex",
            alignItems: "center",
            gap: "8px"
        });

        const searchIcon = document.createElement("span");
        searchIcon.className = "pi pi-search";
        searchIcon.title = "Search History";
        Object.assign(searchIcon.style, {
            cursor: "pointer",
            fontSize: "13px",
            opacity: "0.6",
            transition: "opacity 0.15s ease-in-out"
        });
        searchIcon.onmouseenter = () => searchIcon.style.opacity = "1";
        searchIcon.onmouseleave = () => searchIcon.style.opacity = "0.6";

        const title = document.createElement("h3");
        title.textContent = "Queue";
        Object.assign(title.style, {
            margin: "0",
            fontSize: "14px",
            fontWeight: "bold",
            opacity: "0.9",
            color: "var(--fg-color, #eee)"
        });

        titleGroup.appendChild(searchIcon);
        titleGroup.appendChild(title);
        standardHeader.appendChild(titleGroup);

        const clearHistoryBtn = document.createElement("button");
        clearHistoryBtn.textContent = "Clear History";
        Object.assign(clearHistoryBtn.style, {
            background: "transparent",
            color: "var(--desc-color, #aaa)",
            border: "1px solid var(--border-color, #555)",
            borderRadius: "3px",
            padding: "3px 8px",
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: "bold",
            transition: "all 0.15s ease-in-out"
        });

        // Double-click confirm pattern with timeout
        let clearHistoryTimeout = null;
        let isClearHistoryPending = false;

        const resetClearHistoryBtn = () => {
            isClearHistoryPending = false;
            clearHistoryBtn.textContent = "Clear History";
            clearHistoryBtn.style.color = "var(--desc-color, #aaa)";
            clearHistoryBtn.style.background = "transparent";
            clearHistoryBtn.style.borderColor = "var(--border-color, #555)";
            clearHistoryBtn.style.boxShadow = "none";
            if (clearHistoryTimeout) {
                clearTimeout(clearHistoryTimeout);
                clearHistoryTimeout = null;
            }
        };

        // Add visual response highlights
        clearHistoryBtn.addEventListener("mouseenter", () => {
            if (!isClearHistoryPending) {
                clearHistoryBtn.style.borderColor = "var(--fg-color, #eee)";
                clearHistoryBtn.style.color = "var(--fg-color, #eee)";
            }
        });
        clearHistoryBtn.addEventListener("mouseleave", () => {
            if (!isClearHistoryPending) {
                clearHistoryBtn.style.borderColor = "var(--border-color, #555)";
                clearHistoryBtn.style.color = "var(--desc-color, #aaa)";
            }
        });

        clearHistoryBtn.onclick = async (ev) => {
            ev.stopPropagation();
            if (!isClearHistoryPending) {
                isClearHistoryPending = true;
                clearHistoryBtn.textContent = "Confirm?";
                clearHistoryBtn.style.color = "#fff";
                clearHistoryBtn.style.background = "#dc3545";
                clearHistoryBtn.style.borderColor = "#dc3545";
                clearHistoryBtn.style.boxShadow = "0 0 8px rgba(220, 53, 69, 0.6)"; // Muted glowing red shadow ring
                clearHistoryTimeout = setTimeout(() => {
                    resetClearHistoryBtn();
                }, 1500); // 1.5 seconds confirmation window
            } else {
                resetClearHistoryBtn();
                
                // Filter and delete only completed/error/cancelled items from promptStates
                for (const [pid, state] of promptStates.entries()) {
                    if (state.status !== "pending" && state.status !== "active") {
                        promptStates.delete(pid);
                        cardElements.delete(pid);
                    }
                }
                
                // Clear backend history
                try {
                    await api.fetchApi("/history", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ clear: true })
                    });
                } catch (err) {
                    console.error("Comfy Sidebar: Failed to clear backend history:", err);
                }
                renderDOM();
            }
        };

        standardHeader.appendChild(clearHistoryBtn);

        // 2. Search Container (Hidden by default, overlays standard header when active)
        const searchContainer = document.createElement("div");
        Object.assign(searchContainer.style, {
            display: "none",
            width: "100%",
            alignItems: "center",
            background: "var(--comfy-input-bg, #181818)",
            border: "1px solid var(--border-color, #555)",
            borderRadius: "4px",
            padding: "2px 8px",
            boxSizing: "border-box",
            height: "26px"
        });

        const searchInputIcon = document.createElement("span");
        searchInputIcon.className = "pi pi-search";
        Object.assign(searchInputIcon.style, {
            fontSize: "11px",
            opacity: "0.5",
            marginRight: "6px"
        });

        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.placeholder = "Filter by text, images, nodes...";
        Object.assign(searchInput.style, {
            flex: "1",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--comfy-input-color, var(--fg-color, #eee))",
            fontSize: "11px",
            padding: "0"
        });

        const clearSearchBtn = document.createElement("span");
        clearSearchBtn.className = "pi pi-times";
        clearSearchBtn.title = "Clear & Close Search";
        Object.assign(clearSearchBtn.style, {
            cursor: "pointer",
            fontSize: "11px",
            opacity: "0.6",
            marginLeft: "6px",
            transition: "opacity 0.15s ease"
        });
        clearSearchBtn.onmouseenter = () => clearSearchBtn.style.opacity = "1";
        clearSearchBtn.onmouseleave = () => clearSearchBtn.style.opacity = "0.6";

        searchContainer.appendChild(searchInputIcon);
        searchContainer.appendChild(searchInput);
        searchContainer.appendChild(clearSearchBtn);

        header.appendChild(standardHeader);
        header.appendChild(searchContainer);
        sidebarContainer.appendChild(header);

        // --- Search Overlay Transition Bindings ---
        searchIcon.onclick = (e) => {
            e.stopPropagation();
            standardHeader.style.display = "none";
            searchContainer.style.display = "flex";
            searchInput.focus();
        };

        const closeSearch = () => {
            searchInput.value = "";
            currentSearchQuery = "";
            searchContainer.style.display = "none";
            standardHeader.style.display = "flex";
            renderDOM();
        };

        clearSearchBtn.onclick = (e) => {
            e.stopPropagation();
            closeSearch();
        };

        searchInput.onkeydown = (e) => {
            if (e.key === "Escape") {
                closeSearch();
            }
        };

        searchInput.oninput = () => {
            currentSearchQuery = searchInput.value.trim();
            renderDOM();
        };

        cardStack = document.createElement("div");
        Object.assign(cardStack.style, { flex: "1", overflowY: "auto", scrollbarWidth: "thin", display: "block" });
        sidebarContainer.appendChild(cardStack);

        const resizeObserver = new ResizeObserver((entries) => {
            const width = entries[0].contentRect.width;
            const threshold = app.ui.settings.getSettingValue("Comfy Sidebar.Grid Columns Threshold") ?? 350;
            const cols = Math.max(1, Math.floor(width / (threshold / 2)));
            cardStack.style.columnCount = cols.toString();
            cardStack.style.columnGap = cols > 1 ? "12px" : "0";
        });
        resizeObserver.observe(sidebarContainer);

        // Continuous high-performance update loop for active card timers
        setInterval(() => {
            for (const [pid, state] of promptStates.entries()) {
                if (state.status === "active" && state.startTime) {
                    const cardObj = cardElements.get(pid);
                    if (cardObj && cardObj.timerEl) {
                        const elapsed = (Date.now() - state.startTime) / 1000;
                        cardObj.timerEl.textContent = elapsed.toFixed(2) + "s";
                    }
                }
            }
        }, 100);

        // --- NON-DESTRUCTIVE DOM RENDERER ---
        let renderTimeout = null;
        const renderDOM = () => {
            if (renderTimeout) cancelAnimationFrame(renderTimeout);
            renderTimeout = requestAnimationFrame(() => {
                const showPendingSummary = app.ui.settings.getSettingValue("Comfy Sidebar.Show Pending Count Only") ?? true;
                const keepAspect = app.ui.settings.getSettingValue("Comfy Sidebar.Keep Object Aspect Ratio") ?? true;
                const showWorkingNode = app.ui.settings.getSettingValue("Comfy Sidebar.Show Working Node Name") ?? true;

                let tasksArray = Array.from(promptStates.values());
                
                if (showPendingSummary) {
                    tasksArray = tasksArray.filter(t => t.status !== "pending");
                }

                // Apply active text and metadata filters
                if (currentSearchQuery) {
                    tasksArray = tasksArray.filter(t => matchesFilter(t, currentSearchQuery));
                }

                // Sorting: Force newest items at the top of the queue
                tasksArray.sort((a, b) => b.timestamp - a.timestamp);

                const activeTasks = tasksArray.filter(t => t.status === "active");
                const completedTasks = tasksArray.filter(t => t.status === "completed" || t.status === "cancelled" || t.status === "error");
                const pendingTasks = tasksArray.filter(t => t.status === "pending");

                // Newest pending items always on top
                pendingTasks.sort((a, b) => (b.queueNumber || 0) - (a.queueNumber || 0));

                const syncCardElement = (state) => {
                    let cardObj = cardElements.get(state.pid);
                    
                    // Task-Level Render Isolation: skip rendering if card is already finalized/cached
                    const isFinalStatus = state.status === "completed" || state.status === "cancelled" || state.status === "error";
                    if (cardObj && isFinalStatus && state.rendered) {
                        return cardObj.element;
                    }
                    
                    if (!cardObj) {
                        const card = document.createElement("div");
                        card.className = `comfy-sidebar-card ${state.status}`;

                        // Dedicated corner timer element
                        const timerEl = document.createElement("div");
                        timerEl.className = "comfy-sidebar-card-timer";
                        card.appendChild(timerEl);

                        // Cancel Task (X) Trigger (Unified size + underlayer)
                        const cancelX = document.createElement("span");
                        cancelX.className = "pi pi-times";
                        cancelX.title = "Cancel Pending Task";
                        Object.assign(cancelX.style, {
                            position: "absolute", top: "4px", right: "4px", color: "#dc3545", cursor: "pointer",
                            fontSize: "20px", display: "none", zIndex: "10",
                            background: "rgba(0,0,0,0.85)", padding: "8px 12px", borderRadius: "4px",
                            transition: "color 0.2s"
                        });
                        card.appendChild(cancelX);

                        // Status overlay badge
                        const sBadge = document.createElement("div");
                        Object.assign(sBadge.style, {
                            position: "absolute", top: "6px", right: "8px", fontSize: "9px", fontWeight: "bold",
                            padding: "2px 6px", borderRadius: "2px", textTransform: "uppercase", display: "none", pointerEvents: "none"
                        });
                        card.appendChild(sBadge);

                        const grid = document.createElement("div");
                        Object.assign(grid.style, { display: "flex", flexDirection: "column", gap: "6px" });
                        card.appendChild(grid);

                        const p = document.createElement("div");
                        Object.assign(p.style, { fontSize: "11px", opacity: "0.5", textAlign: "center", padding: "12px", marginTop: "12px", userSelect: "none", webkitUserSelect: "none" });
                        card.appendChild(p);

                        const pt = document.createElement("div");
                        Object.assign(pt.style, { width: "100%", height: "4px", background: "#333", borderRadius: "2px", marginTop: "8px", overflow: "hidden", display: "none" });
                        const pb = document.createElement("div");
                        Object.assign(pb.style, { width: `0%`, height: "100%", background: "#3b82f6", transition: "width 0.1s linear" });
                        pt.appendChild(pb);
                        card.appendChild(pt);

                        // Permanent, Dedicated Active Status Text container to resolve visual overlay issues
                        const statusText = document.createElement("div");
                        Object.assign(statusText.style, {
                            fontSize: "11px", opacity: "0.9", color: "#3b82f6", textAlign: "center",
                            marginTop: "6px", display: "none", fontWeight: "bold"
                        });
                        card.appendChild(statusText);

                        // Floating Action Hover Panel (Unified dimensions with cancel panel)
                        const hoverPanel = document.createElement("div");
                        Object.assign(hoverPanel.style, {
                            position: "absolute", bottom: "4px", right: "4px", display: "none",
                            gap: "12px", background: "rgba(0,0,0,0.85)", padding: "8px 12px", borderRadius: "4px", zIndex: "20"
                        });

                        // Unified 20px UI action buttons
                        const btnImg = document.createElement("span");
                        btnImg.className = "pi pi-image";
                        btnImg.title = "Save Object";
                        Object.assign(btnImg.style, { cursor: "pointer", fontSize: "20px", color: "#aaa" });

                        const btnJson = document.createElement("span");
                        btnJson.className = "pi pi-file";
                        btnJson.title = "Save Workflow";
                        Object.assign(btnJson.style, { cursor: "pointer", fontSize: "20px", color: "#aaa" });

                        const btnDel = document.createElement("span");
                        btnDel.className = "pi pi-trash";
                        btnDel.title = "Delete Element";
                        Object.assign(btnDel.style, { cursor: "pointer", fontSize: "20px", color: "#dc3545", transition: "all 0.1s ease-in-out" });

                        hoverPanel.appendChild(btnImg);
                        hoverPanel.appendChild(btnJson);
                        hoverPanel.appendChild(btnDel);
                        card.appendChild(hoverPanel);

                        cardObj = { element: card, timerEl, statusBadge: sBadge, grid, placeholder: p, progressContainer: pt, progressBar: pb, cancelBtn: cancelX, hoverPanel, btnImg, btnJson, btnDel, statusText, firstImgElement: null, lastImagesSignature: "" };
                        
                        // Card events
                        card.addEventListener("mouseenter", () => {
                            if (state.status !== "active" && state.status !== "pending") {
                                cardObj.hoverPanel.style.display = "flex";
                            }
                        });
                        card.addEventListener("mouseleave", () => {
                            cardObj.hoverPanel.style.display = "none";
                        });

                        card.addEventListener("dragstart", (e) => {
                            if (cardObj.firstImgElement) e.dataTransfer.setDragImage(cardObj.firstImgElement, 15, 15);
                            
                            if (state.images && state.images[0]) {
                                // Capture workflow alongside the image metadata to guarantee dropped cancelled previews load graphs
                                currentDraggedImgData = { ...state.images[0], workflow: state.workflow };
                                
                                const img = state.images[0];
                                const fileUrl = img.url ? img.url : window.location.origin + `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`;
                                const filename = img.filename || "output.png";
                                const mimeType = "image/png";
                                
                                try {
                                    e.dataTransfer.setData("DownloadURL", `${mimeType}:${filename}:${fileUrl}`);
                                    e.dataTransfer.setData("text/uri-list", fileUrl);
                                    e.dataTransfer.setData("text/plain", fileUrl);
                                } catch (err) {
                                    console.warn("Comfy Sidebar: Failed to set dragstart dataTransfer data:", err);
                                }

                                // Dummy file to trigger native LoadImage highlights
                                try {
                                    const dummyFile = new File([""], filename, { type: mimeType });
                                    e.dataTransfer.items.add(dummyFile);
                                } catch (err) {
                                    // Silently catch environment limits
                                }
                            } else if (state.workflow) {
                                currentDraggedImgData = { workflow: state.workflow };
                                
                                // Base64 data URL bypasses secure network limitations to allow clean local desktop downloads
                                const jsonStr = JSON.stringify(state.workflow, null, 2);
                                const dataUrl = "data:application/json;base64," + btoa(unescape(encodeURIComponent(jsonStr)));
                                const filename = `workflow_${state.pid}.json`;
                                
                                try {
                                    e.dataTransfer.setData("DownloadURL", `application/json:${filename}:${dataUrl}`);
                                    e.dataTransfer.setData("text/plain", jsonStr);
                                    e.dataTransfer.setData("application/json", jsonStr);
                                } catch (err) {
                                    console.warn("Comfy Sidebar: Failed to set workflow JSON dataTransfer data:", err);
                                }
                            }
                            e.dataTransfer.effectAllowed = "copy";
                        });

                        cardElements.set(state.pid, cardObj);
                    }

                    // Keep selector matching in sync with current state status
                    cardObj.element.className = `comfy-sidebar-card ${state.status}`;
                    // Restore HTML5 draggable attribute dynamically to resolve drag-and-drop bug
                    cardObj.element.setAttribute("draggable", "true");

                    // Set visual output for the timer
                    if (state.status === "active") {
                        if (state.startTime) {
                            const elapsed = (Date.now() - state.startTime) / 1000;
                            cardObj.timerEl.textContent = elapsed.toFixed(2) + "s";
                        } else {
                            cardObj.timerEl.textContent = "...";
                        }
                        cardObj.timerEl.style.display = "block";
                    } else if (state.duration !== undefined && state.duration !== null) {
                        cardObj.timerEl.textContent = state.duration.toFixed(2) + "s";
                        cardObj.timerEl.style.display = "block";
                    } else {
                        cardObj.timerEl.style.display = "none";
                    }

                    // Text overlay badges for Cancelled/Error runs
                    if (state.status === "cancelled") {
                        cardObj.statusBadge.style.display = "block";
                        cardObj.statusBadge.textContent = "Cancelled";
                        cardObj.statusBadge.style.background = "#ffc107";
                        cardObj.statusBadge.style.color = "#000";
                    } else if (state.status === "error") {
                        cardObj.statusBadge.style.display = "block";
                        cardObj.statusBadge.textContent = "Error";
                        cardObj.statusBadge.style.background = "#dc3545";
                        cardObj.statusBadge.style.color = "#fff";
                    } else {
                        cardObj.statusBadge.style.display = "none";
                    }

                    // Cancel pending action bindings
                    if (state.status === "pending" && !showPendingSummary) {
                        cardObj.cancelBtn.style.display = "flex";
                        cardObj.cancelBtn.onclick = async (ev) => { 
                            ev.stopPropagation();
                            await api.fetchApi("/queue", { method: "POST", body: JSON.stringify({ delete: [state.pid] }) });
                            await syncQueue(); 
                        };
                    } else {
                        cardObj.cancelBtn.style.display = "none";
                    }

                    // Action buttons behavior bindings
                    if (state.images && state.images.length > 0) {
                        cardObj.btnImg.style.display = "inline";
                        cardObj.btnImg.onclick = (ev) => {
                            ev.stopPropagation();
                            state.images.forEach(img => {
                                const fileUrl = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`;
                                const a = document.createElement("a");
                                a.href = fileUrl;
                                a.download = img.filename || "output";
                                a.click();
                            });
                        };
                    } else {
                        cardObj.btnImg.style.display = "none";
                    }

                    if (state.workflow) {
                        cardObj.btnJson.style.display = "inline";
                        cardObj.btnJson.onclick = (ev) => {
                            ev.stopPropagation();
                            const jsonStr = JSON.stringify(state.workflow, null, 2);
                            const blob = new Blob([jsonStr], { type: "application/json" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `workflow_${state.pid}.json`;
                            a.click();
                            URL.revokeObjectURL(url);
                        };
                    } else {
                        cardObj.btnJson.style.display = "none";
                    }

                    // Confirm-before-delete UI behavior logic
                    let deleteTimeout = null;
                    let isDeletePending = false;

                    const resetDeleteBtn = () => {
                        isDeletePending = false;
                        cardObj.btnDel.style.color = "#dc3545";
                        cardObj.btnDel.style.background = "none";
                        cardObj.btnDel.style.padding = "0";
                        cardObj.btnDel.title = "Delete Element from History";
                        if (deleteTimeout) {
                            clearTimeout(deleteTimeout);
                            deleteTimeout = null;
                        }
                    };

                    cardObj.btnDel.onclick = async (ev) => {
                        ev.stopPropagation();
                        if (!isDeletePending) {
                            // First click: arm the deletion visually
                            isDeletePending = true;
                            cardObj.btnDel.style.color = "#fff";
                            cardObj.btnDel.style.background = "#dc3545";
                            cardObj.btnDel.style.borderRadius = "4px";
                            cardObj.btnDel.style.padding = "2px";
                            cardObj.btnDel.title = "Click again to confirm deletion";
                            
                            deleteTimeout = setTimeout(() => {
                                resetDeleteBtn();
                            }, 1000); // 1 second confirmation window
                        } else {
                            // Second click: execute deletion immediately
                            resetDeleteBtn();
                            promptStates.delete(state.pid);
                            await api.fetchApi("/history", { method: "POST", body: JSON.stringify({ delete: [state.pid] }) });
                            renderDOM();
                        }
                    };

                    // --- IN-PLACE SMOOTH FLICKER-FREE RENDERING WITH ASPECT LOCK ---
                    const currentImagesSignature = state.images ? state.images.map(img => img.url || img.filename).join("|") : "";
                    
                    if (cardObj.lastImagesSignature !== currentImagesSignature) {
                        if (!state.images || state.images.length === 0) {
                            cardObj.grid.innerHTML = "";
                            cardObj.firstImgElement = null;
                            cardObj.placeholder.style.display = "block";
                        } else {
                            cardObj.placeholder.style.display = "none";
                            
                            // If same amount of slots, swap source on matching nodes (prevents image reset collapse)
                            if (cardObj.grid.children.length === state.images.length) {
                                state.images.forEach((img, idx) => {
                                    const src = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`;
                                    const thumb = cardObj.grid.children[idx];
                                    if (thumb.src !== src) {
                                        // Blinking prevention: preload blob images silently and render only on completion
                                        if (src.startsWith("blob:")) {
                                            const tempImg = new Image();
                                            tempImg.onload = () => {
                                                const oldBlob = thumb._lastBlob;
                                                thumb.src = src;
                                                thumb._lastBlob = src;
                                                if (oldBlob && oldBlob !== src) {
                                                    try { URL.revokeObjectURL(oldBlob); } catch(e){}
                                                }
                                            };
                                            tempImg.src = src;
                                        } else {
                                            thumb.src = src;
                                        }
                                    }
                                });
                            } else {
                                cardObj.grid.innerHTML = "";
                                cardObj.firstImgElement = null;
                                state.images.forEach(img => {
                                    const src = img.url ? img.url : `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`;
                                    const isVideo = isVideoFormat(src);
                                    
                                    // Handle in-panel muted auto-playing looping videos elegantly
                                    const thumb = isVideo ? document.createElement("video") : document.createElement("img");
                                    Object.assign(thumb.style, { width: "100%", borderRadius: "2px", display: "block", cursor: "zoom-in" });
                                    
                                    if (isVideo) {
                                        thumb.autoplay = true;
                                        thumb.loop = true;
                                        thumb.muted = true;
                                        thumb.playsInline = true;
                                    }
                                    if (!keepAspect) { thumb.style.aspectRatio = "1 / 1"; thumb.style.objectFit = "cover"; }
                                    thumb.setAttribute("draggable", "false"); 
                                    
                                    // Lock aspect ratio on load to stabilize the container during subsequent updates
                                    if (!isVideo) {
                                        thumb.onload = () => {
                                            if (keepAspect && thumb.naturalWidth && thumb.naturalHeight) {
                                                thumb.style.aspectRatio = `${thumb.naturalWidth} / ${thumb.naturalHeight}`;
                                            }
                                        };
                                        if (src.startsWith("blob:")) {
                                            const tempImg = new Image();
                                            tempImg.onload = () => {
                                                thumb.src = src;
                                                thumb._lastBlob = src;
                                            };
                                            tempImg.src = src;
                                        } else {
                                            thumb.src = src;
                                        }
                                    } else {
                                        thumb.onloadedmetadata = () => {
                                            if (keepAspect && thumb.videoWidth && thumb.videoHeight) {
                                                thumb.style.aspectRatio = `${thumb.videoWidth} / ${thumb.videoHeight}`;
                                            }
                                        };
                                        thumb.src = src;
                                    }

                                    // Fullscreen preview click trigger
                                    thumb.onclick = (ev) => {
                                        ev.stopPropagation();
                                        const srcs = state.images.map(i => i.url ? i.url : `/view?filename=${encodeURIComponent(i.filename)}&type=${i.type}&subfolder=${encodeURIComponent(i.subfolder)}`);
                                        showFullscreenPreview(srcs);
                                    };

                                    if (!cardObj.firstImgElement) cardObj.firstImgElement = thumb;
                                    cardObj.grid.appendChild(thumb);
                                });
                            }
                        }
                        cardObj.lastImagesSignature = currentImagesSignature;
                    }

                    if (state.images.length === 0) {
                        // Render formatted text outputs inside card instead of blindly showing "No Outputs"
                        if (state.texts && state.texts.length > 0) {
                            cardObj.placeholder.textContent = state.texts.join("\n");
                            Object.assign(cardObj.placeholder.style, {
                                whiteSpace: "pre-wrap", textAlign: "left", fontSize: "10px", opacity: "0.8"
                            });
                        } else {
                            cardObj.placeholder.textContent = state.progressText || "No Outputs";
                            Object.assign(cardObj.placeholder.style, {
                                whiteSpace: "normal", textAlign: "center", fontSize: "11px", opacity: "0.5"
                            });
                        }
                    }

                    if (state.status === "active") {
                        if (showWorkingNode) {
                            cardObj.statusText.style.display = "block";
                            if (state.activeNodeName) {
                                if (state.activeNodeName === "Finishing...") {
                                    cardObj.statusText.textContent = "Finishing...";
                                } else {
                                    const percent = state.progress ? ` ${state.progress}%` : "";
                                    cardObj.statusText.textContent = `[${state.activeNodeName}]${percent}`;
                                }
                            } else {
                                const percent = state.progress ? ` ${state.progress}%` : "";
                                cardObj.statusText.textContent = `Sampling...${percent}`;
                            }
                        } else {
                            cardObj.statusText.style.display = "none";
                        }
                        cardObj.progressContainer.style.display = "block";
                        cardObj.progressBar.style.width = `${state.progress || 0}%`;
                    } else {
                        cardObj.statusText.style.display = "none";
                        cardObj.progressContainer.style.display = "none";
                    }

                    if (isFinalStatus) {
                        state.rendered = true; // Mark as rendered so we skip processing in future frames
                    }

                    return cardObj.element;
                };

                // Delete items no longer present in states
                for (const [pid, cardObj] of cardElements.entries()) {
                    if (pid !== "pending-summary-card" && pid !== "pending-cancel-all-standalone" && !promptStates.has(pid)) {
                        cardElements.delete(pid);
                    }
                }

                const pendingCount = Array.from(promptStates.values()).filter(t => t.status === "pending").length;

                // Dedicated Summary/Standalone Clear Cards Rendering Placement
                const getPendingSummaryCard = () => {
                    let pCard = cardElements.get("pending-summary-card");
                    if (!pCard) {
                        const el = document.createElement("div");
                        Object.assign(el.style, { background: "#181818", border: "2px solid #6c757d", borderRadius: "4px", padding: "10px", marginBottom: "12px", textAlign: "center", fontSize: "12px", fontWeight: "bold", color: "#aaa", breakInside: "avoid", display: "flex", flexDirection: "column", gap: "8px" });
                        const textDiv = document.createElement("div");
                        el.appendChild(textDiv);
                        const cancelBtn = document.createElement("button");
                        cancelBtn.textContent = "Cancel All Pending";
                        Object.assign(cancelBtn.style, { background: "#dc3545", color: "white", border: "none", borderRadius: "3px", padding: "4px", cursor: "pointer", fontSize: "11px", fontWeight: "bold" });
                        
                        cancelBtn.onclick = async () => { 
                            await api.fetchApi("/queue", { method: "POST", body: JSON.stringify({ clear: true }) });
                            await syncQueue(); 
                        };
                        el.appendChild(cancelBtn);
                        pCard = { element: el, textDiv };
                        cardElements.set("pending-summary-card", pCard);
                    }
                    pCard.textDiv.textContent = `Pending Queue: ${pendingCount} tasks`;
                    return pCard.element;
                };

                const getCancelStandaloneBtn = () => {
                    let cancelStandalone = cardElements.get("pending-cancel-all-standalone");
                    if (!cancelStandalone) {
                        const btn = document.createElement("button");
                        btn.textContent = "Cancel All Pending";
                        Object.assign(btn.style, {
                            background: "#dc3545", color: "white", border: "none", borderRadius: "3px",
                            padding: "6px", cursor: "pointer", fontSize: "11px", fontWeight: "bold",
                            width: "100%", marginBottom: "12px", breakInside: "avoid"
                        });
                        btn.onclick = async () => {
                            await api.fetchApi("/queue", { method: "POST", body: JSON.stringify({ clear: true }) });
                            await syncQueue();
                        };
                        cancelStandalone = { element: btn };
                        cardElements.set("pending-cancel-all-standalone", cancelStandalone);
                    }
                    return cancelStandalone.element;
                };

                // Sequential Render Execution array builder (Always Waterfall Newest-on-Top)
                const targetElements = [];

                if (pendingCount > 0) {
                    if (showPendingSummary) {
                        targetElements.push(getPendingSummaryCard());
                    } else {
                        targetElements.push(getCancelStandaloneBtn());
                        pendingTasks.forEach(st => targetElements.push(syncCardElement(st)));
                    }
                }
                activeTasks.forEach(st => targetElements.push(syncCardElement(st)));
                completedTasks.forEach(st => targetElements.push(syncCardElement(st)));

                // In-place dynamic DOM reconciliation to fully eliminate flickering and selection errors
                targetElements.forEach((el, index) => {
                    if (cardStack.children[index] !== el) {
                        cardStack.insertBefore(el, cardStack.children[index] || null);
                    }
                });

                // Safely prune residual historical nodes from the bottom
                while (cardStack.children.length > targetElements.length) {
                    cardStack.removeChild(cardStack.lastChild);
                }

                // Save updated state schema to localStorage to survive tab reloads safely
                saveStatesToLocalStorage();
            });
        };

        const syncQueue = async () => {
            try {
                const q = await api.getQueue();
                const runningList = q.Running || q.queue_running || [];
                const pendingList = q.Pending || q.queue_pending || [];
                const pendingIds = new Set();
                
                // Map the queue to normalized objects to reliably sort oldest-first sequence orders
                const normalizedPending = pendingList.map((p, idx) => {
                    let pid = null;
                    let seq = idx; 
                    if (Array.isArray(p)) {
                        seq = typeof p[0] === 'number' ? p[0] : idx;
                        pid = p[1];
                    } else if (p && typeof p === "object") {
                        pid = p.prompt_id || p.id || p.uuid;
                        seq = typeof p.number === 'number' ? p.number : (typeof p.prompt_number === 'number' ? p.prompt_number : idx);
                    }
                    return { pid, seq, original: p };
                });

                // Sort queue oldest-first (lowest absolute server sequence number first)
                normalizedPending.sort((a, b) => a.seq - b.seq);

                normalizedPending.forEach((item, index) => {
                    const pid = item.pid;
                    // Assign relative positions sequentially (oldest always gets #1)
                    const number = index + 1;

                    if (pid) {
                        pendingIds.add(pid);
                        if (!promptStates.has(pid)) {
                            globalOrderCounter++;
                            promptStates.set(pid, {
                                pid: pid, status: "pending", images: [], progress: 0,
                                queueNumber: number,
                                progressText: `Pending... (#${number})`, timestamp: globalOrderCounter,
                                workflow: app.graph.serialize() // Snapshot workflow metadata immediately on queue entry
                            });
                        } else {
                            // Ensure preexisting pending records update their sequence number correctly
                            const st = promptStates.get(pid);
                            if (st.status === "pending") {
                                st.queueNumber = number;
                                st.progressText = `Pending... (#${number})`;
                            }
                        }
                    }
                });

                // Clear out expired pending items
                for (const [pid, state] of promptStates.entries()) {
                    if (state.status === "pending" && !pendingIds.has(pid)) {
                        promptStates.delete(pid);
                    }
                }

                // Count logical badge: All pending tasks + (Active generating task exists ? 1 : 0)
                const totalActiveCount = pendingIds.size + (runningList.length > 0 ? 1 : 0);
                updateSidebarBadge(totalActiveCount);
                renderDOM();
            } catch (err) {
                console.error("Comfy Sidebar: Failed to sync queue state", err);
            }
        };

        api.addEventListener("status", syncQueue);
        
        api.addEventListener("execution_start", (e) => {
            const pid = e.detail.prompt_id;
            currentlyActivePromptId = pid; // Global tracking update
            
            // Snapshot the active canvas workflow immediately so cancelled/failed runs still preserve their workflow structure
            const activeWorkspaceWorkflow = app.graph.serialize();

            if (promptStates.has(pid)) {
                const st = promptStates.get(pid);
                st.status = "active";
                st.progressText = "Sampling...";
                st.workflow = activeWorkspaceWorkflow;
                st.rendered = false; // Reset rendering lock when transitioning state
                st.startTime = Date.now();
                st.duration = null;
            } else {
                globalOrderCounter++;
                promptStates.set(pid, {
                    pid: pid, status: "active", images: [], progress: 0,
                    progressText: "Sampling...", timestamp: globalOrderCounter,
                    workflow: activeWorkspaceWorkflow,
                    startTime: Date.now(),
                    duration: null
                });
            }
            syncQueue();
        });

        api.addEventListener("progress", (e) => {
            const pid = e.detail.prompt_id;
            if (pid && promptStates.has(pid)) {
                promptStates.get(pid).progress = Math.round((e.detail.value / e.detail.max) * 100);
                renderDOM();
            }
        });

        // Monitors current executing node ID to print it dynamically above progress track
        api.addEventListener("executing", (e) => {
            const nodeId = e.detail;
            const showWorkingNode = app.ui.settings.getSettingValue("Comfy Sidebar.Show Working Node Name") ?? true;
            
            if (showWorkingNode && currentlyActivePromptId && promptStates.has(currentlyActivePromptId)) {
                const st = promptStates.get(currentlyActivePromptId);
                if (nodeId) {
                    const node = app.graph.getNodeById(nodeId);
                    st.activeNodeName = node ? (node.title || node.type) : `Node #${nodeId}`;
                } else {
                    st.activeNodeName = "Finishing...";
                }
                renderDOM();
            }
        });

        api.addEventListener("b_preview", (e) => {
            const activeTasks = Array.from(promptStates.values()).filter(t => t.status === "active");
            if (activeTasks.length > 0) {
                const st = activeTasks[0];
                
                // Revoke old object URLs to save memory
                if (st._previewBlobUrl) {
                    try { URL.revokeObjectURL(st._previewBlobUrl); } catch(e){}
                }
                
                st._previewBlobUrl = URL.createObjectURL(e.detail);
                st.images = [{ url: st._previewBlobUrl }];
                renderDOM();
            }
        });

        api.addEventListener("executed", (e) => {
            if (promptStates.has(e.detail.prompt_id)) {
                const finalImgs = findImagesInOutputs({ output: e.detail.output });
                if (finalImgs.length > 0) {
                    promptStates.get(e.detail.prompt_id).images = finalImgs;
                }
                const finalTexts = findTextsInOutputs({ output: e.detail.output });
                promptStates.get(e.detail.prompt_id).texts = finalTexts;
                renderDOM();
            }
        });

        const concludeRun = async (pid, statusStr) => {
            if (!pid || !promptStates.has(pid)) return;
            if (currentlyActivePromptId === pid) {
                currentlyActivePromptId = null; // Clear executing state
            }
            const st = promptStates.get(pid);
            st.status = statusStr;
            st.progressText = "";
            st.rendered = false; // Reset dynamic lock so we render final outputs exactly once
            st.endTime = Date.now();
            if (st.startTime) {
                st.duration = (st.endTime - st.startTime) / 1000;
            }
            try {
                const res = await fetch(`/history/${pid}`);
                const hItem = await res.json();
                if (hItem && hItem[pid]) {
                    // Update fallback workflow if it was not captured during execution start
                    if (!st.workflow) {
                        st.workflow = hItem[pid].extra_data?.extra_pnginfo?.workflow || null;
                    }
                    if (st.images.length === 0) {
                        st.images = findImagesInOutputs(hItem[pid].outputs);
                    }
                    st.texts = findTextsInOutputs(hItem[pid].outputs);
                }
            } catch (err) {}
            pruneHistory();
            syncQueue();
        };

        api.addEventListener("execution_success", (e) => concludeRun(e.detail.prompt_id, "completed"));
        api.addEventListener("execution_error", (e) => concludeRun(e.detail.prompt_id, "error"));
        api.addEventListener("execution_interrupted", (e) => {
            const activeTasks = Array.from(promptStates.values()).filter(t => t.status === "active");
            activeTasks.forEach(t => concludeRun(t.pid, "cancelled"));
            syncQueue();
        });

        // Toggle Sidebar Tab open/close on keyboard shortcut 'q' or 'Q' key press
        document.addEventListener("keydown", (e) => {
            const activeEl = document.activeElement;
            if (activeEl && (
                activeEl.tagName === "INPUT" || 
                activeEl.tagName === "TEXTAREA" || 
                activeEl.isContentEditable || 
                activeEl.tagName === "SELECT"
            )) {
                return;
            }
            
            if (e.key.toLowerCase() === "q") {
                e.preventDefault();
                e.stopPropagation();
                const ourBtn = findOurSidebarButton();
                if (ourBtn) {
                    ourBtn.click();
                }
            }
        }, true); // Capture phase listener to safely override standard ComfyUI hotkeys

        // Periodically check and apply override/positioning to prevent race conditions during page changes
        setInterval(() => {
            applySidebarOverride();
        }, 500);

        // --- BACKEND SESSION RESTARTS HANDLER ---
        let backendSessionId = null;
        try {
            const res = await fetch("/classic-sidebar/session");
            const data = await res.json();
            backendSessionId = data.session_id;
        } catch (err) {
            console.warn("Comfy Sidebar: Custom backend session endpoint not found. Queue persistence will fall back to cache.", err);
        }

        const storedSessionId = localStorage.getItem("comfy_sidebar_backend_session_id");

        if (backendSessionId && backendSessionId === storedSessionId) {
            // Server did not restart! Safely load cached queue state from localStorage
            loadStatesFromLocalStorage();
        } else {
            // Server restarted or first run! Wipe old cache and store new session ID
            localStorage.removeItem("comfy_sidebar_prompt_states");
            if (backendSessionId) {
                localStorage.setItem("comfy_sidebar_backend_session_id", backendSessionId);
            }
        }

        // Initialize history list
        const historyData = await api.getHistory();
        const ids = Object.keys(historyData).sort((a,b) => Number(a)-Number(b));
        ids.forEach(id => {
            // Keep specialized cancelled/error session records loaded from localStorage intact
            if (promptStates.has(id)) {
                return;
            }

            const images = findImagesInOutputs(historyData[id].outputs);
            const texts = findTextsInOutputs(historyData[id].outputs);

            // Skip loading history items that have absolutely no outputs (images/texts) to prevent blank cards on refresh
            if (images.length === 0 && texts.length === 0) {
                return;
            }

            globalOrderCounter++;
            promptStates.set(id, {
                pid: id, status: "completed", 
                images: images,
                texts: texts,
                workflow: historyData[id].extra_data?.extra_pnginfo?.workflow || null,
                progressText: "", timestamp: globalOrderCounter,
                rendered: true // Mark history loaded outputs as already rendered
            });
        });
        pruneHistory();
        syncQueue();

        app.extensionManager.registerSidebarTab({ id: "classic-comfy-sidebar", icon: "pi pi-images", title: "Queue", tooltip: "Comfy Queue (Q)", type: "custom", render: (el) => { el.appendChild(sidebarContainer); } });
    }
});