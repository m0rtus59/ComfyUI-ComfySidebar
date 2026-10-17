import { app } from "/scripts/app.js";

let currentLocale = "en";
let translations = {};
let fallbackTranslations = {};

/**
 * Initializes the localization engine by reading ComfyUI's language setting
 * and dynamically loading the corresponding JSON dictionary.
 */
export async function initI18n() {
    try {
        // ComfyUI's internal setting ID is "Comfy.Locale"
        let settingVal = app?.extensionManager?.setting?.get?.("Comfy.Locale")
            || app?.ui?.settings?.getSettingValue?.("Comfy.Locale")
            || app?.extensionManager?.setting?.get?.("Comfy.Locale.Language")
            || app?.ui?.settings?.getSettingValue?.("Comfy.Locale.Language");

        // Fallback check in localStorage in case settings API hasn't populated yet
        if (!settingVal) {
            try {
                settingVal = localStorage.getItem("Comfy.Settings.Comfy.Locale")
                    || localStorage.getItem("Comfy.Locale");
            } catch (e) {}
        }

        const raw = (settingVal || "en").toLowerCase().replace("_", "-");
        // Check regional locale first (e.g. "zh-tw", "pt-br"), then base ("zh", "pt")
        const candidates = [raw];
        const base = raw.split("-")[0];
        if (base !== raw) candidates.push(base);

        currentLocale = candidates[0];
        console.log("[ComfySidebar] Detected locale:", currentLocale);

        // 1. Load English fallback dictionary
        try {
            const enUrl = new URL("../locales/en.json", import.meta.url).href;
            const enRes = await fetch(enUrl);
            if (enRes.ok) {
                fallbackTranslations = await enRes.json();
            }
        } catch (e) {
            console.warn("[ComfySidebar] Failed to load en.json fallback", e);
        }

        // 2. If language is not English, load target locale
        if (base !== "en") {
            let loaded = false;
            for (const cand of candidates) {
                try {
                    const locUrl = new URL(`../locales/${cand}.json`, import.meta.url).href;
                    const locRes = await fetch(locUrl);
                    if (locRes.ok) {
                        translations = await locRes.json();
                        console.log(`[ComfySidebar] Loaded ${cand}.json with`, Object.keys(translations).length, "translations");
                        loaded = true;
                        break;
                    }
                } catch (e) {}
            }
            if (!loaded) {
                console.warn(`[ComfySidebar] No translation file found for: ${candidates.join(" / ")}`);
            }
        }
    } catch (e) {
        console.warn("[ComfySidebar] i18n initialization failed", e);
    }
}

/**
 * Translate a phrase.
 * If translation is missing in current language, falls back to English.
 * If missing in English too, returns the original text.
 */
export function t(key, vars = {}) {
    if (!key) return "";
    let str = translations[key] || fallbackTranslations[key] || key;
    for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{${k}}`, v);
    }
    return str;
}