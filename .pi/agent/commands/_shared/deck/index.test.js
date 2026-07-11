import { test } from "node:test";
import assert from "node:assert/strict";
import { badge, card, chip, copyJs, escapeHtml, htmlDoc, langFor, mdFence, SEVERITY_PALETTE, slide, splitColumns, stackedPanels } from "./index.js";

test("escapeHtml escapes the five entities", () => {
	assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("badge uses the severity palette color", () => {
	assert.match(badge("BLOCKER"), new RegExp(SEVERITY_PALETTE.BLOCKER));
	assert.match(badge("nope"), new RegExp(SEVERITY_PALETTE.LOW));
});

test("slide wraps header + body with the id", () => {
	const s = slide({ id: "x", header: "H", body: "<p>B</p>" });
	assert.match(s, /id="x"/);
	assert.match(s, /slide-header">H/);
	assert.match(s, /<p>B<\/p>/);
});

test("slide with copy payload renders a copy button carrying the JSON-encoded text", () => {
	const s = slide({ id: "x", body: "b", copy: "# Title\nline `with` ticks & <html>" });
	assert.match(s, /class="copy-btn"/);
	assert.match(s, /data-copy="/);
	// payload round-trips: extract the attribute and JSON.parse it back
	const m = s.match(/data-copy="([^"]*)"/);
	const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");
	assert.equal(JSON.parse(decoded), "# Title\nline `with` ticks & <html>");
});

test("slide without copy payload has no button", () => {
	assert.doesNotMatch(slide({ id: "x", body: "b" }), /copy-btn/);
});

test("mdFence escapes inner backtick runs with a longer fence and takes a lang hint", () => {
	assert.equal(mdFence("plain"), "```\nplain\n```");
	assert.equal(mdFence("x", "go"), "```go\nx\n```");
	assert.match(mdFence("has ``` inside"), /^````\n/);
	assert.equal(mdFence("   "), "");
});

test("langFor maps known extensions and falls back to empty", () => {
	assert.equal(langFor("internal/refund/service.go"), "go");
	assert.equal(langFor("src/app.TS"), "ts");
	assert.equal(langFor("x.unknownext"), "");
	assert.equal(langFor(""), "");
});

test("htmlDoc wires the clipboard script and copyJs has a c shortcut", () => {
	const html = htmlDoc({ title: "T", slides: [slide({ id: "s", body: "hi", copy: "x" })] });
	assert.match(html, /copy-btn/);
	assert.match(copyJs(), /navigator\.clipboard/);
	assert.match(copyJs(), /execCommand\('copy'\)/);
	assert.match(copyJs(), /e\.key === 'c'/);
});

test("card carries accent + jump attributes", () => {
	const c = card({ badge: "b", title: "t", accent: "#fff", jump: "finding-0" });
	assert.match(c, /border-left-color:#fff/);
	assert.match(c, /data-jump="finding-0"/);
});

test("chip supports tones and intra-deck jumps", () => {
	const c = chip("NO AUTO-PATCH", { tone: "warn", jump: "prop-1", title: "not included" });
	assert.match(c, /class="chip warn"/);
	assert.match(c, /data-jump="prop-1"/);
	assert.match(c, /NO AUTO-PATCH/);
});

test("splitColumns and stackedPanels render reusable comparison layouts", () => {
	const cols = splitColumns({ leftTitle: "Problem", left: "A", rightTitle: "Suggestions", right: "B" });
	assert.match(cols, /class="cols"/);
	assert.match(cols, /Problem/);
	const panels = stackedPanels([{ chip: chip("sonnet", { tone: "info" }), title: "one", body: "body" }]);
	assert.match(panels, /class="stacked-panels"/);
	assert.match(panels, /sonnet/);
});

test("htmlDoc is a self-contained offline document (no external src/href)", () => {
	const html = htmlDoc({ title: "T", slides: [slide({ id: "s", body: "hi" })] });
	assert.match(html, /^<!doctype html>/);
	assert.match(html, /<title>T<\/title>/);
	assert.match(html, /<style>/);
	assert.match(html, /<script>/);
	// no network references
	assert.doesNotMatch(html, /src="https?:/);
	assert.doesNotMatch(html, /href="https?:/);
});
