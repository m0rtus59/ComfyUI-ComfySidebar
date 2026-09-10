import { parseWorkflow } from "../utils/utils.js";
import { PromptStatus } from "../core/constants.js";

export function normalizeQueueItem(p, defaultIndex = 0) {
    let pid = null;
    let seq = defaultIndex;
    let rawWorkflow = null;
    let outputs = {};

    if (Array.isArray(p)) {
        seq = typeof p[0] === "number" ? p[0] : defaultIndex;
        pid = p[1] ? String(p[1]) : null;
        const extraData = p[3] || {};
        rawWorkflow = extraData.extra_pnginfo?.workflow || extraData.workflow || null;
        outputs = p[4] || {};
    } else if (p && typeof p === "object") {
        pid = (p.prompt_id || p.id || p.uuid) ? String(p.prompt_id || p.id || p.uuid) : null;
        seq = typeof p.number === "number" ? p.number : (typeof p.prompt_number === "number" ? p.prompt_number : defaultIndex);
        const extraData = p.extra_data || {};
        rawWorkflow = extraData.extra_pnginfo?.workflow || extraData.workflow || null;
        outputs = p.outputs || {};
    }

    return {
        pid,
        seq,
        workflow: parseWorkflow(rawWorkflow),
        outputs
    };
}

export function normalizeHistoryItem(pidKey, rawData) {
    const pid = String(pidKey);
    let item = rawData;

    if (Array.isArray(item)) {
        item = {
            prompt: item[0],
            outputs: item[1] || {},
            status: item[2] || {}
        };
    } else if (!item || typeof item !== "object") {
        item = { outputs: {}, status: {} };
    }

    const extraData = item.extra_data || item.prompt?.[3] || {};
    const rawWf = extraData.extra_pnginfo?.workflow || extraData.workflow || null;
    const workflow = parseWorkflow(rawWf);
    const outputs = item.outputs || {};
    const queueNumber = item.prompt?.[0] ?? 0;

    const serverStatus = item.status?.status_str || "completed";
    const isInterrupted = serverStatus === "interrupted" ||
        (item.status?.messages && JSON.stringify(item.status.messages).toLowerCase().includes("interrupted"));

    let status = PromptStatus.COMPLETED;
    if (serverStatus === "success" || serverStatus === "completed") {
        status = PromptStatus.COMPLETED;
    } else if (isInterrupted) {
        status = PromptStatus.CANCELLED;
    } else if (serverStatus === "error") {
        status = PromptStatus.ERROR;
    } else {
        status = PromptStatus.CANCELLED;
    }

    return {
        pid,
        queueNumber,
        workflow,
        outputs,
        status,
        serverStatus
    };
}
