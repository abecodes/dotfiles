// _shared/deck — the generic, pure deck SHELL shared by any command that emits
// an HTML slide deck. Knows nothing about findings. Mirrors the deck contract
// in prompts/retro.md: one self-contained offline file, no CDN, dark default +
// `t` light toggle, arrow/space nav, `?` help, slide counter + progress bar,
// and `@media print` one-slide-per-page.

/** Severity → accent color. Shared by every consumer for consistent badges. */
export const SEVERITY_PALETTE = {
	BLOCKER: "#e5484d",
	CRITICAL: "#f76808",
	HIGH: "#ffb224",
	MEDIUM: "#f5d90a",
	LOW: "#8b97a8",
};

/** Escape text for safe insertion into HTML element content / attributes. */
export function escapeHtml(s) {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Theme + layout CSS (dark default; `[data-theme=light]` palette flip). */
export function themeCss() {
	const sev = Object.entries(SEVERITY_PALETTE)
		.map(([k, v]) => `--sev-${k.toLowerCase()}: ${v};`)
		.join("\n  ");
	return `
:root {
  --bg: #0e1116; --fg: #e6edf3; --muted: #8b97a8; --panel: #161b22;
  --border: #30363d; --accent: #58a6ff; --code-bg: #0a0d12;
  --chip-good: #3fb950; --chip-warn: #ffb224; --chip-danger: #e5484d;
  --chip-info: #58a6ff; --chip-muted: #8b97a8;
  ${sev}
}
[data-theme="light"] {
  --bg: #fbfcfd; --fg: #1c2128; --muted: #57606a; --panel: #ffffff;
  --border: #d0d7de; --accent: #0969da; --code-bg: #f4f6f8;
  --chip-good: #1a7f37; --chip-warn: #9a6700; --chip-danger: #cf222e;
  --chip-info: #0969da; --chip-muted: #57606a;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--bg); color: var(--fg);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
#deck { height: 100vh; }
.slide {
  display: none; flex-direction: column; gap: 18px; position: relative;
  height: 100vh; padding: 48px 64px 64px; overflow: auto;
}
.copy-btn {
  position: fixed; top: 14px; right: 16px; z-index: 6;
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px;
  font: 600 12px/1.4 inherit; color: var(--muted); background: var(--panel);
  border: 1px solid var(--border); border-radius: 999px; cursor: pointer;
  caret-color: transparent; user-select: none;
}
.copy-btn:hover { color: var(--fg); border-color: var(--accent); }
.copy-btn.copied { color: var(--chip-good); border-color: var(--chip-good); }
.slide.active { display: flex; }
.slide-header { font-size: 14px; color: var(--muted); letter-spacing: .04em; }
.slide-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 16px; }
h1 { font-size: 38px; margin: 0; }
h2 { font-size: 26px; margin: 0 0 8px; }
h3 { font-size: 18px; margin: 0 0 6px; }
p { margin: 0 0 10px; }
.muted { color: var(--muted); }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre, .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
pre {
  background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px 14px; overflow: auto; font-size: 13px; margin: 0;
}
.big { font-size: 64px; font-weight: 700; line-height: 1.1; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.card {
  background: var(--panel); border: 1px solid var(--border); border-left-width: 4px;
  border-radius: 8px; padding: 14px 16px;
}
.card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.card-title { font-weight: 600; margin-bottom: 4px; }
.card-meta, .card-body { font-size: 13px; color: var(--muted); }
.badge {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  font-size: 12px; font-weight: 700; letter-spacing: .03em; color: #0e1116;
}
.chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
  border: 1px solid var(--border); border-radius: 999px; font-size: 12px;
  font-weight: 700; letter-spacing: .02em; line-height: 1.5; color: var(--fg);
  background: color-mix(in srgb, var(--chip-muted) 18%, transparent);
}
.chip.good { border-color: var(--chip-good); color: var(--chip-good); background: color-mix(in srgb, var(--chip-good) 14%, transparent); }
.chip.warn { border-color: var(--chip-warn); color: var(--chip-warn); background: color-mix(in srgb, var(--chip-warn) 16%, transparent); }
.chip.danger { border-color: var(--chip-danger); color: var(--chip-danger); background: color-mix(in srgb, var(--chip-danger) 14%, transparent); }
.chip.info { border-color: var(--chip-info); color: var(--chip-info); background: color-mix(in srgb, var(--chip-info) 14%, transparent); }
.chip.muted { border-color: var(--chip-muted); color: var(--chip-muted); }
.chips { display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; flex: 1; min-height: 0; }
.col { display: flex; flex-direction: column; gap: 8px; overflow: auto; min-height: 0; }
.col h3 { color: var(--muted); }
.stacked-panels { display: grid; grid-template-rows: 1fr 1fr; gap: 12px; min-height: 0; height: 100%; }
.panel { border: 1px solid var(--border); border-radius: 10px; padding: 12px; overflow: auto; background: color-mix(in srgb, var(--panel) 82%, transparent); }
.panel-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: var(--muted); }
.rowfull { border-top: 1px solid var(--border); padding-top: 14px; overflow: auto; }
.kv { color: var(--muted); }
.histo { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.histo span { font-weight: 700; }
table.grid { border-collapse: collapse; width: 100%; }
table.grid th, table.grid td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; font-size: 14px; }
table.grid th { color: var(--muted); font-weight: 600; }
ul.checks { list-style: none; padding-left: 0; }
ul.checks li::before { content: "☐ "; color: var(--muted); }
#hud {
  position: fixed; bottom: 10px; right: 14px; font-size: 12px;
  color: var(--muted); font-family: ui-monospace, monospace;
}
#progress { position: fixed; bottom: 0; left: 0; right: 0; height: 3px; background: transparent; }
#progressbar { height: 100%; width: 0; background: var(--accent); transition: width .15s; }
#help {
  position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
  background: rgba(0,0,0,.6); z-index: 10;
}
#help.show { display: flex; }
#help .box { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 24px 32px; }
`;
}

/** @media print: stack every slide, one per page. */
export function printCss() {
	return `
@media print {
  #hud, #progress, #help, .copy-btn { display: none !important; }
  .slide { display: flex !important; height: auto; min-height: 100vh; page-break-after: always; break-after: page; }
}`;
}

/** Keyboard navigation + theme toggle + help overlay + progress, all inline. */
export function navJs() {
	return `
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var i = 0;
  var counter = document.getElementById('counter');
  var bar = document.getElementById('progressbar');
  function show(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function (s, k) { s.classList.toggle('active', k === i); });
    if (counter) counter.textContent = (i + 1) + ' / ' + slides.length;
    if (bar) bar.style.width = ((i + 1) / slides.length * 100) + '%';
    var a = slides[i]; if (a) a.scrollTop = 0;
  }
  function toggleHelp() { document.getElementById('help').classList.toggle('show'); }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { show(i + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { show(i - 1); e.preventDefault(); }
    else if (e.key === 'Home') { show(0); }
    else if (e.key === 'End') { show(slides.length - 1); }
    else if (e.key === 't' || e.key === 'T') {
      var h = document.documentElement;
      h.setAttribute('data-theme', h.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    }
    else if (e.key === '?') { toggleHelp(); }
    else if (e.key === 'Escape') { document.getElementById('help').classList.remove('show'); }
    else if (/^[0-9]$/.test(e.key)) { var t = document.getElementById('slide-' + e.key); if (t) show(slides.indexOf(t)); }
  });
  document.addEventListener('click', function (e) {
    var jump = e.target.closest('[data-jump]');
    if (jump) { var t = document.getElementById(jump.getAttribute('data-jump')); if (t) show(slides.indexOf(t)); }
  });
  show(0);
})();
`;
}

/** Clipboard wiring for `.copy-btn` (click) and the `c` shortcut (active slide).
 *  Uses navigator.clipboard with a textarea/execCommand fallback for file:// . */
export function copyJs() {
	return `
(function () {
  function flash(btn) {
    if (!btn) return;
    var prev = btn.textContent;
    btn.classList.add('copied'); btn.textContent = '\u2713 Copied';
    setTimeout(function () { btn.classList.remove('copied'); btn.textContent = prev; }, 1400);
  }
  function fallback(text, btn) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); flash(btn); } catch (e) {}
    document.body.removeChild(ta);
  }
  function copy(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(btn); }, function () { fallback(text, btn); });
    } else { fallback(text, btn); }
  }
  function src(btn) { try { return JSON.parse(btn.getAttribute('data-copy')); } catch (e) { return ''; } }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy-btn');
    if (btn) { e.preventDefault(); copy(src(btn), btn); }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      var btn = document.querySelector('.slide.active .copy-btn');
      if (btn) { e.preventDefault(); copy(src(btn), btn); }
    }
  });
})();
`;
}

/**
 * A single `<section class="slide">`. When `copy` (a plain-text payload, e.g.
 * pre-formatted Markdown) is supplied, the slide grows a fixed "Copy MD" button
 * that writes that exact text to the clipboard (see copyJs). The shell stays
 * domain-agnostic — callers format the payload from their own structured data.
 */
export function slide({ id, header, body, copy = "" }) {
	const h = header ? `<div class="slide-header">${header}</div>` : "";
	const btn = copy
		? `<button type="button" class="copy-btn" title="Copy this slide as Markdown (c)" data-copy="${escapeHtml(JSON.stringify(String(copy)))}">\u29c9 Copy MD</button>`
		: "";
	return `<section class="slide" id="${escapeHtml(id)}">${btn}${h}<div class="slide-body">${body}</div></section>`;
}

/** File extension → Markdown fence language hint. Deliberately small. */
const FENCE_LANG = {
	go: "go", ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
	py: "python", rb: "ruby", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
	c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php",
	sh: "bash", bash: "bash", sql: "sql", proto: "proto",
	yaml: "yaml", yml: "yaml", json: "json", toml: "toml", md: "markdown", html: "html", css: "css",
};

/** Infer a Markdown fence language from a file path's extension ("" if unknown). */
export function langFor(path) {
	const ext = String(path ?? "").split(".").pop()?.toLowerCase() ?? "";
	return FENCE_LANG[ext] || "";
}

/** Wrap text in a Markdown code fence long enough to escape any inner backticks. */
export function mdFence(text, lang = "") {
	const t = String(text ?? "").replace(/\n+$/, "");
	if (!t.trim()) return "";
	const longest = (t.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
	const ticks = "`".repeat(Math.max(3, longest + 1));
	return `${ticks}${lang}\n${t}\n${ticks}`;
}

/** A severity-accented card. */
export function card({ badge = "", title = "", meta = "", body = "", accent = "", jump = "" }) {
	const style = accent ? ` style="border-left-color:${accent}"` : "";
	const attr = jump ? ` data-jump="${escapeHtml(jump)}"` : "";
	const m = meta ? `<span class="card-meta">${meta}</span>` : "";
	const b = body ? `<div class="card-body">${body}</div>` : "";
	return `<div class="card"${style}${attr}><div class="card-top">${badge}${m}</div><div class="card-title">${title}</div>${b}</div>`;
}

/** A pill badge colored by severity. */
export function badge(severity) {
	const sev = String(severity ?? "").toUpperCase();
	const color = SEVERITY_PALETTE[sev] || SEVERITY_PALETTE.LOW;
	return `<span class="badge" style="background:${color}">${escapeHtml(sev)}</span>`;
}

/** A reusable status/model chip. Use `jump` for intra-deck slide links. */
export function chip(label, { tone = "muted", jump = "", title = "" } = {}) {
	const cls = ["chip", tone].filter(Boolean).join(" ");
	const attrs = [jump ? `data-jump="${escapeHtml(jump)}"` : "", title ? `title="${escapeHtml(title)}"` : ""].filter(Boolean).join(" ");
	return `<span class="${escapeHtml(cls)}"${attrs ? ` ${attrs}` : ""}>${escapeHtml(label)}</span>`;
}

/** Two-column layout helper used by review/simplify detail slides. */
export function splitColumns({ left = "", right = "", leftTitle = "", rightTitle = "" }) {
	const lh = leftTitle ? `<h3>${escapeHtml(leftTitle)}</h3>` : "";
	const rh = rightTitle ? `<h3>${escapeHtml(rightTitle)}</h3>` : "";
	return `<div class="cols"><div class="col">${lh}${left}</div><div class="col">${rh}${right}</div></div>`;
}

/** Vertically stacked panels, useful for comparing model suggestions. */
export function stackedPanels(panels) {
	return `<div class="stacked-panels">${panels
		.map((p) => `<div class="panel"><div class="panel-head">${p.chip || ""}<strong>${escapeHtml(p.title || "")}</strong></div>${p.body || ""}</div>`)
		.join("")}</div>`;
}

/** The full self-contained HTML document. */
export function htmlDoc({ title, head = "", slides = [] }) {
	const helpBox =
		'<div id="help"><div class="box"><h3>Keyboard</h3>' +
		"<div>← / → / Space — move &nbsp; t — theme &nbsp; 0-9 — jump &nbsp; c — copy slide &nbsp; ? — help &nbsp; Esc — close</div></div></div>";
	return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${themeCss()}${printCss()}</style>
${head}
</head>
<body>
<div id="deck">
${slides.join("\n")}
</div>
<div id="hud"><span id="counter"></span></div>
<div id="progress"><div id="progressbar"></div></div>
${helpBox}
<script>${navJs()}${copyJs()}</script>
</body>
</html>`;
}
