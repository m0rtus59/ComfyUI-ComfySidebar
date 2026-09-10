export const PromptStatus = Object.freeze({
    PENDING: "pending",
    ACTIVE: "active",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
    ERROR: "error"
});

export const StoreEvents = Object.freeze({
    PROMPT_ADDED: "prompt:added",
    PROMPT_UPDATED: "prompt:updated",
    PROMPT_DELETED: "prompt:deleted",
    PROMPTS_CLEARED: "prompts:cleared",
    ACTIVE_PROMPT_CHANGED: "activePrompt:changed",
    SEARCH_CHANGED: "search:changed",
    SUBMENU_CHANGED: "submenu:changed",
    QUEUE_SYNCED: "queue:synced"
});

export const SettingIds = Object.freeze({
    GRID_COLUMNS_THRESHOLD: "Comfy Sidebar.Grid Columns Threshold",
    SHOW_PENDING_COUNT_ONLY: "Comfy Sidebar.Show Pending Count Only",
    SHOW_WORKING_NODE_NAME: "Comfy Sidebar.Show Working Node Name",
    AUTO_CLEAR_INTERRUPTED: "Comfy Sidebar.Auto Clear Interrupted",
    OVERRIDE_STOCK_HISTORY: "Comfy Sidebar.Hide Junk.Override Stock Job History Tab",
    HIDE_GRAPH_BUTTON: "Comfy Sidebar.Hide Junk.Graph Button",
    CLASSIC_LAYOUT: "Comfy Sidebar.Comfy Layout",
    MAX_HISTORY_ITEMS: "Comfy.Queue.MaxHistoryItems",
    DOCK_QUEUE: "Comfy.Queue.QPOV2",
    SHOW_PROGRESS_BAR: "Comfy.Queue.ShowRunProgressBar",
    TAB_POSITION: "Comfy.Workflow.WorkflowTabsPosition"
});
