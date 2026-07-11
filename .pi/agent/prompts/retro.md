---
description: Retrospective on the conversation just completed — surface prompt/process improvements, generate an HTML slide deck, and walk the user through accept/reject of concrete changes (AGENTS.md, new prompt templates, tool/skill wishlist).
argument-hint: "[focus-area]"
---

# Retro: $@

Run a retrospective on the conversation we just had. The goal is **actionable improvement**, not vague feedback. The user is fresh out of solving the task with you and wants to know how the same outcome could have been reached faster — or better — next time.

If `$@` is non-empty, treat it as a focus area (e.g. "prompts only", "skip artifacts", "just the deck"). Otherwise run the full flow.

---

## Step 1 — Analyze the conversation

Re-read the conversation already in your context. Do **not** make things up. Every finding must cite an actual turn or quoted snippet ("turn 3, you said: …", "I spent turns 5–7 reading file X before you mentioned Y exists in Z").

Cover these dimensions, but **only include sections that have real evidence** — empty sections add noise:

1. **High-leverage prompts** — user prompts that worked well and should be reused as-is or templated.
2. **Costly prompts** — user prompts that misled, under-specified, or sent you down a wrong path. Quote them. Suggest a concrete rewrite.
3. **Missing up-front context** — facts/files/conventions/constraints that, if stated in the first message (or a project file), would have collapsed N turns into 1. Be specific about how many turns it would have saved.
4. **My (the agent's) anti-patterns** — places where *you* went down dead ends that weren't the user's fault: needless file reads, premature edits, wrong assumptions, ignored signals. Be honest. Separate from prompt issues.
5. **Tooling gaps** — moments where an MCP server, skill, script, or extension would have replaced multiple turns of manual work. Name the hypothetical tool and what it would do.
6. **The single highest-leverage change** — if the user could change exactly one thing for next time, what is it? Force a ranking.
7. **What went well** — keep it short. Reinforce, don't pad.

End the analysis with a **Top 3 ranked by leverage** (most impact first).

---

## Step 2 — Generate proposals as concrete artifacts

For each finding that maps to a durable change, draft the actual file content. Do **not** apply yet — these are proposals for Step 4. Maintain an in-memory list with stable ids (`P1`, `P2`, …) so you can refer to them in the questionnaire.

Proposal types:

- **AGENTS.md addition / edit** — exact diff or new section, ready to paste. Prefer the project-local `AGENTS.md` if one exists; otherwise propose creating one. Mention `~/.agents/AGENTS.md` (global) only if the lesson is project-agnostic.
- **New prompt template** — full file content for `~/.pi/agent/prompts/<name>.md` or `.pi/prompts/<name>.md` with frontmatter (`description`, optional `argument-hint`). Choose scope based on whether the workflow is personal or project-bound.
- **New skill** — only if the task genuinely needs scripts/assets. Otherwise prefer a prompt template. Draft the `SKILL.md` in full.
- **Wishlist (no draft)** — tools/skills/MCPs that would help but require external setup or research. Include: name, one-line purpose, where it would plug in (which turn(s) of this conversation it would have helped), and a rough sketch of the interface. The user can decide later whether to build/install.
- **Settings / config tweaks** — e.g. enabling a built-in tool, adding a path to `skills`, etc.

Each proposal entry should include:
- `id` (P1, P2…)
- `type` (one of the above)
- `title` (short)
- `rationale` (1–2 sentences linking back to a specific moment in the conversation)
- `target_path` (where it would land) — N/A for wishlist
- `content` (full file content or diff) — N/A for wishlist

---

## Step 3 — Write the HTML slide deck

Write a **single, self-contained HTML file** to disk. Requirements:

- **Path**: `~/.pi/retros/<YYYY-MM-DD>-<HHMM>-<slug>.html`. Always global — retros are personal-context artifacts about agent behavior, NOT project artifacts, and should not pollute project repos (especially shared / company ones). Create `~/.pi/retros/` if missing. `<slug>` is a 2–4 word kebab-case summary of the original task.
- **Self-contained**: no external CDN, no network. All CSS and JS inline. Must work offline by double-clicking.
- **Navigation**: Left/Right arrows and Space to advance, `?` to toggle keyboard help. Slide counter in a corner. Progress bar.
- **Aesthetics**: clean, dark theme by default with a light-mode toggle (`t` key). Generous whitespace. Monospace for code/quotes from the conversation. Keep it under ~50KB.
- **Print-friendly**: `@media print` shows all slides stacked, one per page, so the user can save as PDF.

Slide order (skip slides that have no content):

1. **Title** — task summary, date, duration if inferrable from turn count.
2. **TL;DR** — Top 3 ranked changes, one line each.
3. **What went well** — short.
4. **High-leverage prompts** — quote + why it worked.
5. **Costly prompts** — quote + suggested rewrite, side by side.
6. **Missing up-front context** — bullets, each with "would have saved N turns".
7. **Agent anti-patterns** — your own honest mistakes.
8. **Tooling gaps** — wishlist items, one per slide if there are several.
9. **Proposals** — one slide per proposal P1…Pn, showing id, title, target path, and a code block with the drafted content (truncate long content with "…" and a note).
10. **Next actions** — list of decisions the user is about to make in Step 4.

Keep code/quote blocks scrollable inside the slide rather than overflowing.

After writing the file, **open it in the user's default browser** with a portable one-liner, then print the absolute path to the chat as well (so the user can re-open it later or share it).

Use this command, which works on macOS, Linux, and Windows/WSL:

```bash
( open "$DECK" 2>/dev/null || xdg-open "$DECK" 2>/dev/null || start "" "$DECK" 2>/dev/null || powershell.exe -c "Start-Process '$DECK'" 2>/dev/null ) &
```

Substitute `$DECK` with the deck's absolute path. Run it via the `bash` tool. Don't fail the retro if opening fails — the path is printed regardless.

---

## Step 4 — Walk the user through decisions

Use `ask_user_question` to collect decisions. Group proposals so each `ask_user_question` call covers a coherent batch (max 4 questions per call, max 4 options per question — respect tool limits). Strategy:

- For **file-writing proposals** (AGENTS.md, new prompt templates, new skills, settings): ask one multi-select question per category listing the proposals by id and title; the user picks which to apply.
- For **wishlist items**: ask a single multi-select question "Which to plan next?" — accepted items will be written to a follow-up notes file (see Step 5), not built now.
- If there are zero proposals in a category, skip that question.
- If there are more proposals than fit in 4 options, batch across multiple `ask_user_question` calls — but combine all categories' questions into as few calls as possible.

Phrase each option as `P{n}: {title}` with the rationale in `description`. Use `multiSelect: true` for these.

---

## Step 5 — Apply accepted changes

For every accepted proposal:

- Write/patch the file using `write` or `edit`.
- For new prompt templates and skills, confirm the path matches the chosen scope (global vs project).
- For wishlist items the user accepted, append them to `~/.pi/retros/wishlist.md`, with date, title, rationale, and interface sketch. Create the file with a header if it doesn't exist. Same scope rule as the deck — always global, never project-local.

Print a final summary: applied changes (with paths), skipped proposals, slide deck path, wishlist path if updated. Keep it terse — the deck is the artifact for recap.

---

## Tone

Be direct. The user asked for this because they want to improve, not be reassured. Self-criticism of your own behavior in Step 1.4 is more valuable than diplomatic hedging. At the same time, do not invent problems — if the conversation went smoothly, say so and keep the retro short.
