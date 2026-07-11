// _shared/models — the model alias map + resolver shared across commands.
// Promoted out of review/models (PORTING-SPEC §1a). review/models keeps the
// cross-model panel logic (REVIEWER_POOL/pickReviewerModels) and imports the
// alias map from here; /simplify uses only resolveModel/MODEL/SYNTH_MODEL.
// Pure; no I/O.

// Short alias → exact portkey id. Latest-version aliasing means the bare
// `claude-*` names also resolve, but we pin exact ids to avoid surprises and
// to nail the gpt/codex variants (which are not plain version bumps).
export const MODEL = {
	opus: "portkey/claude-opus-4-8",
	sonnet: "portkey/claude-sonnet-4-6",
	gpt: "portkey/gpt-5.5",
	codex: "portkey/gpt-5.3-codex",
	haiku: "portkey/claude-haiku-4-5",
};

// Cheap model for synthesis (TL;DR/ELI5) + cross-cut, regardless of the panel
// or the per-run --model choice.
export const SYNTH_MODEL = MODEL.sonnet;

/** Resolve a short alias to a concrete portkey id (pass-through if unknown). */
export function resolveModel(alias) {
	return MODEL[alias] || alias;
}
