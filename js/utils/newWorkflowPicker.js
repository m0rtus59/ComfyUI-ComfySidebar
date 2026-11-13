import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { SettingIds } from "../core/constants.js";
import { getSetting } from "../core/settings.js";
import { t } from "../core/i18n.js";
import { setupSpotlightTracker } from "./utils.js";

function isTemporaryWorkflow(wf) {
    if (!wf) return false;
    return wf.isTemporary === true || wf.isPersisted === false;
}

function findNewWorkflowButton(target) {
    if (!target || typeof target.closest !== "function") return null;

    const direct = target.closest(".new-blank-workflow-button");
    if (direct) return direct;

    const btn = target.closest('button, [role="button"]');
    if (!btn) return null;

    const tabsContainer = btn.closest(".workflow-tabs-container, .workflow-tabs");
    if (!tabsContainer) return null;
    if (btn.closest('.workflow-tab, [role="tab"], .p-togglebutton')) return null;

    const label = (btn.getAttribute("aria-label") || btn.getAttribute("title") || "").toLowerCase();
    if (label.includes("blank workflow") || label.includes("new workflow")) {
        return btn;
    }

    if (btn.querySelector('.pi-plus, [class*="lucide--plus"], svg.lucide-plus')) {
        return btn;
    }

    return null;
}

function findFallbackAnchorRect() {
    const activeTab = document.querySelector('.workflow-tabs-container [role="tab"][data-state="active"], [role="tab"][data-state="active"]');
    if (activeTab) {
        const r = activeTab.getBoundingClientRect();
        if (r.width > 0) return { left: r.left, bottom: r.bottom };
    }
    const plusBtn = document.querySelector(".new-blank-workflow-button");
    if (plusBtn) {
        const r = plusBtn.getBoundingClientRect();
        if (r.width > 0) return { left: r.left, bottom: r.bottom };
    }
    return null;
}

async function fetchSavedWorkflows() {
    const seen = new Set();
    const items = [];

    const addEntry = (rawPath) => {
        if (!rawPath || typeof rawPath !== "string") return;
        let rel = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
        if (rel.startsWith("workflows/")) {
            rel = rel.slice("workflows/".length);
        }
        if (!rel.toLowerCase().endsWith(".json")) return;

        const parts = rel.split("/");
        if (parts.some(p => !p || p.startsWith("."))) return;

        if (seen.has(rel)) return;
        seen.add(rel);

        const fileNameWithExt = parts[parts.length - 1];
        const displayName = fileNameWithExt.replace(/\.json$/i, "");
        const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";

        items.push({
            relPath: rel,
            fullPath: `workflows/${rel}`,
            displayName,
            folder,
            searchStr: rel.replace(/\.json$/i, "").toLowerCase()
        });
    };

    try {
        const res = await api.fetchApi("/userdata?dir=workflows&recurse=true");
        if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list)) {
                for (const entry of list) {
                    if (typeof entry === "string") {
                        addEntry(entry);
                    } else if (entry && typeof entry.path === "string") {
                        addEntry(entry.path);
                    }
                }
            }
        }
    } catch (e) {
        console.warn("[ComfySidebar] Failed to list saved workflows via API:", e);
    }

    const wfMgr = app.extensionManager?.workflow;
    const storeList = wfMgr?.persistedWorkflows || wfMgr?.workflows || [];
    for (const wf of storeList) {
        if (wf && wf.isPersisted !== false && !wf.isTemporary && wf.path) {
            addEntry(wf.path);
        }
    }

    items.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
    return items;
}

function filterWorkflows(allItems, rawQuery) {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return [];

    const tokens = q.split(/\s+/).filter(Boolean);
    const matches = [];

    for (const item of allItems) {
        const nameLower = item.displayName.toLowerCase();
        if (!tokens.every(tok => item.searchStr.includes(tok))) continue;

        let rank = 3;
        if (nameLower === q) rank = 0;
        else if (nameLower.startsWith(q)) rank = 1;
        else if (nameLower.includes(q)) rank = 2;

        matches.push({ item, rank });
    }

    matches.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.item.displayName.localeCompare(b.item.displayName, undefined, { sensitivity: "base" });
    });

    return matches.slice(0, 30).map(m => m.item);
}

export function setupNewWorkflowQuickPicker() {
    let activeTooltip = null;
    let activeCleanup = null;
    let activeSession = null;
    let isReplacing = false;
    let activeCloseCount = 0;
    let userInitiatedBlankUntil = 0;
    const promptedWorkflows = new WeakSet();

    const closePicker = () => {
        if (activeCleanup) {
            activeCleanup();
            activeCleanup = null;
        }
        if (activeTooltip) {
            activeTooltip.remove();
            activeTooltip = null;
        }
        activeSession = null;
    };

    const replaceUnsavedWithWorkflow = async (item, tempWf) => {
        const wfMgr = app.extensionManager?.workflow;
        const targetTemp = tempWf || (isTemporaryWorkflow(wfMgr?.activeWorkflow) ? wfMgr.activeWorkflow : null);

        isReplacing = true;
        try {
            if (wfMgr) {
                const targetWf =
                    wfMgr.getWorkflowByPath?.(item.fullPath) ||
                    wfMgr.workflows?.find(w => (w.path || "").replace(/\\/g, "/") === item.fullPath);

                if (targetWf && typeof wfMgr.openWorkflow === "function") {
                    if (typeof targetWf.load === "function" && !targetWf.isLoaded) {
                        try {
                            await targetWf.load();
                        } catch (_) {}
                    }

                    let graphData = targetWf.changeTracker?.activeState || targetWf.activeState;
                    if (!graphData) {
                        const res = await api.fetchApi(`/userdata/${encodeURIComponent(item.fullPath)}`);
                        if (res.ok) {
                            graphData = await res.json();
                        }
                    }

                    const cleanGraphData = graphData ? JSON.parse(JSON.stringify(graphData)) : null;

                    const canCloseTemp =
                        targetTemp &&
                        targetTemp !== targetWf &&
                        isTemporaryWorkflow(targetTemp) &&
                        typeof wfMgr.closeWorkflow === "function";

                    await wfMgr.openWorkflow(targetWf);

                    if (canCloseTemp) {
                        try {
                            await wfMgr.closeWorkflow(targetTemp, { warnIfUnsaved: false });
                        } catch (e) {
                            console.warn("[ComfySidebar] Could not close temporary workflow tab:", e);
                        }
                    }

                    if (cleanGraphData) {
                        await app.loadGraphData(cleanGraphData, true, true, targetWf);
                    }
                    return;
                }
            }

            const res = await api.fetchApi(`/userdata/${encodeURIComponent(item.fullPath)}`);
            if (res.ok) {
                const graphData = await res.json();
                await app.loadGraphData(graphData, true, true);
            }
        } catch (e) {
            console.warn("[ComfySidebar] Failed to replace unsaved workflow:", e);
        } finally {
            isReplacing = false;
        }
    };

    const showPicker = (anchorRect, initialTempWf = null, prevWorkflow = null) => {
        if (initialTempWf) {
            if (promptedWorkflows.has(initialTempWf)) return;
            promptedWorkflows.add(initialTempWf);
        }

        closePicker();

        let resolvedTempWf = initialTempWf;

        const tooltip = document.createElement("div");
        tooltip.className = "comfy-sidebar-wf-picker";

        const inputWrap = document.createElement("div");
        inputWrap.className = "comfy-sidebar-wf-picker-input-wrap";

        const icon = document.createElement("i");
        icon.className = "pi pi-search comfy-sidebar-wf-picker-icon";

        const input = document.createElement("input");
        input.type = "text";
        input.className = "comfy-sidebar-wf-picker-input";
        input.placeholder = t("Type to load saved workflow...");
        input.autocomplete = "off";
        input.spellcheck = false;

        inputWrap.append(icon, input);
        tooltip.appendChild(inputWrap);

        const listEl = document.createElement("div");
        listEl.className = "comfy-sidebar-wf-picker-list";
        listEl.style.display = "none";
        setupSpotlightTracker(listEl, ".comfy-sidebar-wf-picker-item");
        tooltip.appendChild(listEl);

        // Edge-to-edge alignment using pre-click '+' button coords (exact left edge of the new tab)
        const applyCoords = (coords) => {
            const width = tooltip.offsetWidth || 300;
            if (!coords) {
                tooltip.style.left = `${Math.round((window.innerWidth - width) / 2)}px`;
                tooltip.style.top = "52px";
                return;
            }
            const left = Math.max(12, Math.min(coords.left, window.innerWidth - width - 12));
            const top = Math.min(coords.bottom + 6, window.innerHeight - 60);
            tooltip.style.left = `${Math.round(left)}px`;
            tooltip.style.top = `${Math.round(top)}px`;
        };

        document.body.appendChild(tooltip);
        activeTooltip = tooltip;
        applyCoords(anchorRect || findFallbackAnchorRect());

        let cachedWorkflows = null;
        let loadingPromise = null;
        let currentMatches = [];
        let selectedIdx = -1;

        const ensureWorkflowsLoaded = async () => {
            if (cachedWorkflows !== null) return cachedWorkflows;
            if (!loadingPromise) {
                loadingPromise = fetchSavedWorkflows().then(list => {
                    cachedWorkflows = list;
                    return list;
                });
            }
            return loadingPromise;
        };

        // Pre-warm cache in the background immediately so typing 1st letter is instant
        ensureWorkflowsLoaded();

        const updateSelectionHighlight = () => {
            const rows = listEl.querySelectorAll(".comfy-sidebar-wf-picker-item");
            rows.forEach((row, idx) => {
                row.classList.toggle("selected", idx === selectedIdx);
            });
            if (selectedIdx >= 0 && rows[selectedIdx]) {
                rows[selectedIdx].scrollIntoView({ block: "nearest" });
            }
        };

        const resolveTargetTempWf = () => {
            if (resolvedTempWf) return resolvedTempWf;
            const active = app.extensionManager?.workflow?.activeWorkflow;
            if (active && active !== prevWorkflow && isTemporaryWorkflow(active)) {
                return active;
            }
            return isTemporaryWorkflow(active) ? active : null;
        };

        const pickItem = async (item) => {
            const tempWf = resolveTargetTempWf();
            closePicker();
            await replaceUnsavedWithWorkflow(item, tempWf);
        };

        const renderList = async () => {
            const query = input.value.trim();
            if (query.length < 1) {
                currentMatches = [];
                selectedIdx = -1;
                listEl.style.display = "none";
                listEl.replaceChildren();
                return;
            }

            const all = await ensureWorkflowsLoaded();
            if (activeTooltip !== tooltip) return;

            const latestQuery = input.value.trim();
            if (latestQuery.length < 1) {
                listEl.style.display = "none";
                listEl.replaceChildren();
                return;
            }

            currentMatches = filterWorkflows(all, latestQuery);
            listEl.replaceChildren();
            listEl.style.display = "block";

            if (currentMatches.length === 0) {
                selectedIdx = -1;
                const empty = document.createElement("div");
                empty.className = "comfy-sidebar-wf-picker-empty";
                empty.textContent = t("No matching workflows");
                listEl.appendChild(empty);
                return;
            }

            selectedIdx = 0;
            currentMatches.forEach((item, idx) => {
                const row = document.createElement("button");
                row.type = "button";
                row.className = "comfy-sidebar-wf-picker-item" + (idx === 0 ? " selected" : "");

                const nameSpan = document.createElement("span");
                nameSpan.className = "comfy-sidebar-wf-picker-name";
                nameSpan.textContent = item.displayName;
                row.appendChild(nameSpan);

                if (item.folder) {
                    const folderSpan = document.createElement("span");
                    folderSpan.className = "comfy-sidebar-wf-picker-folder";
                    folderSpan.textContent = item.folder;
                    row.appendChild(folderSpan);
                }

                row.addEventListener("mouseenter", () => {
                    selectedIdx = idx;
                    updateSelectionHighlight();
                });

                row.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    pickItem(item);
                });

                listEl.appendChild(row);
            });
        };

        input.addEventListener("input", () => {
            renderList();
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closePicker();
                return;
            }
            if (e.key === "ArrowDown" && currentMatches.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                selectedIdx = (selectedIdx + 1) % currentMatches.length;
                updateSelectionHighlight();
                return;
            }
            if (e.key === "ArrowUp" && currentMatches.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                selectedIdx = (selectedIdx - 1 + currentMatches.length) % currentMatches.length;
                updateSelectionHighlight();
                return;
            }
            if (e.key === "Enter" && currentMatches.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                const chosen = currentMatches[selectedIdx >= 0 ? selectedIdx : 0];
                if (chosen) pickItem(chosen);
                return;
            }
            e.stopPropagation();
        });

        const onPointerDownOutside = (e) => {
            if (!tooltip.contains(e.target)) {
                closePicker();
            }
        };

        const onWindowResize = () => {
            applyCoords(findFallbackAnchorRect() || anchorRect);
        };

        document.addEventListener("pointerdown", onPointerDownOutside, true);
        window.addEventListener("resize", onWindowResize);

        activeCleanup = () => {
            document.removeEventListener("pointerdown", onPointerDownOutside, true);
            window.removeEventListener("resize", onWindowResize);
        };

        activeSession = {
            openedAt: Date.now(),
            attachTempWorkflow(wf) {
                if (wf && isTemporaryWorkflow(wf)) {
                    resolvedTempWf = wf;
                    promptedWorkflows.add(wf);
                }
            }
        };

        // Focus immediately, and re-verify after Vue activates the new tab so focus isn't stolen
        input.focus({ preventScroll: true });
        requestAnimationFrame(() => {
            if (activeTooltip === tooltip && !tooltip.contains(document.activeElement)) {
                input.focus({ preventScroll: true });
            }
        });
    };

    // 1. Pinia workflow store hook (attaches temp workflow to click-opened picker, or opens picker for shortcut/menu)
    let unsubWorkflowAction = null;
    const wfMgr = app.extensionManager?.workflow;
    if (wfMgr && typeof wfMgr.$onAction === "function") {
        unsubWorkflowAction = wfMgr.$onAction(({ name, after, onError }) => {
            if (name === "closeWorkflow") {
                activeCloseCount++;
                after(() => { activeCloseCount = Math.max(0, activeCloseCount - 1); });
                onError(() => { activeCloseCount = Math.max(0, activeCloseCount - 1); });
                return;
            }

            if (name !== "createNewTemporary" && name !== "createTemporary") return;
            if (!getSetting(SettingIds.QUICK_WORKFLOW_PICKER, true)) return;
            if (isReplacing || activeCloseCount > 0 || wfMgr.tabsRestored === false) return;

            const isExplicitNew = name === "createNewTemporary" || Date.now() <= userInitiatedBlankUntil;
            if (!isExplicitNew) return;

            after((createdWf) => {
                const wf = createdWf || wfMgr.activeWorkflow;
                if (!isTemporaryWorkflow(wf)) return;

                // If click handler already opened the picker instantaneously, just attach the created workflow
                if (activeTooltip && activeSession && Date.now() - activeSession.openedAt < 1000) {
                    activeSession.attachTempWorkflow(wf);
                    return;
                }

                // Triggered via hotkey or menu: wait a frame for tab DOM to render, then align edge-to-edge
                requestAnimationFrame(() => {
                    if (!promptedWorkflows.has(wf)) {
                        showPicker(findFallbackAnchorRect(), wf);
                    }
                });
            });
        });
    }

    // 2. Command hook: catches New Blank Workflow from menus or keybindings
    let restoreCmdExecute = null;
    const cmd = app.extensionManager?.command;
    if (cmd && typeof cmd.execute === "function") {
        const origExecute = cmd.execute.bind(cmd);
        const wrappedExecute = function (commandId, ...rest) {
            if (typeof commandId === "string" && /new.*blank.*workflow|new.*workflow/i.test(commandId)) {
                userInitiatedBlankUntil = Date.now() + 1200;
            }
            return origExecute(commandId, ...rest);
        };
        cmd.execute = wrappedExecute;
        restoreCmdExecute = () => {
            if (cmd.execute === wrappedExecute) {
                cmd.execute = origExecute;
            }
        };
    }

    // 3. UI click hook: draws popup immediately at pre-click '+' left edge (0ms delay)
    const onDocumentClick = (e) => {
        if (!getSetting(SettingIds.QUICK_WORKFLOW_PICKER, true)) return;

        const btn = findNewWorkflowButton(e.target);
        if (!btn) return;

        userInitiatedBlankUntil = Date.now() + 1200;
        const rect = btn.getBoundingClientRect();
        const prevWorkflow = app.extensionManager?.workflow?.activeWorkflow || null;

        showPicker({ left: rect.left, bottom: rect.bottom }, null, prevWorkflow);
    };

    document.addEventListener("click", onDocumentClick, true);

    return () => {
        closePicker();
        document.removeEventListener("click", onDocumentClick, true);
        if (typeof unsubWorkflowAction === "function") unsubWorkflowAction();
        if (typeof restoreCmdExecute === "function") restoreCmdExecute();
    };
}