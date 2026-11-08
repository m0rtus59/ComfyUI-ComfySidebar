import { app } from "/scripts/app.js";

/**
 * Safely retrieves a setting value from ComfyUI's extension manager or legacy settings.
 */
export function getSetting(id, fallback = undefined) {
    const settings = app.extensionManager?.setting;
    if (settings?.get) {
        const val = settings.get(id);
        if (val !== undefined && val !== null) return val;
    }
    const legacyVal = app.ui?.settings?.getSettingValue?.(id);
    if (legacyVal !== undefined && legacyVal !== null) return legacyVal;
    return fallback;
}

/**
 * Safely sets a setting value across modern extensionManager and legacy UI settings.
 */
export function setSetting(id, value) {
    const settings = app.extensionManager?.setting;
    if (settings?.set) {
        settings.set(id, value);
        return;
    }
    app.ui?.settings?.setSettingValue?.(id, value);
}