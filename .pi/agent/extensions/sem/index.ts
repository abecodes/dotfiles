// Wraps the `sem` CLI (https://github.com/Ataraxy-Labs/sem) as a pi tool.
//
// `sem` parses code with tree-sitter and produces an entity-level diff
// (functions / classes / methods changed) instead of git's line-level diff.
// We expose only `sem diff` for now. `sem impact` and the others can be added
// later if real usage justifies them.
//
// Design choices:
//   - Default format is `plain` (cheapest; just the entity list).
//   - `markdown` format is the next escalation; auto-includes inline patches
//     for *modified* entities. Useful when the agent wants the change *and*
//     a structural overview in one call.
//   - We deliberately do NOT expose `--format json` (see the README discussion):
//     for an LLM reader, JSON is 3-4× more tokens per entity than `plain`
//     because it repeats entityType / entityName / filePath as fields that
//     already live inside entityId. JSON only wins when something parses the
//     output deterministically — that's not us.
//   - We deliberately do NOT expose `--format terminal`: ANSI box-drawing,
//     useless in agent context.
//   - `--color=never` is forced. Even then, sem leaks a few ANSI codes (e.g.
//     "[2mNo semantic changes detected.[0m"), so we strip them post-hoc.
//
// Binary discovery mirrors lean-ctx: env override, then PATH, then well-known
// install locations (homebrew, cargo, ~/.local/bin).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, platform } from "node:os";

const semDiffSchema = Type.Object({
  range: Type.Optional(
    Type.String({
      description:
        "Any git ref expression (same syntax as `git diff`). Examples: "
        + "`HEAD` (single commit), "
        + "`abc1234` (single commit by sha), "
        + "`HEAD~3..HEAD` (two-dot: linear range), "
        + "`main...HEAD` (three-dot: branch vs trunk — changes since this branch diverged from main, this is what you want for `what changed on this branch`), "
        + "`origin/main...HEAD` (same against the upstream). "
        + "Omit to diff working tree vs HEAD. Mutually exclusive with `staged`.",
    }),
  ),
  staged: Type.Optional(
    Type.Boolean({
      description:
        "Diff staged changes only (index vs HEAD, like `git diff --cached`). Mutually exclusive with `range`.",
    }),
  ),
  verbose: Type.Optional(
    Type.Boolean({
      description:
        "Add word-level inline diffs for each modified entity. Heaviest output. Skip unless you actually need to inspect the change content.",
    }),
  ),
  format: Type.Optional(
    Type.Union([Type.Literal("plain"), Type.Literal("markdown")], {
      description:
        "`plain` = entity list only (cheapest, default). `markdown` = entity list + inline patch for each modified entity (good middle ground when you want to understand the change).",
    }),
  ),
  paths: Type.Optional(
    Type.Array(Type.String(), {
      description: "Pathspec filters (passed after `--`). Example: ['src/auth/', 'cmd/api/main.go'].",
    }),
  ),
  file_exts: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Restrict to specific file extensions. Each value should include the dot. Example: ['.ts', '.tsx'].",
    }),
  ),
});

// semSchema (raw `sem` CLI passthrough) is defined where it's used — currently
// commented out below. Re-add here when re-enabling the tool.

function resolveBinary(): string {
  const envBin = process.env.SEM_BIN;
  if (envBin && existsSync(envBin)) return envBin;

  const home = homedir();
  const isWin = platform() === "win32";
  const candidates = isWin
    ? [
        resolve(home, ".cargo", "bin", "sem.exe"),
        resolve(home, "AppData", "Local", "sem", "sem.exe"),
      ]
    : [
        "/opt/homebrew/bin/sem",
        "/usr/local/bin/sem",
        resolve(home, ".cargo", "bin", "sem"),
        resolve(home, ".local", "bin", "sem"),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return "sem";
}

function stripAnsi(text: string): string {
  // sem leaks a handful of ANSI sequences even with --color=never (e.g. the
  // dim "No semantic changes detected." banner). Strip them so the agent gets
  // clean text. Pattern matches CSI sequences (most common in terminal output).
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

async function execSem(pi: ExtensionAPI, args: string[]): Promise<string> {
  const bin = resolveBinary();
  const result = await pi.exec(bin, args);
  if (result.code !== 0) {
    const msg = (result.stderr || result.stdout || `sem failed: ${args.join(" ")}`).trim();
    if (/not found|ENOENT|no such file/i.test(msg) && bin === "sem") {
      throw new Error(
        "sem binary not found. Install: `brew install sem-cli` or "
          + "`cargo install --git https://github.com/Ataraxy-Labs/sem sem-cli`. "
          + "Override the path with SEM_BIN if installed elsewhere.",
      );
    }
    throw new Error(stripAnsi(msg));
  }
  return stripAnsi(result.stdout).trimEnd();
}

// `sem diff` does NOT return empty stdout when there are no entity-level
// changes in the requested comparison; it prints the literal sentinel
// "No semantic changes detected." (plus ANSI dim codes that stripAnsi
// removes). Match that as well as truly empty output, so the empty-result
// branch in execute() actually fires. Without this check, the wrapper
// passes sem's sentinel through verbatim and the working-tree probe / hint
// never runs.
function isSemEmptyResult(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  return /no semantic changes detected/i.test(trimmed);
}

// Count working-tree changes via `git status --porcelain`. Used to disambiguate
// the "no semantic changes" empty-result case for `range:` / `staged:` calls:
// the agent tends to misread that as "the repo is clean" and then shells out
// to `git status` to verify. Doing the check inside the tool removes the
// detour and lets the empty-result message report the actual state.
async function countWorkingTreeChanges(pi: ExtensionAPI): Promise<number | null> {
  try {
    const result = await pi.exec("git", ["status", "--porcelain"]);
    if (result.code !== 0) return null;
    const lines = result.stdout.split("\n").filter((l: string) => l.length > 0);
    return lines.length;
  } catch {
    return null;
  }
}

// When sem reports an unresolved ref (the most common cause of a sem_diff
// failure), enrich the error with the actual branches in the repo so the
// agent can retry with the right name in one round-trip. Without this, the
// agent's instinct is to shell out to `git branch` / `git rev-parse` / `git
// symbolic-ref` *before* calling sem_diff to avoid the perceived risk of a
// bad guess. The enriched error makes that pre-flight unnecessary.
async function enrichRefError(pi: ExtensionAPI, originalMessage: string): Promise<string> {
  const match = originalMessage.match(/revspec '([^']+)' not found/);
  if (!match) return originalMessage;
  const badRef = match[1];

  // Tier 1: origin/HEAD is configured. That's authoritative — emit only the
  // trunk hint and skip the branch list entirely. In any reasonably-sized repo
  // the full `git branch -a` output is hundreds of refs; dumping it adds
  // nothing the trunk hint doesn't already say.
  try {
    const symref = await pi.exec("git", [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    if (symref.code === 0 && symref.stdout.trim()) {
      const trunk = symref.stdout.trim();
      return (
        `sem_diff: ref '${badRef}' not found. `
        + `Likely trunk (origin/HEAD): ${trunk}. `
        + `Retry replacing '${badRef}' with '${trunk}' in your range expression.`
      );
    }
  } catch {
    // best-effort: outside a git repo, no git binary, etc.
  }

  // Tier 2: no origin/HEAD. Fall back to enumerating branches, but filtered.
  let branches: string[] = [];
  try {
    const result = await pi.exec("git", ["branch", "-a", "--format=%(refname:short)"]);
    if (result.code === 0) {
      branches = result.stdout
        .split("\n")
        .map((s: string) => s.trim())
        // Drop empty lines and the bare "origin" entry that some setups produce.
        .filter((s: string) => s && s !== "origin");
    }
  } catch {
    // best-effort
  }

  if (branches.length === 0) {
    return (
      `sem_diff: ref '${badRef}' not found, and could not enumerate the repo's branches. `
      + "Verify you're inside a git repo and retry with a valid ref."
    );
  }

  // Highlight conventional trunk names if any of them exist. These are what
  // the agent almost always wants to retry with.
  const TRUNK_CANDIDATES = [
    "origin/main",
    "origin/master",
    "origin/develop",
    "origin/trunk",
    "main",
    "master",
    "develop",
    "trunk",
  ];
  const refSet = new Set(branches);
  const trunks = TRUNK_CANDIDATES.filter((c: string) => refSet.has(c));

  if (trunks.length > 0) {
    return (
      `sem_diff: ref '${badRef}' not found. `
      + `Possible trunks in this repo: ${trunks.join(", ")}. `
      + `Retry replacing '${badRef}' with one of these.`
    );
  }

  // No trunk-shaped names found. Show a capped slice of the full list as a
  // last resort. Cap is intentionally small — the agent should be able to
  // pick a candidate at a glance.
  const CAP = 20;
  const shown = branches.slice(0, CAP);
  const suffix = branches.length > CAP ? ` ... +${branches.length - CAP} more` : "";
  return (
    `sem_diff: ref '${badRef}' not found. `
    + `No conventional trunk (main/master/develop/trunk) detected. `
    + `Branches available: ${shown.join(", ")}${suffix}. `
    + "Retry with one of these."
  );
}

const SEM_DIFF_DESCRIPTION = [
  "Show an *entity-level* diff (which functions / classes / methods changed) of the working tree, staged changes, or any git ref expression. Powered by `sem` (tree-sitter, 26+ languages). Detects renames and moves that `git diff` reports as add+delete.",
  "",
  "**If you don't know the trunk's name, just guess `main...HEAD` and call this tool.** A wrong ref returns an enriched error listing every branch in the repo (and `origin/HEAD` if configured) so you can retry with the right name in one round-trip. Looking up the trunk via `git rev-parse` / `git symbolic-ref` / `git branch` *before* this tool is always wrong — it's strictly more work than just calling `sem_diff` first.",
  "",
  "**Use `sem_diff` when:**",
  "  • The diff spans many files / hunks and you want a structural overview before drilling in.",
  "  • You need to know *which entities* a refactor touched without scrolling through every hunk.",
  "  • You suspect a rename or move (sem reports it as `renamed`; `git diff` would show it as add+delete).",
  "  • You're a reviewer doing a first-pass scan (\"did the coder touch the right functions?\").",
  "  • You want to filter cosmetic changes (whitespace, formatting) from real logic changes.",
  "",
  "**Use `bash` with `git diff` instead when:**",
  "  • You need the *literal lines* (off-by-one, operator typos, exact text, comparing against a previous attempt).",
  "  • You're a coder on iter ≥ 2 trying to understand what your previous attempt actually wrote.",
  "  • You need raw unified-diff output to apply, share, or pipe to another tool.",
  "  • The change is small and a structural summary is overkill.",
  "",
  "`sem_diff` accepts the **same ref syntax as `git diff`** via the `range` parameter. Reach for `sem_diff` first; you should not need to shell out to `git merge-base`, `git rev-parse`, or any other ref-resolving command before calling this tool — pass the expression directly.",
  "",
  "**Common questions → invocation:**",
  "  • \"What did I change locally?\" → omit `range` (default: working tree vs HEAD).",
  "  • \"What's staged?\" → `staged: true`.",
  "  • \"What changed on this branch?\" → `range: \"main...HEAD\"` (three dots = since merge-base). Use `origin/main...HEAD` if you want the comparison against the remote tip.",
  "  • \"What did the last 3 commits change?\" → `range: \"HEAD~3..HEAD\"`.",
  "  • \"What did this one commit change?\" → `range: \"abc1234\"`.",
  "",
  "Output formats:",
  "  • `plain` (default) — one line per changed entity. Cheapest. Use for triage.",
  "  • `markdown` — entity list + inline patch for each modified entity. Use when you want the structural view *and* the actual change in one call.",
  "  • For full word-level inline diffs, set `verbose: true`.",
].join("\n");

export default async function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "sem_diff",
    label: "sem_diff",
    description: SEM_DIFF_DESCRIPTION,
    promptSnippet: "Entity-level (function/class/method) diff via sem. Use git diff for line-level detail.",
    parameters: semDiffSchema,
    async execute(_toolCallId, params) {
      if (params.staged && params.range) {
        throw new Error("sem_diff: `staged` and `range` are mutually exclusive.");
      }

      const args = ["diff", "--color", "never"];
      const format = params.format ?? "plain";
      args.push("--format", format);
      if (params.verbose) args.push("--verbose");
      if (params.staged) args.push("--staged");
      if (params.file_exts && params.file_exts.length > 0) {
        args.push("--file-exts", ...params.file_exts);
      }
      // `range` is positional in `sem diff` (it accepts the same ref syntax as
      // `git diff`: HEAD, ref1..ref2, ref1...ref2, single sha). Place it before
      // the `--` pathspec separator so sem doesn't treat it as a path.
      if (params.range) args.push(params.range);
      if (params.paths && params.paths.length > 0) {
        args.push("--", ...params.paths);
      }

      let output: string;
      try {
        output = await execSem(pi, args);
      } catch (err) {
        if (err instanceof Error) {
          const enriched = await enrichRefError(pi, err.message);
          if (enriched !== err.message) throw new Error(enriched);
        }
        throw err;
      }
      let text: string;
      if (!isSemEmptyResult(output)) {
        text = output;
      } else if (params.range || params.staged) {
        // "No semantic changes" in a range/staged comparison means "no commits
        // in that comparison" — it does NOT mean the repo is clean. Probe the
        // working tree directly and tell the agent the actual state, so they
        // don't shell out to `git status` to verify.
        const subject = params.staged ? "the index vs HEAD" : `range '${params.range}'`;
        const dirty = await countWorkingTreeChanges(pi);
        if (dirty === null) {
          text =
            `(no semantic changes detected in ${subject}. `
            + "Could not probe the working tree. "
            + "To check for uncommitted work, call `sem_diff` again with no `range` and no `staged`.)";
        } else if (dirty === 0) {
          text = `(no semantic changes detected in ${subject}; working tree is also clean vs HEAD.)`;
        } else {
          const noun = dirty === 1 ? "change" : "changes";
          text =
            `(no semantic changes detected in ${subject}, `
            + `but the working tree has ${dirty} uncommitted ${noun} (per \`git status --porcelain\`). `
            + "Call `sem_diff` again with no `range` and no `staged` to see them.)";
        }
      } else {
        text = "(no semantic changes detected: working tree matches HEAD)";
      }
      return {
        content: [{ type: "text", text }],
        details: { source: "sem", args, format },
      };
    },
  });

  // Raw `sem` CLI passthrough — disabled until we see a real need. The agent
  // can still reach the other subcommands (blame, entities, log, impact,
  // context) via permitted bash if/when that matters. Re-enable by
  // uncommenting this block and adding `"sem"` back to permission.json.
  //
  // pi.registerTool({
  //   name: "sem",
  //   label: "sem",
  //   description:
  //     "Run the sem CLI directly for subcommands not exposed as a dedicated tool (e.g. `blame`, `entities`, `log`, `context`, `impact`). Prefer `sem_diff` for diffs. Pass arguments as an array; `--color never` is added automatically when missing.",
  //   promptSnippet: "Run sem CLI directly (blame/entities/log/impact/context).",
  //   parameters: semSchema,
  //   async execute(_toolCallId, params) {
  //     const args = [...params.args];
  //     // Force non-color output unless the caller explicitly asked for it.
  //     const hasColor = args.some((a) => a === "--color" || a.startsWith("--color="));
  //     if (!hasColor) args.push("--color", "never");
  //     const output = await execSem(pi, args);
  //     return {
  //       content: [{ type: "text", text: output.length > 0 ? output : "(no output)" }],
  //       details: { source: "sem", args },
  //     };
  //   },
  // });

}
