// Demo fixture for the /review decks. Renders a fully-populated per-target deck
// and a multi-target group deck so every slide/section is visible at once.
//
//   node commands/review/demo/build.mjs            # write + open
//   node commands/review/demo/build.mjs --no-open  # just write
//
// Output lands beside this script: review.html / review.md / summary.html / summary.md
// It is a hand-built fixture (no agents, no acquisition) — purely to inspect the renderers.

import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { renderGroupDeck, renderReviewDeck } from "../deck/index.js";
import { renderReviewMd, renderSummaryMd } from "../report/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REVIEWED = "2026-06-20T18:00:00Z";

// A long slice to demonstrate the "… (truncated, see review.md)" marker (>50 lines).
const longSlice = Array.from({ length: 60 }, (_, i) => `\tline${i + 1} := compute(step${i + 1})`).join("\n");

// ─── Per-target target ────────────────────────────────────────────────────────

const target = {
	name: "payments-svc-pr482",
	source: "https://github.example.com/acme/payments-svc/pull/482",
	repo: "payments-svc",
	mode: "pr",
	base_ref: "main",
	base_sha: "a1b2c3d",
	head_ref: "pr-482",
	head_sha: "9f8e7d6",
	dirty: false,
	stats: { files: 14, additions: 612, deletions: 88 },
	reviewedAt: REVIEWED,
};

// ─── Findings: every severity, several categories, all four reviewer agents ───

const findings = [
	{
		agent: "implementation-reviewer",
		severity: "BLOCKER",
		category: "CORRECTNESS",
		title: "Nil deref on refund path",
		path: "internal/refund/service.go",
		line: 134,
		endLine: 137,
		problem:
			"`refund.Account` is only populated for card payments; for wallet refunds it stays nil and `acct.Balance` panics, taking down the whole refund worker.",
		fix: "Guard the lookup and fail the single refund instead of the worker:\n```go\nacct := r.accounts.Find(refund.AccountID)\nif acct == nil {\n    return fmt.Errorf(\"refund %s: account %s not found\", refund.ID, refund.AccountID)\n}\nacct.Balance += refund.AmountCents\n```",
		style: false,
		codeSlice: "acct := r.accounts.Find(refund.AccountID)\n// acct may be nil for wallet refunds\nacct.Balance += refund.AmountCents // panics",
	},
	{
		agent: "architecture-reviewer",
		severity: "CRITICAL",
		category: "CONTRACT",
		title: "Unversioned breaking API change",
		path: "api/v1/payments.proto",
		line: 52,
		endLine: null,
		problem:
			"`amount` (int64) was renamed to `amount_cents` on the existing `v1` message. Deployed clients still send `amount`, which now silently decodes to 0 — every charge becomes free.",
		fix: "Introduce the field as `v2` or add `amount_cents` alongside a deprecated `amount`, and migrate consumers before removing it. Never repurpose a tag on a shipped message.",
		style: false,
		codeSlice: "  // was: int64 amount = 3;\n  int64 amount_cents = 3;",
	},
	{
		agent: "implementation-reviewer",
		severity: "HIGH",
		category: "CONCURRENCY",
		title: "Race on shared ledger map",
		path: "internal/ledger/cache.go",
		line: 88,
		endLine: null,
		problem:
			"`entries` is read in `Get` and written in `Apply` from multiple goroutines with no lock — `go test -race` flags it and balances can corrupt under load.",
		fix: "Protect with a `sync.RWMutex` (RLock in `Get`, Lock in `Apply`), or switch to `sync.Map` if the access pattern is write-light.",
		style: false,
		codeSlice: "func (c *Cache) Apply(e Entry) {\n\tc.entries[e.Account] = c.entries[e.Account] + e.Delta\n}",
	},
	{
		agent: "architecture-reviewer",
		severity: "HIGH",
		category: "FRAMEWORK_BYPASS",
		title: "Direct SQL bypasses repository",
		path: "internal/refund/service.go",
		line: 201,
		endLine: 240,
		problem:
			"`service.go` opens a raw `*sql.DB` and hand-writes queries, bypassing the `ledger.Repository` abstraction every other package uses — duplicating retry/tracing/tx logic that already exists.",
		fix: "Route the reads through `ledger.Repository`; if it lacks a method, add it there so retries and tracing stay in one place.",
		style: false,
		codeSlice: longSlice, // demonstrates truncation
	},
	{
		agent: "security-reviewer",
		severity: "HIGH",
		category: "SECRET_EXPOSURE",
		title: "Hardcoded provider API token",
		path: "config/providers.go",
		line: 17,
		endLine: null,
		problem:
			"A live Stripe-style secret is committed in source. Anyone with repo read access can move money; it also leaks into build logs and images.",
		fix: "Load it from the secret manager at runtime and rotate the exposed token immediately:\n```go\ntoken := secrets.MustGet(ctx, \"payments/provider_token\")\n```",
		style: false,
		codeSlice: 'const providerToken = "sk_live_4eC39HqLyjWDarjtT1zdp7dc"',
	},
	{
		agent: "implementation-reviewer",
		severity: "MEDIUM",
		category: "ERROR_HANDLING",
		title: "Webhook error swallowed",
		path: "internal/webhook/handler.go",
		line: 76,
		endLine: null,
		problem:
			"The error from `process(evt)` is assigned to `_`, so a failed webhook returns 200 and the provider never retries — events are lost silently.",
		fix: "Return a 5xx on failure so the provider redelivers, and log with the event id.",
		style: false,
		codeSlice: "_ = process(evt)\nw.WriteHeader(http.StatusOK)",
	},
	{
		agent: "maintainability-reviewer",
		severity: "MEDIUM",
		category: "PERFORMANCE",
		title: "N+1 query in invoice list",
		path: "internal/invoice/list.go",
		line: 44,
		endLine: 49,
		problem:
			"For each invoice the handler issues a separate `LoadLineItems` query — a 200-invoice page fires 201 queries and dominates p99 latency.",
		fix: "Batch with a single `WHERE invoice_id IN (...)` and group in memory, or use a join.",
		style: false,
		codeSlice: "for _, inv := range invoices {\n\tinv.Items, _ = db.LoadLineItems(ctx, inv.ID)\n}",
	},
	{
		agent: "maintainability-reviewer",
		severity: "LOW",
		category: "DOCUMENTATION",
		title: "Exported func undocumented",
		path: "internal/refund/service.go",
		line: 60,
		endLine: null,
		problem: "`func Reconcile(...)` is exported but has no doc comment; `go doc` shows nothing for a non-obvious entry point.",
		fix: "Add a `// Reconcile …` comment describing the invariant it restores.",
		style: false,
		codeSlice: "func Reconcile(ctx context.Context, day time.Time) error {",
	},
	// ── style:true findings → collapsed onto the Style notes slide ──
	{
		agent: "architecture-reviewer",
		severity: "LOW",
		category: "NAMING",
		title: "Rename amt → amountCents",
		path: "internal/refund/types.go",
		line: 12,
		endLine: null,
		problem: "`amt` is ambiguous about units; the codebase standard is explicit `…Cents`.",
		fix: "Rename to `amountCents`.",
		style: true,
	},
	{
		agent: "implementation-reviewer",
		severity: "LOW",
		category: "STYLE",
		title: "gofmt: align struct tags",
		path: "internal/ledger/cache.go",
		line: 19,
		endLine: null,
		problem: "Struct tags aren't gofmt-aligned.",
		fix: "Run `gofmt -w`.",
		style: true,
	},
];

// Stamp the cross-model panel (author=sonnet → opus/codex/gpt; security reuses
// opus) onto every finding so the decks show the "agent · model" attribution.
const AGENT_MODEL = {
	"architecture-reviewer": "opus",
	"implementation-reviewer": "codex",
	"maintainability-reviewer": "gpt",
	"security-reviewer": "opus",
};
for (const f of findings) f.model = AGENT_MODEL[f.agent];

// ─── Synth (TL;DR + one ELI5 entry per non-style finding, matched by title) ───

const synth = {
	tldr:
		"PR #482 reworks the refund and ledger paths and adds provider config. It carries two ship-stoppers — a nil dereference that crashes the refund worker for wallet refunds, and an unversioned proto change that makes every charge decode to zero — plus a data race, a framework bypass, and a committed live secret.",
	eli5: [
		{ title: "Nil deref on refund path", whatsWrong: "For wallet refunds the account object is empty, and the code reads a field off the empty thing.", whyItMatters: "It crashes the whole refund worker, so no refunds go out until someone restarts it.", howToFix: "Check the account exists; if not, fail just that one refund with a clear error." },
		{ title: "Unversioned breaking API change", whatsWrong: "A field that clients already send was renamed without bumping the version.", whyItMatters: "Old clients keep sending the old name, it reads as 0, and every charge becomes free.", howToFix: "Add the new field next to the old one (or make a v2) and migrate clients first." },
		{ title: "Race on shared ledger map", whatsWrong: "Two goroutines touch the same map at once without a lock.", whyItMatters: "Under load the balances can corrupt and the race detector fails the build.", howToFix: "Wrap reads/writes in a mutex (or use sync.Map)." },
		{ title: "Direct SQL bypasses repository", whatsWrong: "This file talks to the database directly instead of through the shared data layer.", whyItMatters: "Retries and tracing live in the shared layer; bypassing it loses them and duplicates logic.", howToFix: "Call the repository; add a method there if one is missing." },
		{ title: "Hardcoded provider API token", whatsWrong: "A real payment secret is written straight into the code.", whyItMatters: "Anyone who can read the repo can spend money, and it leaks into logs and images.", howToFix: "Read it from the secret manager at runtime and rotate the leaked one now." },
		{ title: "Webhook error swallowed", whatsWrong: "If handling a webhook fails, the code still says 'OK'.", whyItMatters: "The provider thinks it succeeded and never retries, so events vanish.", howToFix: "Return an error status on failure so it gets redelivered." },
		{ title: "N+1 query in invoice list", whatsWrong: "It runs one extra database query per invoice in the list.", whyItMatters: "A big page fires hundreds of queries and gets slow.", howToFix: "Fetch all line items in one query and group them in memory." },
		{ title: "Exported func undocumented", whatsWrong: "A public function has no explanation.", whyItMatters: "Callers can't tell what guarantee it provides.", howToFix: "Add a one-line doc comment." },
	],
};

const renderFlags = {
	eli5: true,
	security: true,
	maintainability: true,
	testResults: { untagged: "fail", integration: "pass" },
	reviewedAt: REVIEWED,
};

// ─── Second target + cross-cut for the GROUP deck ─────────────────────────────

const target2 = {
	name: "wallet-svc-feature-rc1",
	source: "/Users/dev/repos/wallet-svc",
	repo: "wallet-svc",
	mode: "git",
	base_ref: "origin/main",
	base_sha: "44ad910",
	head_ref: "HEAD",
	head_sha: "c0ffee1",
	dirty: true,
	stats: { files: 6, additions: 145, deletions: 12 },
	reviewedAt: REVIEWED,
};

const perTargetGroup = [
	{ target, verdict: "BLOCKED", reviewMdRel: "payments-svc-pr482/review.md", reviewHtmlRel: "payments-svc-pr482/review.html" },
	{ target: target2, verdict: "NEEDS-CHANGES", reviewMdRel: "wallet-svc-feature-rc1/review.md", reviewHtmlRel: "wallet-svc-feature-rc1/review.html" },
];

const crosscut = {
	verdict: "BLOCKED",
	prose: "The two services disagree on the money field: payments-svc renames it to amount_cents while wallet-svc still reads amount. Merged together, wallet refunds compute the wrong balance until both sides move in lockstep.",
	merge_order: ["payments-svc-pr482", "wallet-svc-feature-rc1"],
	findings: [
		{
			severity: "CRITICAL",
			category: "CONTRACT_DRIFT",
			title: "amount vs amount_cents skew",
			involves: ["payments-svc-pr482", "wallet-svc-feature-rc1"],
			evidence: [
				{ target: "payments-svc-pr482", path: "api/v1/payments.proto", line: 52, snippet: "int64 amount_cents = 3;" },
				{ target: "wallet-svc-feature-rc1", path: "internal/sync/refund.go", line: 31, snippet: "msg.GetAmount()" },
			],
			problem: "payments-svc renames the field; wallet-svc still calls GetAmount(), which now returns 0 after the rename lands.",
			fix: "Merge payments-svc first behind a flag, ship wallet-svc reading amount_cents, then flip the flag. Do not merge wallet-svc before the proto migration is consumed.",
			style: false,
		},
		{
			severity: "MEDIUM",
			category: "SEAM_TEST_GAP",
			title: "No contract test across the seam",
			involves: ["payments-svc-pr482", "wallet-svc-feature-rc1"],
			evidence: [{ target: "wallet-svc-feature-rc1", path: "internal/sync/refund_test.go", line: 1, snippet: "package sync" }],
			problem: "Neither side has a test that exercises the encoded payments message against the wallet decoder, so the skew above slipped through.",
			fix: "Add a shared golden-message fixture and assert both encode/decode agree.",
			style: false,
		},
	],
};

// ─── Second per-target deck (wallet-svc) ──────────────────────────────────────
// So the group summary's relative links actually resolve and you can click
// through. Smaller, NEEDS-CHANGES.

const findings2 = [
	{
		agent: "implementation-reviewer",
		severity: "HIGH",
		category: "CONCURRENCY",
		title: "Deadlock on unbuffered channel",
		path: "internal/sync/refund.go",
		line: 31,
		endLine: null,
		problem: "`done` is unbuffered and the only sender runs after the receiver returns on the error path, so a failed sync blocks the worker forever.",
		fix: "Buffer the channel (`make(chan struct{}, 1)`) or `select` with a context cancel.",
		style: false,
		codeSlice: "done := make(chan struct{})\nif err != nil {\n\treturn err // nobody ever drains done\n}\ndone <- struct{}{}",
	},
	{
		agent: "architecture-reviewer",
		severity: "MEDIUM",
		category: "LAYERING",
		title: "Handler reaches into storage",
		path: "internal/sync/handler.go",
		line: 18,
		endLine: null,
		problem: "The HTTP handler imports the `storage` package directly instead of going through the service layer, coupling transport to persistence.",
		fix: "Inject a service interface and call that; keep `storage` behind it.",
		style: false,
		codeSlice: 'import "wallet-svc/internal/storage"',
	},
	{
		agent: "maintainability-reviewer",
		severity: "LOW",
		category: "DOCUMENTATION",
		title: "Package lacks doc.go",
		path: "internal/sync/sync.go",
		line: 1,
		endLine: null,
		problem: "`internal/sync` has no package comment; `go doc` shows nothing for a non-trivial package.",
		fix: "Add a `doc.go` with a package overview.",
		style: false,
		codeSlice: "package sync",
	},
	{
		agent: "implementation-reviewer",
		severity: "LOW",
		category: "STYLE",
		title: "Unused import",
		path: "internal/sync/handler.go",
		line: 7,
		endLine: null,
		problem: "`errors` is imported but unused.",
		fix: "Drop the import (goimports).",
		style: true,
	},
];
for (const f of findings2) f.model = AGENT_MODEL[f.agent];

const synth2 = {
	tldr: "wallet-svc adds the refund-sync worker and an HTTP handler. The headline risk is a deadlock on an unbuffered channel in the error path; there's also a layering leak from the handler into storage.",
	eli5: [
		{ title: "Deadlock on unbuffered channel", whatsWrong: "A worker waits to hand off a signal that nobody is listening for on the error path.", whyItMatters: "A single failed sync hangs the worker forever.", howToFix: "Give the channel a small buffer or use a cancellable select." },
		{ title: "Handler reaches into storage", whatsWrong: "The web handler talks straight to the database package.", whyItMatters: "Transport and persistence get tangled, making both harder to change/test.", howToFix: "Call a service interface that owns storage." },
		{ title: "Package lacks doc.go", whatsWrong: "The package has no overview comment.", whyItMatters: "Newcomers can't tell what it's for at a glance.", howToFix: "Add a short doc.go." },
	],
};

const renderFlags2 = {
	eli5: true,
	security: false,
	maintainability: true,
	testResults: { untagged: "pass", integration: "skipped" },
	reviewedAt: REVIEWED,
};

// ─── Render + write + open ────────────────────────────────────────────────────

async function main() {
	const group = { name: "release-2026-06-20", reviewedAt: REVIEWED };

	// Mirror a real multi-target run's on-disk layout so the summary's relative
	// links resolve: <demo>/<name>/review.{html,md} + <demo>/summary.{html,md}.
	const out = {
		[`${target.name}/review.html`]: renderReviewDeck(target, findings, synth, "BLOCKED", renderFlags),
		[`${target.name}/review.md`]: renderReviewMd(target, findings, synth, "BLOCKED", renderFlags),
		[`${target2.name}/review.html`]: renderReviewDeck(target2, findings2, synth2, "NEEDS-CHANGES", renderFlags2),
		[`${target2.name}/review.md`]: renderReviewMd(target2, findings2, synth2, "NEEDS-CHANGES", renderFlags2),
		"summary.html": renderGroupDeck(group, perTargetGroup, crosscut),
		"summary.md": renderSummaryMd(group, perTargetGroup, crosscut),
	};
	for (const [rel, content] of Object.entries(out)) {
		const p = path.join(HERE, rel);
		await fs.mkdir(path.dirname(p), { recursive: true });
		await fs.writeFile(p, content);
	}

	console.log("Wrote:");
	for (const rel of Object.keys(out)) console.log("  " + path.join(HERE, rel));

	if (!process.argv.includes("--no-open")) {
		const open = (p) => exec(`open '${p}' 2>/dev/null || xdg-open '${p}' 2>/dev/null`, () => {});
		open(path.join(HERE, "summary.html"));
		open(path.join(HERE, `${target.name}/review.html`));
		console.log("\nOpened summary.html + the payments-svc per-target deck. Click a target row in the summary to jump.");
	}
}

main();
