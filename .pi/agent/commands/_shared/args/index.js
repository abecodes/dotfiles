// _shared/args — a generic, declarative argv parser shared across commands
// (PORTING-SPEC §1a/§2). Pure: no I/O, no logging. Callers pass a flag SPEC and
// get back { flags, tokens, warnings }; unknown `--flags` land in `warnings` so
// the orchestrator can `c.log` them.
//
// A SPEC entry is keyed by the flag literal (e.g. "--no-deck") and declares:
//   { type: "boolean",       key, value }   — set flags[key] = value (no arg)
//   { type: "value",         key, transform? } — consume the NEXT token as arg
//   { type: "optionalValue", key, transform? } — consume the next token as arg
//        ONLY if one exists and it does not start with "-"; otherwise set "".
// `transform(raw) -> any` post-processes a value (e.g. Number, lowercase).
//
// SPEC shape:
//   { flags: { "--x": entry, ... }, defaults?: { key: value, ... } }
//
// Everything that is not a known flag (and not consumed as a flag value) is a
// positional token. `defaults` seed flags before parsing.

/**
 * Parse a raw arg string against a declarative spec.
 * @returns {{ flags: Record<string, any>, tokens: string[], warnings: string[] }}
 */
export function parseArgs(argStr, spec) {
	const parts = String(argStr ?? "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	const flagDefs = (spec && spec.flags) || {};
	const flags = { ...((spec && spec.defaults) || {}) };
	const tokens = [];
	const warnings = [];

	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		const def = flagDefs[p];
		if (def) {
			if (def.type === "boolean") {
				flags[def.key] = def.value;
			} else if (def.type === "value") {
				const raw = parts[++i];
				flags[def.key] = def.transform ? def.transform(raw ?? "") : (raw ?? "");
			} else if (def.type === "optionalValue") {
				const next = parts[i + 1];
				if (next != null && !next.startsWith("-")) {
					i++;
					flags[def.key] = def.transform ? def.transform(next) : next;
				} else {
					flags[def.key] = "";
				}
			}
			continue;
		}
		if (p.startsWith("--")) {
			warnings.push(`unknown flag ignored: ${p}`);
			continue;
		}
		tokens.push(p);
	}

	return { flags, tokens, warnings };
}
