/**
 * ask-user-question — schema, validator, types, and response envelope.
 *
 * Pure module: no TUI imports, no pi-coding-agent imports. The execute fn
 * lives in `index.ts`. Everything here is constants, TypeBox schemas, the
 * runtime validator, and the LLM-facing envelope formatter.
 *
 * Envelope shape MUST stay byte-compatible with the original
 * `@juicesharp/rpiv-ask-user-question` for trained-model parity (modulo
 * intentional drops noted in the rewrite design).
 */

import { type Static, Type } from "typebox";

// ─── Limits ──────────────────────────────────────────────────────────────

export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;
/** Hard cap on the per-question header chip (rendered in the tab bar). Relaxed from 16 → 24. */
export const MAX_HEADER_LENGTH = 24;

// ─── Reserved labels & sentinels ─────────────────────────────────────────

/**
 * Labels reserved for runtime sentinel rows. Authoring an option with any
 * of these triggers the `reserved_label` validation guard (case-sensitive,
 * exact match). Order is pinned — consumers may index into this array.
 */
export const RESERVED_LABELS = ["Other", "Type something.", "Chat about this", "Next →"] as const;
export type ReservedLabel = (typeof RESERVED_LABELS)[number];

/**
 * User-facing labels for the three runtime sentinel rows. Mirrors the
 * original `state/row-intent.ts` semantics. The `next` label here is
 * `"Next →"` (matching this rewrite's keymap design); the other two are
 * unchanged from the original.
 */
export const SENTINEL_LABELS = {
	other: "Type something.",
	chat: "Chat about this",
	next: "Next →",
} as const;
export type SentinelKind = keyof typeof SENTINEL_LABELS;
export type SentinelLabel = (typeof SENTINEL_LABELS)[SentinelKind];

// ─── Schemas ─────────────────────────────────────────────────────────────

export const OptionSchema = Type.Object({
	label: Type.String({
		description:
			"The display text for this option that the user will see and select. Should be concise and clearly describe the choice.",
	}),
	description: Type.String({
		description:
			"Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
	}),
	preview: Type.Optional(
		Type.String({
			description:
				"Optional preview content rendered side-by-side when this option is focused. Use for mockups, code snippets, configs, or visual comparisons. Press `p` to expand the preview to fullscreen. See the tool description for the expected content format.",
		}),
	),
});

export const QuestionSchema = Type.Object({
	question: Type.String({
		description:
			'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
	}),
	header: Type.String({
		maxLength: MAX_HEADER_LENGTH,
		description: `MAX ${MAX_HEADER_LENGTH} CHARACTERS — hard limit, requests over the limit are rejected. Very short chip/tag shown next to the question. Examples: "Auth method", "Library", "Approach".`,
	}),
	options: Type.Array(OptionSchema, {
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
		description:
			"The available choices for this question. Must have 2-6 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). The 'Type something.' row is appended automatically — do NOT author it.",
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			default: false,
			description:
				"Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
		}),
	),
	optionsOnly: Type.Optional(
		Type.Boolean({
			default: false,
			description:
				"Set to true to suppress the runtime free-form rows ('Type something.' and 'Chat about this'), leaving ONLY the authored options (plus Esc to cancel). Use when the answer is consumed programmatically — not fed to an LLM — so a typed or chat-handoff answer would be meaningless. Has no effect on multi-select questions (which already omit those rows).",
		}),
	),
});

export const QuestionsSchema = Type.Array(QuestionSchema, {
	minItems: 1,
	maxItems: MAX_QUESTIONS,
	description: "Questions to ask the user (1-4 questions)",
});

export const QuestionParamsSchema = Type.Object({
	questions: QuestionsSchema,
});

// ─── Static types ────────────────────────────────────────────────────────

export type OptionData = Static<typeof OptionSchema>;
export type QuestionData = Static<typeof QuestionSchema>;
export type QuestionParams = Static<typeof QuestionParamsSchema>;

// ─── Sentinel row planning ───────────────────────────────────────────────

/**
 * Pure decision for which runtime sentinel rows a question gets, in render
 * order. Single source of truth shared by the OptionList renderer and tests.
 *
 * - multi-select: only the `next` commit row (free-form rows never applied).
 * - `optionsOnly`: no sentinel rows at all — authored options + Esc only.
 * - otherwise: `other` ("Type something.") unless any option carries a
 *   non-empty preview, then `chat` ("Chat about this") last.
 */
export function buildSentinelRows(q: QuestionData, multiSelect: boolean): SentinelKind[] {
	if (multiSelect) return ["next"];
	if (q.optionsOnly) return [];
	const rows: SentinelKind[] = [];
	const hasPreview = q.options.some((o) => typeof o.preview === "string" && o.preview.trim().length > 0);
	if (!hasPreview) rows.push("other");
	rows.push("chat");
	return rows;
}

// ─── Answer + result types ───────────────────────────────────────────────

/**
 * Answer-intent discriminated union. `kind` is the single discriminator.
 *
 * - `option`: user picked one of the author-defined options. `answer` is the option's label.
 * - `custom`: user typed free-text via the "Type something." row. `answer` is the typed text or null.
 * - `chat`: user picked the chat sentinel. `answer` is `null`; the envelope text
 *   substitutes the two-sentence continuation directive (`CHAT_CONTINUATION_MESSAGE`)
 *   based on `kind` alone.
 * - `multi`: user committed multi-select choices. `selected` carries chosen labels; `answer` is null.
 *
 * `preview` is populated only on single-select option picks where the
 * matched option carries a non-empty `preview` field. Notes are NOT
 * supported in this rewrite (the `n` affordance was dropped).
 */
export interface QuestionAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "chat" | "multi";
	answer: string | null;
	selected?: string[];
	preview?: string;
}

export type QuestionnaireError =
	| "no_ui"
	| "no_questions"
	| "empty_options"
	| "too_many_questions"
	| "duplicate_question"
	| "duplicate_option_label"
	| "reserved_label";

export interface QuestionnaireResult {
	answers: QuestionAnswer[];
	cancelled: boolean;
	error?: QuestionnaireError;
}

// ─── Runtime validator ───────────────────────────────────────────────────

const RESERVED_LABEL_SET: ReadonlySet<string> = new Set(RESERVED_LABELS);

export const ERROR_NO_QUESTIONS = "Error: At least one question is required";
export const ERROR_TOO_MANY_QUESTIONS = `Error: At most ${MAX_QUESTIONS} questions are allowed per invocation`;
export const ERROR_EMPTY_OPTIONS = `Error: Each question requires ${MIN_OPTIONS}-${MAX_OPTIONS} options`;
export const ERROR_DUPLICATE_QUESTION = "Error: Question text must be unique within an invocation";
export const ERROR_DUPLICATE_OPTION_LABEL = "Error: Option labels must be unique within a question";
export const ERROR_RESERVED_LABEL = `Error: Option label is reserved (${RESERVED_LABELS.join(", ")})`;

export type ValidationResult =
	| { ok: true }
	| { ok: false; error: QuestionnaireError; message: string };

/**
 * Pure runtime validator for `QuestionParams`. Covers structural checks
 * beyond what the TypeBox schema enforces. Does NOT cover `no_ui` (which
 * depends on `ctx.hasUI` and stays inline at the call site).
 *
 * Returns the FIRST violation found, in this order:
 *   1. no_questions
 *   2. too_many_questions
 *   3. empty_options       (per-question: < MIN_OPTIONS or > MAX_OPTIONS)
 *   4. duplicate_question  (trimmed-equal, case-sensitive)
 *   5. reserved_label      (exact case-sensitive match)
 *   6. duplicate_option_label (trimmed-equal, case-sensitive, within one question)
 */
export function validateQuestionnaire(params: unknown): ValidationResult {
	const typed = (params ?? {}) as { questions?: unknown };
	const qs = Array.isArray(typed.questions) ? (typed.questions as QuestionData[]) : [];

	if (qs.length === 0) {
		return { ok: false, error: "no_questions", message: ERROR_NO_QUESTIONS };
	}
	if (qs.length > MAX_QUESTIONS) {
		return { ok: false, error: "too_many_questions", message: ERROR_TOO_MANY_QUESTIONS };
	}

	for (const q of qs) {
		const opts = Array.isArray(q.options) ? q.options : [];
		if (opts.length < MIN_OPTIONS || opts.length > MAX_OPTIONS) {
			return { ok: false, error: "empty_options", message: ERROR_EMPTY_OPTIONS };
		}
	}

	const seenQuestions = new Set<string>();
	for (const q of qs) {
		const key = (q.question ?? "").trim();
		if (seenQuestions.has(key)) {
			return { ok: false, error: "duplicate_question", message: ERROR_DUPLICATE_QUESTION };
		}
		seenQuestions.add(key);
	}

	for (const q of qs) {
		const seenLabels = new Set<string>();
		for (const o of q.options) {
			if (RESERVED_LABEL_SET.has(o.label)) {
				return { ok: false, error: "reserved_label", message: ERROR_RESERVED_LABEL };
			}
			const key = (o.label ?? "").trim();
			if (seenLabels.has(key)) {
				return {
					ok: false,
					error: "duplicate_option_label",
					message: ERROR_DUPLICATE_OPTION_LABEL,
				};
			}
			seenLabels.add(key);
		}
	}

	return { ok: true };
}

// ─── Prompt guidance & tool description ──────────────────────────────────

export const DEFAULT_PROMPT_SNIPPET = `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous`;

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	`Use ask_user_question whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to ${MAX_QUESTIONS} questions per invocation. Each question MUST have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option requires a label and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer ("Type something." row is appended automatically to single-select questions) or pick "Chat about this" to abandon the questionnaire. Set multiSelect: true when multiple answers are valid; this suppresses the "Type something." row. Provide an options[].preview markdown string when an option benefits from richer side-by-side context (mockups, code snippets, diagrams, configs) — single-select only; the user can press \`p\` to expand the preview to fullscreen. NOTE: any non-empty preview on a single-select question ALSO suppresses the "Type something." row (no room in the side-by-side layout); "Chat about this" remains the escape hatch. If you recommend a specific option, make it the first option and append "(Recommended)" to its label. Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one invocation.`,
];

export const TOOL_DESCRIPTION = `Ask the user one or more structured questions during execution. Use when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Users will always be able to type a custom answer ("Type something." row is appended automatically to every single-select question) or pick "Chat about this" to abandon the questionnaire and continue in free-form conversation. Do NOT author "Other" / "Type something." / "Chat about this" / "Next →" labels yourself — duplicates are rejected at runtime.
- Use multiSelect: true to allow multiple answers to be selected for a question. The "Type something." row is suppressed on multi-select questions, and is ALSO suppressed on single-select questions where any option carries a \`preview\` (the side-by-side layout has no room for inline custom text — "Chat about this" remains as the free-form escape hatch).
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.

Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. The user can press \`p\` to expand the preview to fullscreen for easier reading and scroll through long content. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).`;

// ─── Tool result + envelope ──────────────────────────────────────────────

export const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";
export const DECLINE_MESSAGE = "User declined to answer questions";
export const ENVELOPE_PREFIX = "User has answered your questions:";
export const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";

export interface ToolResult {
	content: [{ type: "text"; text: string }];
	details: QuestionnaireResult;
}

export function buildToolResult(text: string, details: QuestionnaireResult): ToolResult {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

/**
 * Format a single answer segment for the LLM-facing envelope. Pure of `a`.
 *
 * Shape: `"<question>"="<answer>".`
 * If `kind === "option"` and `preview` is non-empty, the literal text
 * `. selected preview: <preview>` is inserted before the trailing period,
 * yielding `"<q>"="<a>". selected preview: <preview>.`. Notes are dropped.
 */
export function buildAnswerSegment(a: QuestionAnswer): string {
	const answerText = formatAnswerScalar(a);
	const parts: string[] = [`"${a.question}"="${answerText}"`];
	if (a.kind === "option" && a.preview && a.preview.length > 0) {
		parts.push(`selected preview: ${a.preview}`);
	}
	return `${parts.join(". ")}.`;
}

/** Two-sentence imperative used in the LLM-facing envelope when the user picks the chat sentinel.
 * The model needs the "Continue the conversation…" directive to know what to do next. Pinned for
 * byte-compat with the upstream rpiv extension's envelope. */
export const CHAT_CONTINUATION_MESSAGE =
	"User wants to chat about this. Continue the conversation to help them decide.";

/** Placeholder substituted for empty/null answer text in the envelope. Pinned for byte-compat. */
export const NO_INPUT_PLACEHOLDER = "(no input)";

function formatAnswerScalar(a: QuestionAnswer): string {
	switch (a.kind) {
		case "chat":
			return CHAT_CONTINUATION_MESSAGE;
		case "multi":
			return a.selected && a.selected.length > 0 ? a.selected.join(", ") : NO_INPUT_PLACEHOLDER;
		case "custom":
			return a.answer && a.answer.length > 0 ? a.answer : NO_INPUT_PLACEHOLDER;
		case "option":
			return a.answer && a.answer.length > 0 ? a.answer : NO_INPUT_PLACEHOLDER;
	}
}

/**
 * Map a `QuestionnaireResult` (or null/cancelled) to the LLM-facing tool
 * envelope. Cancelled and "no segments" both fall to `DECLINE_MESSAGE` so
 * the model sees a single canonical "didn't answer" signal regardless of
 * why.
 */
export function buildEnvelope(
	result: QuestionnaireResult | null | undefined,
	params: QuestionParams,
): ToolResult {
	if (!result || result.cancelled) {
		return buildToolResult(DECLINE_MESSAGE, {
			answers: result?.answers ?? [],
			cancelled: true,
		});
	}
	const segments: string[] = [];
	for (let i = 0; i < params.questions.length; i++) {
		const a = result.answers.find((x) => x.questionIndex === i);
		if (a) segments.push(buildAnswerSegment(a));
	}
	if (segments.length === 0) {
		return buildToolResult(DECLINE_MESSAGE, { answers: result.answers, cancelled: true });
	}
	return buildToolResult(`${ENVELOPE_PREFIX} ${segments.join(" ")} ${ENVELOPE_SUFFIX}`, result);
}
