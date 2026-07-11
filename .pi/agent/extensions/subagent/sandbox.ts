// ---------------------------------------------------------------------------
// Worktree sandbox for subagents (`sandbox: worktree`).
//
// Implements the spec in ~/.pi/sandbox.md. The sandbox wraps an individual
// `runSingleAgent` invocation in isolation + atomic integrate, at a layer the
// orchestrating LLM cannot skip:
//
//   isolate (on entry)  — snapshot the (possibly dirty) target into a private
//                         git worktree; the agent works there, never on the
//                         user's tree.
//   integrate (on exit) — fold the run's delta back into the real tree with a
//                         single, atomic, all-or-nothing plain `git apply`
//                         (never --3way / --index on the real tree). Conflicts
//                         are held back cleanly and reported.
//
// No @earendil-works/* imports: only node builtins + the `git` binary, so the
// pure helpers (env parse, boundary guard, cwd remap) are unit-testable under
// plain `node --test` exactly like depth.ts.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Env vars inherited by the whole descendant process tree of a sandboxed run.
// A child that sees PI_SANDBOX_BOUNDARY set is *inside* a sandbox and remaps
// its spawn cwd into the worktree (descendant remap, spec §7.4).
export const PI_SANDBOX_WORKTREE = "PI_SANDBOX_WORKTREE";
export const PI_SANDBOX_BOUNDARY = "PI_SANDBOX_BOUNDARY";
export const PI_SANDBOX_RUN = "PI_SANDBOX_RUN";
// The run baseline (dirty-tree snapshot the worktree branched from). Exported so
// descendants (the implement loop + its gateways) can diff "what this run
// changed" against it mechanically, without it being relayed through prose.
export const PI_SANDBOX_BASE = "PI_SANDBOX_BASE";

export type EnvLike = Record<string, string | undefined>;

export interface SandboxEnv {
	worktree: string;
	boundary: string;
	run: string;
}

/** Read the inherited sandbox env, or null when not inside a sandbox. */
export function readSandboxEnv(env: EnvLike = process.env): SandboxEnv | null {
	const worktree = env[PI_SANDBOX_WORKTREE];
	const boundary = env[PI_SANDBOX_BOUNDARY];
	const run = env[PI_SANDBOX_RUN];
	if (!worktree || !boundary || !run) return null;
	return { worktree, boundary, run };
}

// Fail-closed denylist for the derived boundary. A sandbox that isolated `/` or
// `$HOME` would either checkout the world or, worse, integrate over it. These
// are degenerate targets: refuse rather than guess.
function defaultDenylist(home: string): string[] {
	const list = ["/", home, path.join(home, ".pi"), path.join(home, ".pi", "agent")];
	return list.map((p) => path.resolve(p));
}

/**
 * True when `boundary` must be refused as a sandbox target. Pure: the home dir
 * and an optional extra denylist are passed in so tests don't depend on $HOME.
 */
export function isDegenerateBoundary(
	boundary: string,
	home: string = os.homedir(),
	extraDenylist: string[] = [],
): boolean {
	const resolved = path.resolve(boundary);
	if (resolved === "" || resolved === "/" || resolved === ".") return true;
	// A bare volume root or filesystem root: refuse.
	if (path.dirname(resolved) === resolved) return true;
	const deny = [...defaultDenylist(home), ...extraDenylist.map((p) => path.resolve(p))];
	return deny.includes(resolved);
}

/**
 * Descendant cwd remap (spec §7.4): if `requested` is the sandbox boundary or
 * anything under it, rewrite it to the corresponding path under the worktree.
 * Otherwise return it unchanged. Pure string math (no realpath) so it composes
 * with whatever path the controller narrated to its child.
 */
export function remapCwd(requested: string, env: SandboxEnv): string {
	const boundary = path.resolve(env.boundary);
	const worktree = path.resolve(env.worktree);
	const target = path.resolve(requested);
	if (target === boundary) return worktree;
	const rel = path.relative(boundary, target);
	// rel starts with ".." (escapes boundary) or is absolute => not inside.
	if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return requested;
	return path.join(worktree, rel);
}

/** Short, collision-resistant run id (8 hex chars). */
export function newRunId(): string {
	return crypto.randomBytes(4).toString("hex");
}

// ---------------------------------------------------------------------------
// git plumbing (impure)
// ---------------------------------------------------------------------------

// Deterministic identity so commit-tree / commit never fail on an unconfigured
// machine. These commits live only on throwaway refs / scratch repos.
const GIT_IDENTITY: EnvLike = {
	GIT_AUTHOR_NAME: "pi-sandbox",
	GIT_AUTHOR_EMAIL: "pi-sandbox@local",
	GIT_COMMITTER_NAME: "pi-sandbox",
	GIT_COMMITTER_EMAIL: "pi-sandbox@local",
};

interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

function runGit(args: string[], opts: { cwd?: string; env?: EnvLike } = {}): GitResult {
	const res = spawnSync("git", args, {
		cwd: opts.cwd,
		env: { ...process.env, ...GIT_IDENTITY, ...(opts.env ?? {}) } as NodeJS.ProcessEnv,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	});
	return {
		code: res.status ?? (res.error ? 1 : 0),
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? (res.error ? String(res.error) : ""),
	};
}

function gitOrThrow(args: string[], opts: { cwd?: string; env?: EnvLike } = {}): string {
	const r = runGit(args, opts);
	if (r.code !== 0) {
		throw new Error(`git ${args.join(" ")} failed (${r.code}): ${r.stderr.trim()}`);
	}
	return r.stdout;
}

/** Copy `src` -> `dst` preferring a copy-on-write clone, falling back to a deep copy. */
function copyTree(src: string, dst: string): void {
	fs.mkdirSync(path.dirname(dst), { recursive: true });
	// Try reflink/clone first (near-instant, space-cheap on APFS/btrfs/xfs). This
	// only wins when src and dst share a filesystem — see the platform note on
	// `sandboxRoot` in index.ts for the Linux tmpfs/cross-fs caveat. On Windows
	// there is no `cp`, so every attempt below fails and we fall through to the
	// fs.cpSync full copy (correct, no COW).
	const attempts: string[][] = process.platform === "darwin"
		? [["-c", "-R", "-p", src, dst], ["-R", "-p", src, dst]]
		: [["-a", "--reflink=auto", src, dst], ["-a", src, dst]];
	for (const args of attempts) {
		const r = spawnSync("cp", args, { encoding: "utf8" });
		if ((r.status ?? 1) === 0) return;
	}
	// Last resort: node recursive copy.
	fs.cpSync(src, dst, { recursive: true });
}

// ---------------------------------------------------------------------------
// Boundary lock: in-process mutex (parallel runs in one orchestrator) + atomic
// on-disk mkdir lock (rare cross-process case). Held only for the few shared
// git mutations, never across the agent run.
// ---------------------------------------------------------------------------

const inProcLocks = new Map<string, Promise<void>>();

// Locks live alongside the run dirs under the OS temp dir (per-user, stable,
// self-cleaning). A stale lock wiped on reboot is harmless — no in-flight run
// survives a reboot anyway.
function lockPathFor(boundary: string): string {
	const hash = crypto.createHash("sha1").update(path.resolve(boundary)).digest("hex").slice(0, 16);
	return path.join(os.tmpdir(), "pi-sandbox", "locks", `${hash}.lock`);
}

const DISK_LOCK_STALE_MS = 60_000;
const DISK_LOCK_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function acquireDiskLock(lockDir: string): Promise<void> {
	fs.mkdirSync(path.dirname(lockDir), { recursive: true });
	const deadline = Date.now() + DISK_LOCK_TIMEOUT_MS;
	for (;;) {
		try {
			fs.mkdirSync(lockDir);
			try {
				fs.writeFileSync(path.join(lockDir, "pid"), String(process.pid));
			} catch {
				/* best effort */
			}
			return;
		} catch (err: any) {
			if (err?.code !== "EEXIST") throw err;
			// Steal a stale lock (holder crashed mid-integrate).
			try {
				const age = Date.now() - fs.statSync(lockDir).mtimeMs;
				if (age > DISK_LOCK_STALE_MS) {
					fs.rmSync(lockDir, { recursive: true, force: true });
					continue;
				}
			} catch {
				/* lock vanished; retry mkdir */
			}
			if (Date.now() > deadline) {
				throw new Error(`sandbox: timed out acquiring boundary lock at ${lockDir}`);
			}
			await sleep(50);
		}
	}
}

function releaseDiskLock(lockDir: string): void {
	try {
		fs.rmSync(lockDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
}

/** Serialize `fn` against everything else touching the same boundary. */
export async function withBoundaryLock<T>(
	boundary: string,
	fn: () => Promise<T>,
): Promise<T> {
	const key = path.resolve(boundary);
	const prev = inProcLocks.get(key) ?? Promise.resolve();
	let releaseInProc!: () => void;
	const mine = new Promise<void>((r) => {
		releaseInProc = r;
	});
	inProcLocks.set(key, prev.then(() => mine));
	await prev.catch(() => {});

	const lockDir = lockPathFor(boundary);
	await acquireDiskLock(lockDir);
	try {
		return await fn();
	} finally {
		releaseDiskLock(lockDir);
		releaseInProc();
		// Drop the map entry if no one chained after us.
		if (inProcLocks.get(key) === prev.then(() => mine)) inProcLocks.delete(key);
	}
}

// ---------------------------------------------------------------------------
// isolate / integrate
// ---------------------------------------------------------------------------

export interface ActiveSandbox {
	runId: string;
	isGit: boolean;
	/** The real tree we integrate into: the git repo root, or the plain folder. */
	boundary: string;
	/** Args selecting the repo that holds BASE/run: `-C <boundary>` (git) or `--git-dir <scratch>/.git` (non-git). */
	repoArgs: string[];
	base: string;
	runBranch: string;
	/** Agent's spawn cwd: worktree root + the caller's original relative subpath. */
	worktree: string;
	worktreeCwd: string;
	runDir: string;
	env: Record<string, string>;
}

export interface IsolateOk {
	ok: true;
	sandbox: ActiveSandbox;
	boundary: string;
}
export interface IsolateErr {
	ok: false;
	error: string;
	boundary?: string;
}
export type IsolateResult = IsolateOk | IsolateErr;

export interface IntegrationResult {
	status: "landed" | "conflict" | "error";
	target: string;
	reason?: string;
	files: string[];
	class?: "ordering" | "overlap";
	worktree: string;
	branch: string;
}

/**
 * isolate(cwd) — derive the boundary, snapshot the dirty tree into a private
 * worktree, and return the spawn cwd + PI_SANDBOX_* env. Never touches the
 * user's HEAD / branches / index. The shared git mutations run under the
 * boundary lock; the ignored-file clone (worktree-local) runs after release.
 */
export async function isolate(opts: {
	cwd: string;
	sandboxRoot: string;
	extraDenylist?: string[];
}): Promise<IsolateResult> {
	let resolvedCwd: string;
	try {
		resolvedCwd = fs.realpathSync(opts.cwd);
	} catch {
		return { ok: false, error: `cwd does not exist: ${opts.cwd}` };
	}
	if (!fs.statSync(resolvedCwd).isDirectory()) {
		return { ok: false, error: `cwd is not a directory: ${resolvedCwd}` };
	}

	// git boundary = repo root (walking up); non-git boundary = the folder.
	const top = runGit(["-C", resolvedCwd, "rev-parse", "--show-toplevel"]);
	const isGit = top.code === 0 && top.stdout.trim() !== "";
	const boundary = isGit ? fs.realpathSync(top.stdout.trim()) : resolvedCwd;

	if (isDegenerateBoundary(boundary, os.homedir(), opts.extraDenylist)) {
		return { ok: false, error: `refusing degenerate sandbox boundary: ${boundary}`, boundary };
	}

	const relpath = path.relative(boundary, resolvedCwd);
	const runId = newRunId();
	const runDir = path.join(opts.sandboxRoot, `run_${runId}`);
	const worktree = path.join(runDir, "worktree");
	const runBranch = `sandbox/run_${runId}`;
	fs.mkdirSync(runDir, { recursive: true });

	try {
		let repoArgs: string[];
		let base: string;

		if (isGit) {
			// Fake-index dangling commit of the dirty tree (tracked + untracked,
			// honoring .gitignore). Touches nothing real: own index, own commit.
			const tmpIndex = path.join(runDir, "fake-index");
			base = await withBoundaryLock(boundary, async () => {
				gitOrThrow(["-C", boundary, "add", "-A"], { env: { GIT_INDEX_FILE: tmpIndex } });
				const tree = gitOrThrow(["-C", boundary, "write-tree"], {
					env: { GIT_INDEX_FILE: tmpIndex },
				}).trim();
				const hasHead = runGit(["-C", boundary, "rev-parse", "--verify", "-q", "HEAD"]).code === 0;
				const commitArgs = hasHead
					? ["-C", boundary, "commit-tree", tree, "-p", "HEAD", "-m", "sandbox-base"]
					: ["-C", boundary, "commit-tree", tree, "-m", "sandbox-base"];
				const sha = gitOrThrow(commitArgs).trim();
				gitOrThrow(["-C", boundary, "worktree", "add", "--detach", worktree, sha]);
				gitOrThrow(["-C", worktree, "checkout", "-b", runBranch]);
				return sha;
			});
			try {
				fs.rmSync(tmpIndex, { force: true });
			} catch {
				/* ignore */
			}
			repoArgs = ["-C", boundary];

			// Carry ignored-but-needed files (node_modules, .venv, .env, ...) so the
			// gateway can build. COW where possible; writes during the run hit this
			// clone, and ignored files never enter BASE..run so they're discarded.
			const ignored = runGit([
				"-C", boundary, "ls-files", "-z", "-o", "-i", "--exclude-standard", "--directory",
			]);
			if (ignored.code === 0 && ignored.stdout) {
				for (const entry of ignored.stdout.split("\0")) {
					const rel = entry.replace(/\/$/, "");
					if (!rel) continue;
					const from = path.join(boundary, rel);
					const to = path.join(worktree, rel);
					try {
						if (fs.existsSync(from) && !fs.existsSync(to)) copyTree(from, to);
					} catch {
						/* a missing dep clone is not fatal to isolation */
					}
				}
			}
		} else {
			// Non-git folder: snapshot the WHOLE folder (incl. ignored) into a
			// scratch repo's object store via GIT_WORK_TREE, then check the agent
			// worktree out of it. The plain folder is only written at integrate.
			const scratchGit = path.join(runDir, "scratch.git");
			const tmpIndex = path.join(runDir, "fake-index");
			gitOrThrow(["init", "-q", "--bare", scratchGit]);
			repoArgs = ["--git-dir", scratchGit];
			gitOrThrow([...repoArgs, "add", "-A", "-f"], {
				env: { GIT_WORK_TREE: boundary, GIT_INDEX_FILE: tmpIndex },
			});
			const tree = gitOrThrow([...repoArgs, "write-tree"], {
				env: { GIT_WORK_TREE: boundary, GIT_INDEX_FILE: tmpIndex },
			}).trim();
			base = gitOrThrow([...repoArgs, "commit-tree", tree, "-m", "sandbox-base"]).trim();
			gitOrThrow([...repoArgs, "worktree", "add", "--detach", worktree, base]);
			gitOrThrow(["-C", worktree, "checkout", "-b", runBranch]);
			try {
				fs.rmSync(tmpIndex, { force: true });
			} catch {
				/* ignore */
			}
		}

		const worktreeCwd = relpath && !relpath.startsWith("..") ? path.join(worktree, relpath) : worktree;
		try {
			fs.mkdirSync(worktreeCwd, { recursive: true });
		} catch {
			/* worktree checkout already created it */
		}

		const env = {
			[PI_SANDBOX_WORKTREE]: worktree,
			[PI_SANDBOX_BOUNDARY]: boundary,
			[PI_SANDBOX_RUN]: runId,
			[PI_SANDBOX_BASE]: base,
		};

		const sandbox: ActiveSandbox = {
			runId, isGit, boundary, repoArgs, base, runBranch, worktree, worktreeCwd, runDir, env,
		};
		writeManifest(sandbox, relpath);
		return { ok: true, sandbox, boundary };
	} catch (err) {
		// Setup failed: tear down whatever we created so a half-built run dir
		// doesn't linger. Isolation never partially succeeds.
		try {
			cleanupSandbox(boundary, repoArgsFromFailure(isGit, boundary, runDir), worktree, runBranch, runDir);
		} catch {
			/* ignore */
		}
		return { ok: false, error: err instanceof Error ? err.message : String(err), boundary };
	}
}

function repoArgsFromFailure(isGit: boolean, boundary: string, runDir: string): string[] {
	return isGit ? ["-C", boundary] : ["--git-dir", path.join(runDir, "scratch.git")];
}

function writeManifest(s: ActiveSandbox, relpath: string): void {
	try {
		fs.writeFileSync(
			path.join(s.runDir, "manifest.json"),
			JSON.stringify(
				{
					runId: s.runId, isGit: s.isGit, boundary: s.boundary, relpath,
					base: s.base, runBranch: s.runBranch, worktree: s.worktree,
				},
				null,
				2,
			),
		);
	} catch {
		/* manifest is for debugging; never fatal */
	}
}

function cleanupSandbox(
	boundary: string,
	repoArgs: string[],
	worktree: string,
	runBranch: string,
	runDir: string,
): void {
	runGit([...repoArgs, "worktree", "remove", "--force", worktree]);
	runGit([...repoArgs, "branch", "-D", runBranch]);
	runGit([...repoArgs, "worktree", "prune"]);
	try {
		fs.rmSync(runDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
}

/**
 * integrate — fold the run's delta back into the boundary atomically.
 *
 * The real tree is only ever written by a plain `git apply` of a clean forward
 * patch (never --3way / --index). If the boundary drifted (user edits or a
 * sibling landed) we attempt a 3-way merge in scratch and forward-apply its
 * clean result; genuine same-line overlap is held back (worktree preserved).
 *
 * `aborted` runs are never applied — their worktree may hold half-written
 * edits; we preserve it and report.
 */
export async function integrate(
	s: ActiveSandbox,
	opts: { sandboxRoot: string; aborted?: boolean },
): Promise<IntegrationResult> {
	const base: IntegrationResult = {
		status: "landed", target: s.boundary, files: [], worktree: s.runDir, branch: s.runBranch,
	};
	try {
		// Snapshot the worktree's uncommitted edits onto the run branch (honors
		// .gitignore, so cloned deps stay out of the delta).
		gitOrThrow(["-C", s.worktree, "add", "-A"]);
		const dirty = runGit(["-C", s.worktree, "diff", "--cached", "--quiet"]).code !== 0;
		if (dirty) {
			gitOrThrow(["-C", s.worktree, "commit", "-q", "-m", "sandbox-run", "--no-verify"]);
		}

		const range = `${s.base}..${s.runBranch}`;
		const files = runGit([...s.repoArgs, "diff", "--name-only", range])
			.stdout.split("\n").map((l) => l.trim()).filter(Boolean);

		if (files.length === 0) {
			// No changes produced. Nothing to integrate; clean up.
			cleanupSandbox(s.boundary, s.repoArgs, s.worktree, s.runBranch, s.runDir);
			return { ...base, status: "landed", files: [] };
		}

		if (opts.aborted) {
			return {
				...base, status: "conflict", class: "overlap", files,
				reason: "run was aborted mid-flight; worktree preserved, nothing applied",
			};
		}

		const patchPath = path.join(s.runDir, "delta.patch");
		fs.writeFileSync(patchPath, gitOrThrow([...s.repoArgs, "diff", "--binary", range]));

		return await withBoundaryLock(s.boundary, async () => {
			// 1. Fast path: clean forward apply against the CURRENT tree.
			const check = runGit(["apply", "--check", patchPath], { cwd: s.boundary });
			if (check.code === 0) {
				gitOrThrow(["apply", patchPath], { cwd: s.boundary });
				cleanupSandbox(s.boundary, s.repoArgs, s.worktree, s.runBranch, s.runDir);
				return { ...base, status: "landed", files };
			}

			// 2. Drift: try a 3-way merge in scratch, forward-apply the clean result.
			const merged = s.isGit ? tryScratchMerge(s, patchPath) : null;
			if (merged && merged.ok) {
				const mcheck = runGit(["apply", "--check", merged.patchPath], { cwd: s.boundary });
				if (mcheck.code === 0) {
					gitOrThrow(["apply", merged.patchPath], { cwd: s.boundary });
					cleanupSandbox(s.boundary, s.repoArgs, s.worktree, s.runBranch, s.runDir);
					return { ...base, status: "landed", class: "ordering", files };
				}
			}

			// 3. Genuine overlap: write nothing, preserve worktree + branch.
			return {
				...base, status: "conflict", class: "overlap", files,
				reason:
					`delta overlaps the current tree in: ${files.join(", ")}. ` +
					`Worktree preserved at ${s.worktree} on branch ${s.runBranch}.`,
			};
		});
	} catch (err) {
		return {
			...base, status: "error", files: [],
			reason: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Attempt a 3-way merge of the run against the CURRENT boundary tree, entirely
 * in the repo's object store (no checkout, clean index). Returns a clean
 * forward patch on success; null on conflict or unsupported git.
 */
function tryScratchMerge(s: ActiveSandbox, _patchPath: string): { ok: true; patchPath: string } | null {
	try {
		// CUR = current boundary tree as a commit parented on BASE, so the merge
		// base of (CUR, run) is exactly BASE -> a true 3-way.
		const tmpIndex = path.join(s.runDir, "cur-index");
		gitOrThrow([...s.repoArgs, "add", "-A"], {
			cwd: s.boundary, env: { GIT_INDEX_FILE: tmpIndex },
		});
		const curTree = gitOrThrow([...s.repoArgs, "write-tree"], {
			cwd: s.boundary, env: { GIT_INDEX_FILE: tmpIndex },
		}).trim();
		fs.rmSync(tmpIndex, { force: true });
		const cur = gitOrThrow([...s.repoArgs, "commit-tree", curTree, "-p", s.base, "-m", "sandbox-current"]).trim();

		// `merge-tree --write-tree` (git >= 2.38) merges and reports conflicts via
		// exit code without touching any working tree.
		const mt = runGit([...s.repoArgs, "merge-tree", "--write-tree", cur, s.runBranch]);
		if (mt.code !== 0) return null; // conflicts, or merge-tree unsupported
		const mergedTree = mt.stdout.split("\n")[0]?.trim();
		if (!mergedTree) return null;

		const patchPath = path.join(s.runDir, "merged.patch");
		fs.writeFileSync(patchPath, gitOrThrow([...s.repoArgs, "diff", "--binary", `${curTree}..${mergedTree}`]));
		return { ok: true, patchPath };
	} catch {
		return null;
	}
}

/** Periodic reclamation of worktrees/branches left by failed (preserved) runs. */
export function pruneStaleRuns(sandboxRoot: string): void {
	// Worktree admin entries are pruned per-boundary lazily at cleanup; here we
	// just drop run dirs with no live worktree marker older than a day.
	try {
		const dir = path.join(sandboxRoot);
		if (!fs.existsSync(dir)) return;
		const cutoff = Date.now() - 24 * 60 * 60 * 1000;
		for (const name of fs.readdirSync(dir)) {
			if (!name.startsWith("run_")) continue;
			const p = path.join(dir, name);
			try {
				if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	} catch {
		/* ignore */
	}
}
