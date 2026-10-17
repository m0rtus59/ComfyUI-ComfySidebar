import { app } from "/scripts/app.js";

let currentLocale = "en";
let translations = {};
let fallbackTranslations = {};

async function fetchLocaleFiles(lang) {
    const data = {};
    for (const file of ["main.json", "settings.json"]) {
        try {
            const url = new URL(`../locales/${lang}/${file}`, import.meta.url).href;
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                Object.assign(data, json);
            }
        } catch (e) {}
    }
    return data;
}

export async function initI18n() {
    try {
        let settingVal = app?.extensionManager?.setting?.get?.("Comfy.Locale")
            || app?.ui?.settings?.getSettingValue?.("Comfy.Locale")
            || app?.extensionManager?.setting?.get?.("Comfy.Locale.Language")
            || app?.ui?.settings?.getSettingValue?.("Comfy.Locale.Language");

        if (!settingVal) {
            try {
                settingVal = localStorage.getItem("Comfy.Settings.Comfy.Locale")
                    || localStorage.getItem("Comfy.Locale");
            } catch (e) {}
        }

        const raw = (settingVal || "en").toLowerCase().replace("_", "-");
        const candidates = [raw];
        const base = raw.split("-")[0];
        if (base !== raw) candidates.push(base);

        currentLocale = candidates[0];
        console.log("[ComfySidebar] Detected locale:", currentLocale);

        // 1. Load English fallback
        fallbackTranslations = await fetchLocaleFiles("en");

        // 2. Load active locale if not English
        if (base !== "en") {
            for (const cand of candidates) {
                const locData = await fetchLocaleFiles(cand);
                if (Object.keys(locData).length > 0) {
                    translations = locData;
                    console.log(`[ComfySidebar] Loaded ${cand} with ${Object.keys(translations).length} translations`);
                    break;
                }
            }
        }
    } catch (e) {
        console.warn("[ComfySidebar] i18n initialization failed", e);
    }
}

export function t(key, vars = {}) {
    if (!key) return "";
    let str = translations[key] || fallbackTranslations[key] || key;
    for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{${k}}`, v);
    }
    return str;
}