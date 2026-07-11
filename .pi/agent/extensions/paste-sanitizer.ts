import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Sanitize pasted-in content.
 *
 * Why this exists:
 *   When you copy pi's own TUI output (tool rows, subagent output, etc.) and
 *   paste it back into the input, the clipboard faithfully captures what was
 *   on screen — including:
 *     - blank rows the TUI inserted between visual blocks
 *     - trailing spaces used to pad each row to the terminal width
 *   That's why a clean-looking 4-row block re-pastes as a "whitespace and
 *   linebreak nightmare". This extension fixes the text up at submit time.
 *
 * Where it runs:
 *   pi.on("input") fires *after* extension commands are matched but before
 *   skill/template expansion, so the agent sees the cleaned text. The user
 *   still sees the raw paste in the editor and can edit it before submitting.
 *
 * Tuning:
 *   The default is aggressive (good for terminal-output pastes): every
 *   whitespace-only line is removed. If you also paste prose where blank
 *   lines mean paragraph breaks, switch to the softer rule (see below).
 */

function sanitize(text: string): string {
  let t = text;

  // Normalize line endings (the editor already does this, but the `input`
  // event is guaranteed to see whatever the editor handed back, so be safe).
  t = t.replace(/\r\n?/g, "\n");

  // Trim trailing whitespace on every line.
  t = t.replace(/[ \t]+$/gm, "");

  // Aggressive: drop ALL blank (whitespace-only) lines.
  // This is what makes a TUI re-paste look right.
  t = t.replace(/\n[ \t]*(?=\n)/g, "");
  // Soft alternative — comment the line above and uncomment this one to keep
  // single blank lines (paragraph breaks) but kill runs of 2+:
  //   t = t.replace(/(?:\n[ \t]*){2,}/g, "\n\n");

  // Trim a leading/trailing blank line that may remain.
  t = t.replace(/^\n+/, "").replace(/\n+$/, "");

  return t;
}

export default function (pi: ExtensionAPI) {
  pi.on("input", (event) => {
    if (event.source !== "interactive") return; // Only sanitize human input.
    if (!event.text) return;

    const cleaned = sanitize(event.text);
    if (cleaned === event.text) return;

    return { action: "transform", text: cleaned };
  });
}
