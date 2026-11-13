import { app } from "/scripts/app.js";

let currentLocale = "en";
let currentSettingRaw = null;
let loadSeq = 0;
let translations = {};
let fallbackTranslations = {};
let fallbackLoaded = false;
const localeCache = new Map();
const localeListeners = new Set();

function detectRawLocale() {
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

    return (settingVal || "en").toLowerCase().replace("_", "-");
}

async function fetchLocaleFiles(lang) {
    if (localeCache.has(lang)) {
        return localeCache.get(lang);
    }

    const data = {};
    for (const file of ["main.json"]) {
        try {
            const url = `/comfy-sidebar/locales/${encodeURIComponent(lang)}/${file}`;
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                Object.assign(data, json);
            }
        } catch (e) {}
    }

    localeCache.set(lang, data);
    return data;
}

export async function initI18n() {
    const seq = ++loadSeq;
    try {
        const raw = detectRawLocale();
        const candidates = [raw];
        const base = raw.split("-")[0];
        if (base !== raw) candidates.push(base);

        currentSettingRaw = raw;
        currentLocale = candidates[0];

        // 1. Load English fallback once
        if (!fallbackLoaded) {
            const fb = await fetchLocaleFiles("en");
            if (seq !== loadSeq) return;
            fallbackTranslations = fb;
            fallbackLoaded = true;
        }

        // 2. Load active locale if not English (and clear previous locale if switching back to English)
        let nextTranslations = {};
        if (base !== "en") {
            for (const cand of candidates) {
                const locData = await fetchLocaleFiles(cand);
                if (seq !== loadSeq) return;
                if (Object.keys(locData).length > 0) {
                    nextTranslations = locData;
                    break;
                }
            }
        }

        if (seq !== loadSeq) return;
        translations = nextTranslations;
    } catch (e) {
        console.warn("[ComfySidebar] i18n initialization failed", e);
    }
}

export function onLocaleChange(callback) {
    if (typeof callback !== "function") return () => {};
    localeListeners.add(callback);
    return () => localeListeners.delete(callback);
}

export function setupLocaleWatcher() {
    const cleanups = [];

    const checkAndReload = () => {
        const nextRaw = detectRawLocale();
        if (nextRaw !== currentSettingRaw) {
            initI18n().then(() => {
                for (const fn of localeListeners) {
                    try { fn(currentLocale); } catch (e) {}
                }
            });
        }
    };

    const settingStore = app?.extensionManager?.setting?.settingStore;
    if (settingStore?.$subscribe) {
        const unsub = settingStore.$subscribe(() => {
            checkAndReload();
        });
        cleanups.push(unsub);
    }

    for (const key of ["Comfy.Locale", "Comfy.Locale.Language"]) {
        const settingObj =
            app?.ui?.settings?.settings?.[key] ||
            app?.extensionManager?.setting?.settings?.[key];
        if (settingObj && !settingObj._comfySidebarLocaleWatched) {
            settingObj._comfySidebarLocaleWatched = true;
            const origOnChange = settingObj.onChange;
            settingObj.onChange = (val) => {
                if (origOnChange) origOnChange(val);
                checkAndReload();
            };
            cleanups.push(() => {
                settingObj.onChange = origOnChange;
                delete settingObj._comfySidebarLocaleWatched;
            });
        }
    }

    return () => {
        cleanups.forEach(fn => {
            try { if (typeof fn === "function") fn(); } catch (e) {}
        });
    };
}

export function t(key, vars = {}) {
    if (!key) return "";
    const locVal = typeof translations[key] === "string" ? translations[key] : null;
    const fbVal = typeof fallbackTranslations[key] === "string" ? fallbackTranslations[key] : null;
    let str = locVal || fbVal || key;
    for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{${k}}`, v);
    }
    return str;
}