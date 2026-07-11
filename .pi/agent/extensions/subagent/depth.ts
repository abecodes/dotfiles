// ---------------------------------------------------------------------------
// Subagent depth guard + pi spawn-arg construction.
//
// Pure helpers, no @earendil-works/* imports. Lives in its own file so plain
// `node --test` can import it without resolving pi's bundled packages.
//
// The child `pi -p` process loads the same set of extensions as the parent,
// including this one. Without a guard, a misbehaving agent could call the
// `subagent` tool itself and spawn grandchildren — fork-bomb territory.
//
// `--tools` already prevents this when the agent declares its tools list (we
// don't include `subagent` in any agent's `tools:`), but agents that omit a
// tools list inherit the full toolset. The depth env var is the
// belt-and-suspenders backstop.
//
// Defaults to MAX_SUBAGENT_DEPTH=2 (parent → child OK, grandchild rejected).
// Override with PI_SUBAGENT_MAX_DEPTH=<n>.
// ---------------------------------------------------------------------------

// Minimal process stub so this file type-checks without @types/node.
// At runtime (pi's bundled runtime, plain node) `process` is a global.
declare const process: { env: Record<string, string | undefined> };

export const SUBAGENT_DEPTH_ENV_VAR = "PI_SUBAGENT_DEPTH";
export const SUBAGENT_MAX_DEPTH_ENV_VAR = "PI_SUBAGENT_MAX_DEPTH";

// Carries the spawning agent's name to the child process so the usage-tracker
// extension (running in the child) can attribute its LLM calls to that agent.
// Each nesting level overwrites it with its own child's name; NULL at depth 0.
// See usage-tracker/DESIGN.md §4.
export const SUBAGENT_NAME_ENV_VAR = "PI_SUBAGENT_NAME";
export const DEFAULT_MAX_SUBAGENT_DEPTH = 2;

// Cross-extension protocol with allow-list. The subagent extension serializes
// the agent's frontmatter `tools: bash(go test:*)` patterns into a RuleFile
// shape (allow / ask / deny string arrays of `Bash(go test:*)`-style rules)
// and sets it as JSON in this env var on spawn. The allow-list extension
// running in the child process reads it during session_start and merges it
// into its session-scope rule set.
//
// The name MUST stay in sync with allow-list/index.ts's
// SUBAGENT_PERMISSION_OVERRIDE_ENV_VAR. Documented in both READMEs.
export const SUBAGENT_PERMISSION_OVERRIDE_ENV_VAR = "PI_SUBAGENT_PERMISSION_OVERRIDE";

// Sentinel set by allow-list when its factory runs in the parent process.
// The subagent spawn path reads this to decide whether scoped tool patterns
// can actually be enforced; if allow-list is missing, the spawn is refused
// rather than silently letting the patterns no-op.
export const ALLOW_LIST_ACTIVE_ENV_VAR = "PI_ALLOW_LIST_ACTIVE";

type EnvLike = Record<string, string | undefined>;

export function getCurrentDepth(env: EnvLike = process.env): number {
	const raw = env[SUBAGENT_DEPTH_ENV_VAR];
	if (!raw) return 0;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function getMaxDepth(env: EnvLike = process.env): number {
	const raw = env[SUBAGENT_MAX_DEPTH_ENV_VAR];
	if (!raw) return DEFAULT_MAX_SUBAGENT_DEPTH;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX_SUBAGENT_DEPTH;
}

export function checkDepthOk(env: EnvLike = process.env): {
	ok: boolean;
	current: number;
	limit: number;
} {
	const current = getCurrentDepth(env);
	const limit = getMaxDepth(env);
	return { ok: current < limit, current, limit };
}

// Build the `pi -p` spawn args for a given agent invocation.
// Extracted so tests can verify arg shape without spawning processes.
//
// Validation: callers (agents.ts) are expected to pre-validate `thinkingLevel`
// against pi's allowed set. We don't re-check here because this function is
// also called directly from tests with hand-rolled inputs; that test surface
// would have to mirror the validator, which is the producer's job.
export function buildSpawnArgs(
	agent: { model?: string; tools?: string[]; thinkingLevel?: string },
	task: string,
	tmpPromptPath: string | null,
	opts: { mode?: "json" | "rpc" } = {},
): string[] {
	const mode = opts.mode ?? "json";
	const args: string[] = mode === "rpc"
		? ["--mode", "rpc", "--no-session"]
		: ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.thinkingLevel) args.push("--thinking", agent.thinkingLevel);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
	if (tmpPromptPath) args.push("--append-system-prompt", tmpPromptPath);
	if (mode === "json") args.push(`Task: ${task}`);
	// RPC mode: task is sent via stdin after spawn (see subagent/index.ts pump).
	return args;
}

// Tool-name canonicalization for emitting allow-list rule strings. Lowercase
// pi tool names (`bash`, `read`, ...) are mapped to allow-list's canonical
// form (`Bash`, `Read`, ...). Names not in this map pass through unchanged
// (custom tools etc.); allow-list compares case-insensitively anyway, this
// is purely cosmetic for readability of the rule strings in logs/notifies.
const TOOL_CANONICAL: Record<string, string> = {
	bash: "Bash",
	read: "Read",
	write: "Write",
	edit: "Edit",
	grep: "Grep",
	find: "Find",
	ls: "List",
};

function canonicalToolName(name: string): string {
	return TOOL_CANONICAL[name.toLowerCase()] ?? name;
}

// Convert parsed agent-frontmatter tool entries into a RuleFile-shaped object
// suitable for serializing into PI_SUBAGENT_PERMISSION_OVERRIDE. Every entry
// produces an allow rule:
//   - Bare entry `read`                  → `"Read"`                (matches any Read call)
//   - Scoped Bash entry `bash(go test:*)` → `"Bash(go test:*)"`     (or `bash(go test)`,
//     equivalent — `:*` is auto-appended for Bash patterns since it's the prefix-match
//     marker bashBodyMatches expects).
//   - Scoped non-Bash entry `subagent(agent:coder)` → `"subagent(agent:coder)"` (no `:*`
//     appended — Subagent / WebFetch domain / custom Task tools use key:value equality
//     matching via argKeyValueMatches, where appending `:*` would corrupt the value).
//
// The override carries the *positive* permission surface for the spawned
// child; allow-list runs in **constrained-override mode** when this env
// var is present. The agent's allow rules are the only positive surface
// (parent allow rules are dropped), but parent project + global `deny`
// and `ask` rules are inherited as a defense-in-depth backstop. Bare
// entries must therefore emit a bare allow rule; otherwise the spawned
// child would have no rule for those tools and allow-list would block
// every call to them.
//
// Pure: takes plain data, returns plain data. The actual env construction is
// in buildPermissionOverrideEnv so the rule-file shape can be tested
// independently of env-var serialization.
export function toolEntriesToRuleFile(
	toolEntries?: Array<{ name: string; patterns?: string[] }>,
): { allow: string[]; ask: string[]; deny: string[] } {
	const allow: string[] = [];
	if (toolEntries) {
		for (const e of toolEntries) {
			const canon = canonicalToolName(e.name);
			if (!e.patterns || e.patterns.length === 0) {
				allow.push(canon);
				continue;
			}
			for (const p of e.patterns) {
				// `:*` is a Bash-specific prefix-match marker (see bashBodyMatches in
				// _shared/permission-rules.ts). Auto-append it for Bash patterns so
				// `bash(go test)` and `bash(go test:*)` mean the same thing. For other
				// tools (Subagent, WebFetch domain, Task, custom), the matcher uses
				// argKeyValueMatches with strict equality on the value — appending `:*`
				// there breaks the rule (`agent:coder` becomes `agent:coder:*`, fails
				// to match `input.agent === "coder"`).
				const isBash = canon === "Bash";
				const body = isBash && !p.endsWith(":*") ? `${p}:*` : p;
				allow.push(`${canon}(${body})`);
			}
		}
	}
	return { allow, ask: [], deny: [] };
}

// Build the env-var fragment that carries the agent's frontmatter patterns to
// the child process as an allow-list permission override. Returns an empty
// object when the agent declared no scoped tools.
export function buildPermissionOverrideEnv(
	toolEntries?: Array<{ name: string; patterns?: string[] }>,
): Record<string, string> {
	const rf = toolEntriesToRuleFile(toolEntries);
	if (rf.allow.length === 0 && rf.ask.length === 0 && rf.deny.length === 0) return {};
	return { [SUBAGENT_PERMISSION_OVERRIDE_ENV_VAR]: JSON.stringify(rf) };
}

// Whether the parent process has an allow-list extension that's loaded and
// will honor PI_SUBAGENT_PERMISSION_OVERRIDE. Set by allow-list/index.ts in
// its factory; read here at spawn time to decide whether scoped patterns can
// be enforced. Pure (env in, boolean out) so unit tests don't have to mock
// the global allow-list factory.
export function isAllowListActive(env: EnvLike = process.env): boolean {
	return env[ALLOW_LIST_ACTIVE_ENV_VAR] === "1";
}

// Returns true iff the agent declared any tool entries at all (scoped or
// bare). Under the constrained-override contract, declaring ANY tools opts
// the agent into the override path: subagent ships the override env, the
// child's allow-list builds the session rule file from the override plus
// inherited parent deny+ask rules, and the spawn-time presence check
// requires allow-list to be active.
//
// Agents with no `tools:` field at all are unaffected — they continue to
// inherit the parent's full pi inventory and the user's permission.json.
export function hasToolEntries(
	toolEntries?: Array<{ name: string; patterns?: string[] }>,
): boolean {
	return Array.isArray(toolEntries) && toolEntries.length > 0;
}
