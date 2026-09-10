import { PromptStatus, StoreEvents } from "./constants.js";
import { createPromptState, revokePromptBlobs } from "./promptState.js";
import { PersistenceAdapter } from "./persistence.js";

class Store {
    constructor() {
        this.prompts = new Map();
        this.ui = {
            searchQuery: "",
            currentlyActivePromptId: null,
            activeSubmenuPromptId: null,
            activeSubmenuBatchImages: null,
            mainQueueScrollTop: null,
            sequenceNumber: 0,
            sidebarContainer: null,
            cardStack: null
        };
        this.listeners = new Map();
        this._saveTimer = null;
        this.init();
    }

    init() {
        const saved = PersistenceAdapter.load();
        for (const item of saved) {
            const state = createPromptState(item.pid, item);
            this.prompts.set(String(state.pid), state);
            if (state.timestamp > this.ui.sequenceNumber) {
                this.ui.sequenceNumber = state.timestamp;
            }
        }
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(callback);
        }
    }

    emit(event, payload) {
        if (this.listeners.has(event)) {
            for (const callback of this.listeners.get(event)) {
                try {
                    callback(payload);
                } catch (err) {
                    console.error(`Store error during event '${event}':`, err);
                }
            }
        }
    }

    nextSequence() {
        return ++this.ui.sequenceNumber;
    }

    scheduleSave(delay = 250) {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            PersistenceAdapter.save(this.prompts);
        }, delay);
    }

    getPrompt(pid) {
        return this.prompts.get(String(pid)) || null;
    }

    hasPrompt(pid) {
        return this.prompts.has(String(pid));
    }

    getAllPrompts() {
        return Array.from(this.prompts.values());
    }

    setPrompt(pid, state) {
        const key = String(pid);
        const isNew = !this.prompts.has(key);
        this.prompts.set(key, state);
        this.scheduleSave();
        this.emit(isNew ? StoreEvents.PROMPT_ADDED : StoreEvents.PROMPT_UPDATED, { pid: key, prompt: state });
        return state;
    }

    updatePrompt(pid, patch) {
        const key = String(pid);
        const state = this.prompts.get(key);
        if (!state) return null;
        Object.assign(state, patch);
        this.scheduleSave();
        this.emit(StoreEvents.PROMPT_UPDATED, { pid: key, prompt: state, patch });
        return state;
    }

    deletePrompt(pid) {
        const key = String(pid);
        const state = this.prompts.get(key);
        if (state) {
            revokePromptBlobs(state);
            this.prompts.delete(key);
            if (this.ui.currentlyActivePromptId === key) {
                this.ui.currentlyActivePromptId = null;
            }
            if (this.ui.activeSubmenuPromptId === key) {
                this.ui.activeSubmenuPromptId = null;
            }
            this.scheduleSave();
            this.emit(StoreEvents.PROMPT_DELETED, { pid: key });
            return true;
        }
        return false;
    }

    pruneHistory(maxItems = 64) {
        const candidates = PersistenceAdapter.getPruneCandidates(this.prompts, maxItems);
        for (const pid of candidates) {
            this.deletePrompt(pid);
        }
    }

    clearFinished() {
        const toDelete = [];
        for (const [pid, state] of this.prompts.entries()) {
            if (state.status !== PromptStatus.PENDING && state.status !== PromptStatus.ACTIVE) {
                toDelete.push(pid);
            }
        }
        for (const pid of toDelete) {
            this.deletePrompt(pid);
        }
        this.emit(StoreEvents.PROMPTS_CLEARED, { count: toDelete.length });
        return toDelete;
    }

    clearCancelledOrFailed() {
        const toDelete = [];
        for (const [pid, state] of this.prompts.entries()) {
            if (state.status === PromptStatus.CANCELLED || state.status === PromptStatus.ERROR) {
                toDelete.push(pid);
            }
        }
        for (const pid of toDelete) {
            this.deletePrompt(pid);
        }
        this.emit(StoreEvents.PROMPTS_CLEARED, { count: toDelete.length });
        return toDelete;
    }

    setSearchQuery(query) {
        this.ui.searchQuery = (query || "").trim();
        this.emit(StoreEvents.SEARCH_CHANGED, { query: this.ui.searchQuery });
    }

    setActivePromptId(pid) {
        this.ui.currentlyActivePromptId = pid ? String(pid) : null;
        this.emit(StoreEvents.ACTIVE_PROMPT_CHANGED, { pid: this.ui.currentlyActivePromptId });
    }

    openBatchSubmenu(batchInfo) {
        this.ui.activeSubmenuBatchImages = batchInfo;
        this.ui.activeSubmenuPromptId = null;
        this.emit(StoreEvents.SUBMENU_CHANGED, { type: "batch", data: batchInfo });
    }

    openOutputsSubmenu(pid) {
        this.ui.activeSubmenuPromptId = String(pid);
        this.ui.activeSubmenuBatchImages = null;
        this.emit(StoreEvents.SUBMENU_CHANGED, { type: "outputs", pid: this.ui.activeSubmenuPromptId });
    }

    closeSubmenu() {
        const hadSubmenu = this.ui.activeSubmenuPromptId !== null || this.ui.activeSubmenuBatchImages !== null;
        this.ui.activeSubmenuPromptId = null;
        this.ui.activeSubmenuBatchImages = null;
        if (hadSubmenu) {
            this.emit(StoreEvents.SUBMENU_CHANGED, { type: null });
        }
    }
}

export const store = new Store();
