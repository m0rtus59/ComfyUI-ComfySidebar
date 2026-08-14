import { SidebarOverlay } from "./overlay.js";

// Global helper for code block copying in Markdown view
window.moonCopyCode = function(button) {
    try {
        const container = button.parentElement;
        if (!container) return;
        const codeEl = container.querySelector("code");
        if (!codeEl) return;
        const text = codeEl.innerText;

        navigator.clipboard.writeText(text).then(() => {
            button.innerText = "Copied!";
            button.style.backgroundColor = "#4CAF50";
            button.style.borderColor = "#45a049";
            button.style.color = "#ffffff";
            setTimeout(() => {
                button.innerText = "Copy";
                button.style.backgroundColor = "#333333";
                button.style.borderColor = "#555555";
                button.style.color = "#aaaaaa";
            }, 1500);
        }).catch(() => {
            button.innerText = "Error";
            setTimeout(() => button.innerText = "Copy", 1500);
        });
    } catch (e) {
        button.innerText = "Error";
        setTimeout(() => button.innerText = "Copy", 1500);
    }
};

function parseInlineMarkdown(html) {
    if (!html) return "";
    html = html.replace(/`([^`]+)`/g, '<code style="background:#252525;padding:2px 6px;border-radius:3px;font-family:monospace;color:#e06c75;border:1px solid #333;font-size:12px;">$1</code>');
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong style="color:#ffffff;font-weight:600;"><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#ffffff;font-weight:600;">$1</strong>');
    html = html.replace(/__(.*?)__/g, '<strong style="color:#ffffff;font-weight:600;">$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.*?)_/g, '<em>$1</em>');
    html = html.replace(/~~(.*?)~~/g, '<span style="text-decoration:line-through;color:#888;">$1</span>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#61afef;text-decoration:none;border-bottom:1px dashed #61afef;cursor:pointer;">$1</a>');
    html = html.replace(/\$(?!\s)([^\$]+?)(?<!\s)\$/g, '<span style="font-family:\'Times New Roman\',Times,serif;font-size:14px;color:#e5c07b;font-style:italic;padding:0 2px;">$1</span>');
    return html;
}

function parseMarkdown(text) {
    if (!text) return "";
    let rawLines = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").split("\n");
    let htmlLines = [];
    let inCodeBlock = false, codeContent = [], codeLang = "";
    let inUl = false, inOl = false, inTable = false;
    let tableHeaders = [], tableAlignments = [], tableRows = [];

    function closeUl() { if (inUl) { htmlLines.push("</ul>"); inUl = false; } }
    function closeOl() { if (inOl) { htmlLines.push("</ol>"); inOl = false; } }
    function closeTable() {
        if (inTable) {
            let tableHtml = `<table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:12px;border:1px solid #333;color:#ddd;text-align:left;">`;
            if (tableHeaders.length > 0) {
                tableHtml += `<thead style="background:#1a1a1a;font-weight:600;color:#fff;border-bottom:2px solid #444;"><tr>`;
                for (let i = 0; i < tableHeaders.length; i++) {
                    const align = tableAlignments[i] || 'left';
                    tableHtml += `<th style="padding:8px 12px;border:1px solid #333;text-align:${align};">${parseInlineMarkdown(tableHeaders[i])}</th>`;
                }
                tableHtml += `</tr></thead>`;
            }
            tableHtml += "<tbody>";
            for (let r = 0; r < tableRows.length; r++) {
                const row = tableRows[r];
                const bg = r % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent';
                tableHtml += `<tr style="background:${bg};border-bottom:1px solid #222;">`;
                for (let i = 0; i < tableHeaders.length; i++) {
                    const align = tableAlignments[i] || 'left';
                    tableHtml += `<td style="padding:8px 12px;border:1px solid #333;text-align:${align};">${parseInlineMarkdown(row[i] || '')}</td>`;
                }
                tableHtml += `</tr>`;
            }
            tableHtml += "</tbody></table>";
            htmlLines.push(tableHtml);
            inTable = false;
            tableHeaders = []; tableAlignments = []; tableRows = [];
        }
    }

    for (let line of rawLines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("```")) {
            closeUl(); closeOl(); closeTable();
            if (inCodeBlock) {
                const rCode = codeContent.join("\n");
                const langBadge = codeLang ? `<div style="position:absolute;top:6px;left:10px;color:#85c5ec;font-size:10px;font-family:sans-serif;font-weight:bold;text-transform:uppercase;opacity:0.8;user-select:none;">${codeLang}</div>` : '';
                const btnStyle = "position:absolute;top:6px;right:6px;background:#333;color:#aaa;border:1px solid #555;border-radius:3px;padding:3px 8px;font-size:10px;cursor:pointer;";
                htmlLines.push(`<div class="code-block-container" style="position:relative;margin:8px 0;">${langBadge}<button onclick="window.moonCopyCode(this)" style="${btnStyle}">Copy</button><pre style="background:#1e1e1e;padding:10px;padding-top:28px;border-radius:4px;border:1px solid #333;font-family:monospace;overflow-x:auto;margin:0;color:#85c5ec;"><code>${rCode}</code></pre></div>`);
                codeContent = []; codeLang = ""; inCodeBlock = false;
            } else {
                inCodeBlock = true; codeLang = trimmed.slice(3).trim();
            }
            continue;
        }

        if (inCodeBlock) { codeContent.push(line); continue; }

        if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
            closeUl(); closeOl(); closeTable();
            htmlLines.push(`<hr style="border:0;border-top:1px solid #333;margin:16px 0;">`);
            continue;
        }

        if (trimmed.startsWith("$$") && trimmed.endsWith("$$")) {
            closeUl(); closeOl(); closeTable();
            htmlLines.push(`<div style="text-align:center;margin:12px 0;font-family:'Times New Roman',Times,serif;font-size:16px;color:#e5c07b;background:rgba(255,255,255,0.01);padding:10px;border-radius:4px;border:1px dashed #3e4451;font-style:italic;">${trimmed.slice(2, -2).trim()}</div>`);
            continue;
        }

        if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
            closeUl(); closeOl();
            const isSeparator = /^\|[\s\-\:\s\|]+\|$/.test(trimmed);
            const cells = trimmed.split("|").slice(1, -1).map(c => c.trim());
            if (isSeparator) {
                tableAlignments = cells.map(c => (c.startsWith(":") && c.endsWith(":")) ? "center" : c.endsWith(":") ? "right" : "left");
                inTable = true;
            } else {
                if (!inTable) { tableHeaders = cells; inTable = true; } else { tableRows.push(cells); }
            }
            continue;
        } else { closeTable(); }

        if (trimmed.startsWith(">")) {
            closeUl(); closeOl();
            const match = trimmed.match(/^([>\s]+)(.*)/);
            if (match) {
                const depth = (match[1].match(/>/g) || []).length;
                let quote = parseInlineMarkdown(match[2].trim());
                for (let d = 0; d < depth; d++) {
                    quote = `<blockquote style="border-left:4px solid #4CAF50;margin:6px 0;padding:6px 12px;color:#aaa;font-style:italic;background-color:rgba(255,255,255,0.015);">${quote}</blockquote>`;
                }
                htmlLines.push(quote);
            }
            continue;
        }

        if (line.startsWith("### ")) {
            closeUl(); closeOl();
            htmlLines.push(`<h3 style="margin:12px 0 6px 0;color:#ffffff;font-weight:600;font-size:14px;">${parseInlineMarkdown(line.slice(4))}</h3>`);
            continue;
        } else if (line.startsWith("## ")) {
            closeUl(); closeOl();
            htmlLines.push(`<h2 style="margin:16px 0 8px 0;color:#ffffff;font-weight:600;font-size:16px;border-bottom:1px solid #333;padding-bottom:4px;">${parseInlineMarkdown(line.slice(3))}</h2>`);
            continue;
        } else if (line.startsWith("# ")) {
            closeUl(); closeOl();
            htmlLines.push(`<h1 style="margin:20px 0 10px 0;color:#ffffff;font-weight:700;font-size:18px;border-bottom:2px solid #444;padding-bottom:6px;">${parseInlineMarkdown(line.slice(2))}</h1>`);
            continue;
        }

        const ulMatch = line.match(/^(\s*)([-*])\s(.*)/);
        if (ulMatch) {
            closeUl();
            if (!inUl) { htmlLines.push(`<ul style="margin:8px 0;padding-left:20px;list-style-type:disc;">`); inUl = true; }
            const indent = ulMatch[1].length;
            const content = ulMatch[3].trim();
            const paddingLeft = indent > 0 ? `${indent * 8}px` : "0px";
            if (content.startsWith("[ ]")) {
                htmlLines.push(`<li style="margin-left:${paddingLeft};margin-bottom:4px;color:#ddd;list-style-type:none;"><input type="checkbox" disabled style="margin-right:6px;vertical-align:middle;">${parseInlineMarkdown(content.slice(3).trim())}</li>`);
            } else if (content.toLowerCase().startsWith("[x]")) {
                htmlLines.push(`<li style="margin-left:${paddingLeft};margin-bottom:4px;color:#ddd;list-style-type:none;"><input type="checkbox" checked disabled style="margin-right:6px;vertical-align:middle;">${parseInlineMarkdown(content.slice(3).trim())}</li>`);
            } else {
                htmlLines.push(`<li style="margin-left:${paddingLeft};margin-bottom:4px;color:#ddd;padding-left:4px;">${parseInlineMarkdown(content)}</li>`);
            }
            continue;
        }

        const olMatch = line.match(/^(\s*)(\d+)\.\s(.*)/);
        if (olMatch) {
            closeUl();
            if (!inOl) { htmlLines.push(`<ol style="margin:8px 0;padding-left:24px;list-style-type:decimal;">`); inOl = true; }
            const indent = olMatch[1].length;
            htmlLines.push(`<li style="margin-left:${indent > 0 ? `${indent * 8}px` : "0px"};margin-bottom:4px;color:#ddd;padding-left:4px;">${parseInlineMarkdown(olMatch[3].trim())}</li>`);
            continue;
        }

        if (trimmed === "") {
            closeUl(); closeOl();
            htmlLines.push("<br>");
        } else {
            closeUl(); closeOl();
            htmlLines.push(`<p style="margin:6px 0;color:#ddd;line-height:1.6;">${parseInlineMarkdown(line)}</p>`);
        }
    }
    closeUl(); closeOl(); closeTable();
    return htmlLines.join("\n");
}

export function createTextReader(textData, onSwitchMedia = () => {}, onDestroy = () => {}) {
    let rawText = typeof textData === "object" ? (textData.text || "") : String(textData);
    let pid = typeof textData === "object" ? textData.pid : "";
    let isMarkdownMode = true;

    const overlay = new SidebarOverlay({ onDestroy });

    const readerBox = document.createElement("div");
    Object.assign(readerBox.style, {
        background: "rgba(18, 18, 24, 0.95)", backdropFilter: "blur(12px)",
        border: "1px solid rgba(255, 255, 255, 0.15)", borderRadius: "12px",
        padding: "20px 24px", width: "85%", maxWidth: "840px", height: "80vh",
        boxShadow: "0 12px 40px rgba(0,0,0,0.8)", display: "flex",
        flexDirection: "column", gap: "14px", zIndex: "20"
    });

    const headerRow = document.createElement("div");
    Object.assign(headerRow.style, { display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "12px" });

    const titleInfo = document.createElement("div");
    Object.assign(titleInfo.style, { display: "flex", alignItems: "center", gap: "10px" });
    const title = document.createElement("span");
    title.textContent = pid ? `Text Output #${pid}` : "Text Output";
    Object.assign(title.style, { fontSize: "14px", fontWeight: "bold", color: "#f8fafc", whiteSpace: "nowrap" });

    const statsBadge = document.createElement("span");
    Object.assign(statsBadge.style, { fontSize: "10px", color: "#94a3b8", background: "rgba(255,255,255,0.06)", padding: "3px 8px", borderRadius: "4px", fontFamily: "monospace", whiteSpace: "nowrap" });

    titleInfo.append(title, statsBadge);

    const actionsRow = document.createElement("div");
    Object.assign(actionsRow.style, { display: "flex", gap: "8px", alignItems: "center" });

    const modeBtn = document.createElement("button");
    Object.assign(modeBtn.style, {
        background: "#334155", border: "1px solid #64748b", color: "#f8fafc",
        borderRadius: "6px", padding: "5px 12px", fontSize: "11px", cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px",
        whiteSpace: "nowrap", minWidth: "96px", height: "28px", boxSizing: "border-box"
    });
    modeBtn.innerHTML = `<i class="pi pi-code"></i><span>Markdown</span>`;

    const copyBtn = document.createElement("button");
    Object.assign(copyBtn.style, {
        background: "#1e293b", border: "1px solid #475569", color: "#e2e8f0",
        borderRadius: "6px", padding: "5px 10px", fontSize: "11px", cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px",
        whiteSpace: "nowrap", height: "28px", boxSizing: "border-box"
    });
    copyBtn.innerHTML = `<i class="pi pi-copy"></i><span>Copy</span>`;

    const downloadBtn = document.createElement("button");
    Object.assign(downloadBtn.style, {
        background: "#1e293b", border: "1px solid #475569", color: "#e2e8f0",
        borderRadius: "6px", padding: "5px 10px", fontSize: "11px", cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px",
        whiteSpace: "nowrap", height: "28px", boxSizing: "border-box"
    });
    downloadBtn.innerHTML = `<i class="pi pi-download"></i><span>.txt</span>`;

    actionsRow.append(modeBtn, copyBtn, downloadBtn);
    headerRow.append(titleInfo, actionsRow);

    const textArea = document.createElement("div");
    Object.assign(textArea.style, {
        flex: "1", overflowY: "auto", fontSize: "13px",
        lineHeight: "1.6", color: "#e2e8f0", wordBreak: "break-word",
        userSelect: "text", "-webkit-user-select": "text", background: "rgba(0,0,0,0.35)",
        padding: "16px 20px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)",
        scrollbarWidth: "thin", scrollbarColor: "#475569 rgba(0,0,0,0.2)"
    });

    const updateView = () => {
        const wc = rawText.trim() ? rawText.trim().split(/\s+/).length : 0;
        statsBadge.textContent = `${wc} words • ${rawText.length} chars`;

        if (isMarkdownMode) {
            modeBtn.innerHTML = `<i class="pi pi-code"></i><span>Markdown</span>`;
            modeBtn.style.background = "#3b82f6";
            modeBtn.style.borderColor = "#60a5fa";
            textArea.style.fontFamily = "sans-serif";
            textArea.style.whiteSpace = "normal";
            textArea.innerHTML = parseMarkdown(rawText);
        } else {
            modeBtn.innerHTML = `<i class="pi pi-align-left"></i><span>Raw Text</span>`;
            modeBtn.style.background = "#334155";
            modeBtn.style.borderColor = "#64748b";
            textArea.style.fontFamily = "monospace";
            textArea.style.whiteSpace = "pre-wrap";
            textArea.textContent = rawText;
        }
    };

    modeBtn.onclick = () => {
        isMarkdownMode = !isMarkdownMode;
        updateView();
    };

    copyBtn.onclick = () => {
        navigator.clipboard.writeText(rawText);
        copyBtn.innerHTML = `<i class="pi pi-check" style="color:#10b981;"></i><span style="color:#10b981;">Copied!</span>`;
        setTimeout(() => { copyBtn.innerHTML = `<i class="pi pi-copy"></i><span>Copy</span>`; }, 1800);
    };

    downloadBtn.onclick = () => {
        const blob = new Blob([rawText], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `output_${pid || "text"}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    updateView();

    readerBox.append(headerRow, textArea);
    overlay.container.appendChild(readerBox);

    return {
        isText: true,
        loadTarget(targetData) {
            if (typeof targetData !== "object" || !targetData.text) {
                overlay.destroy();
                onSwitchMedia(targetData);
                return;
            }
            rawText = targetData.text || "";
            pid = targetData.pid || "";
            title.textContent = pid ? `Text Output #${pid}` : "Text Output";
            updateView();
        },
        destroy: () => overlay.destroy()
    };
}