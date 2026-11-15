import { t } from "../core/i18n.js";

/**
 * Shown when a file could not be moved to the Recycle Bin / Trash.
 *
 * Resolves to one of:
 *  - "permanent": the user wants direct (permanent) deletion turned on and used for this file
 *  - "retry":     the user fixed the trash problem and wants to try again
 *  - "cancel":    nothing is deleted
 *
 * `code` is "trash_unavailable" (send2trash is not installed) or "trash_failed" (it raised).
 */
export function askTrashFallback({ filename = "", code = "trash_failed", error = "", python = "" } = {}) {
    return new Promise((resolve) => {
        const previouslyFocused = document.activeElement;
        const titleId = "comfy-sidebar-trash-dialog-title";

        const backdrop = document.createElement("div");
        Object.assign(backdrop.style, {
            position: "fixed", inset: "0", zIndex: "100000",
            background: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(2px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "16px"
        });

        const box = document.createElement("div");
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-modal", "true");
        box.setAttribute("aria-labelledby", titleId);
        Object.assign(box.style, {
            width: "min(480px, 100%)", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box",
            padding: "20px 22px", borderRadius: "12px", display: "flex", flexDirection: "column", gap: "12px",
            background: "var(--card, var(--secondary, var(--p-surface-800, #181818)))",
            color: "var(--foreground, var(--fg-color, #eee))",
            border: "1px solid var(--border, var(--border-color, rgba(255, 255, 255, 0.15)))",
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)", fontSize: "13px", lineHeight: "1.5"
        });

        const title = document.createElement("div");
        title.id = titleId;
        title.textContent = t("Couldn't move the file to the Recycle Bin");
        Object.assign(title.style, { fontSize: "15px", fontWeight: "600" });

        const intro = document.createElement("div");
        intro.textContent = t("Could not move \"{filename}\" to the Recycle Bin / Trash.", { filename });
        intro.style.wordBreak = "break-word";

        const hint = document.createElement("div");
        hint.style.opacity = "0.85";
        const detailBlocks = [];

        if (code === "trash_unavailable") {
            hint.textContent = t("The send2trash package is not installed in ComfyUI's Python environment. To fix it, run this command and restart ComfyUI:");
            const cmd = document.createElement("code");
            cmd.textContent = `"${python || "python"}" -m pip install send2trash`;
            detailBlocks.push(cmd);
        } else {
            hint.textContent = t("The system trash can't be used for this file (for example a drive or network share without a trash folder, or a Linux session without a desktop trash). Fix that and try again.");
            if (error) {
                const detail = document.createElement("code");
                detail.textContent = error;
                detailBlocks.push(detail);
            }
        }
        for (const block of detailBlocks) {
            Object.assign(block.style, {
                display: "block", padding: "8px 10px", borderRadius: "6px", fontFamily: "monospace",
                fontSize: "12px", whiteSpace: "pre-wrap", wordBreak: "break-all", userSelect: "all",
                background: "rgba(0, 0, 0, 0.3)", border: "1px solid var(--border, rgba(255, 255, 255, 0.12))"
            });
        }

        const note = document.createElement("div");
        note.textContent = t("Direct deletion removes files permanently, bypassing the Recycle Bin. You can change this later in Settings \u2192 Comfy Sidebar.");
        Object.assign(note.style, { fontSize: "12px", opacity: "0.65" });

        const actions = document.createElement("div");
        Object.assign(actions.style, { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px", marginTop: "4px" });

        const makeButton = (label, kind, result) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = label;
            const colors = kind === "danger"
                ? { bg: "rgba(239, 68, 68, 0.15)", border: "#ef4444", fg: "#fca5a5" }
                : kind === "primary"
                    ? { bg: "var(--primary, var(--p-primary-color, #a855f7))", border: "transparent", fg: "#fff" }
                    : { bg: "transparent", border: "var(--border, rgba(255, 255, 255, 0.2))", fg: "inherit" };
            Object.assign(btn.style, {
                padding: "7px 14px", borderRadius: "8px", cursor: "pointer", fontSize: "13px",
                background: colors.bg, border: `1px solid ${colors.border}`, color: colors.fg
            });
            btn.onclick = () => finish(result);
            return btn;
        };

        const btnPermanent = makeButton(t("Turn on direct deletion"), "danger", "permanent");
        const btnRetry = makeButton(t("Try again"), "primary", "retry");
        const btnCancel = makeButton(t("Cancel"), "neutral", "cancel");
        actions.append(btnPermanent, btnRetry, btnCancel);

        box.append(title, intro, hint, ...detailBlocks, note, actions);
        backdrop.appendChild(box);

        let done = false;
        const focusables = [btnPermanent, btnRetry, btnCancel];

        const onKeyDown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                finish("cancel");
            } else if (e.key === "Tab") {
                // Keep keyboard focus inside the dialog
                const idx = focusables.indexOf(document.activeElement);
                const next = e.shiftKey
                    ? (idx <= 0 ? focusables.length - 1 : idx - 1)
                    : (idx === focusables.length - 1 ? 0 : idx + 1);
                e.preventDefault();
                focusables[next].focus();
            } else {
                // Don't let ComfyUI hotkeys (Delete, Ctrl+Z, ...) act on the canvas behind the dialog
                e.stopPropagation();
            }
        };

        function finish(result) {
            if (done) return;
            done = true;
            document.removeEventListener("keydown", onKeyDown, true);
            backdrop.remove();
            try { previouslyFocused?.focus?.({ preventScroll: true }); } catch (e) { /* element may be gone */ }
            resolve(result);
        }

        backdrop.addEventListener("pointerdown", (e) => {
            if (e.target === backdrop) finish("cancel");
        });
        document.addEventListener("keydown", onKeyDown, true);
        document.body.appendChild(backdrop);
        btnRetry.focus({ preventScroll: true });
    });
}
