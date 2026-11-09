import { SettingIds } from "../core/constants.js";
import { getSetting } from "../core/settings.js";

/**
 * Makes hotkeys work regardless of the active keyboard layout.
 *
 * ComfyUI's keybinding system matches on `KeyboardEvent.key`, which follows the active layout:
 * with a Russian layout, physical Q produces "й", so a binding on "q" never fires.
 * `KeyboardEvent.code` is the physical key ("KeyQ") and does not change with the layout.
 *
 * Strategy: in the capture phase on `window` (which runs before ComfyUI's own `keydown` listener),
 * if `key` is a single non-ASCII character, swallow the event and re-dispatch an identical one
 * whose `key` is the US-QWERTY character for that physical key. Everything downstream (keybindings,
 * LiteGraph shortcuts, other extensions) then sees plain Latin keys.
 *
 * Deliberately NOT touched:
 *  - layouts that already report ASCII keys (QWERTY, AZERTY, Dvorak...), so their users keep
 *    their own mapping;
 *  - text fields (input / textarea / select / contenteditable / LiteGraph property values),
 *    so typing in any language keeps working;
 *  - IME composition;
 *  - named keys such as "Enter", "Escape", "Dead".
 */

// Unshifted / shifted characters of the US-QWERTY layout for non-letter keys.
const SYMBOL_KEYS = {
    Backquote: ["`", "~"],
    Minus: ["-", "_"],
    Equal: ["=", "+"],
    BracketLeft: ["[", "{"],
    BracketRight: ["]", "}"],
    Backslash: ["\\", "|"],
    Semicolon: [";", ":"],
    Quote: ["'", "\""],
    Comma: [",", "<"],
    Period: [".", ">"],
    Slash: ["/", "?"],
    Digit1: ["1", "!"],
    Digit2: ["2", "@"],
    Digit3: ["3", "#"],
    Digit4: ["4", "$"],
    Digit5: ["5", "%"],
    Digit6: ["6", "^"],
    Digit7: ["7", "&"],
    Digit8: ["8", "*"],
    Digit9: ["9", "("],
    Digit0: ["0", ")"]
};

/** Returns the US-QWERTY `key` for the physical key of this event, or null if unknown. */
export function latinKeyFromEvent(e) {
    const letter = /^Key([A-Z])$/.exec(e.code || "");
    if (letter) return e.shiftKey ? letter[1] : letter[1].toLowerCase();

    const pair = SYMBOL_KEYS[e.code];
    if (pair) return e.shiftKey ? pair[1] : pair[0];

    return null;
}

function isSingleNonAsciiChar(key) {
    if (typeof key !== "string") return false;
    const chars = Array.from(key);
    return chars.length === 1 && chars[0].codePointAt(0) > 127;
}

function isTextEntryTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable ||
        // LiteGraph's inline value editors are spans
        (tag === "SPAN" && el.classList.contains("property_value"))
    );
}

export function setupLatinHotkeys() {
    // Events we dispatched ourselves; used to avoid handling them again.
    const synthetic = new WeakSet();

    const handler = (e) => {
        if (synthetic.has(e)) return;
        if (e.isComposing || e.keyCode === 229) return;
        if (!isSingleNonAsciiChar(e.key)) return;
        if (!getSetting(SettingIds.LATIN_HOTKEYS, true)) return;

        const latinKey = latinKeyFromEvent(e);
        if (!latinKey) return;

        const target = e.composedPath?.()[0] ?? e.target;
        if (isTextEntryTarget(target)) return;

        const clone = new KeyboardEvent(e.type, {
            key: latinKey,
            code: e.code,
            location: e.location,
            repeat: e.repeat,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
            keyCode: e.keyCode,
            which: e.which,
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window
        });
        synthetic.add(clone);

        e.stopImmediatePropagation();
        const notPrevented = (target || document).dispatchEvent(clone);
        if (!notPrevented) e.preventDefault();
    };

    window.addEventListener("keydown", handler, true);
    window.addEventListener("keyup", handler, true);

    return () => {
        window.removeEventListener("keydown", handler, true);
        window.removeEventListener("keyup", handler, true);
    };
}
