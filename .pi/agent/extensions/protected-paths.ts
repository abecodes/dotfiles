/**
 * protected-paths
 *
 * Hard-blocks `edit` and `write` to sensitive paths. Reads its list from JSON
 * config files, mirroring the allow-list extension's layout:
 *
 *   ~/.pi/agent/protected-paths.json    (global)
 *   <cwd>/.pi/protected-paths.json      (project)
 *
 * Both files are merged (UNION — neither overrides the other; both contribute
 * restrictions). If neither file exists, a built-in default list is used.
 *
 * File format (either form is accepted):
 *
 *   ["path1", "path2"]
 *   { "paths": ["path1", "path2"] }
 *
 * Pattern semantics (segment-based, NOT substring):
 *
 *   ".env"           → file basename ".env" or ".env.<anything>" anywhere in the tree
 *                      (does NOT match "environment.go" or ".envoy/config")
 *   ".git/"          → trailing slash means "directory": match anything inside any
 *                      directory whose name is exactly ".git"
 *   "node_modules/"  → same, at any depth
 *
 * Slash command:
 *
 *   /protected-paths            interactive menu
 *   /protected-paths list       print effective list with sources
 *   /protected-paths reload     re-read both files from disk
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_PATHS: string[] = [
	".env",
	".envrc",
	".netrc",
	".npmrc",
	".pypirc",
	".git/",
	".ssh/",
	".aws/",
	"node_modules/",
	"vendor/",
];

interface LoadedConfig {
	paths: string[];
	sources: Array<{ scope: "default" | "global" | "project"; path: string; entries: string[] }>;
}

// --------------------------------------------------------------------------------------
// File IO
// --------------------------------------------------------------------------------------

function configDir(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

function globalConfigPath(): string {
	return path.join(configDir(), "protected-paths.json");
}

function projectConfigPath(cwd: string): string {
	return path.join(cwd, ".pi", "protected-paths.json");
}

function parseConfigFile(filePath: string): { entries: string[]; error?: string } | null {
	if (!fs.existsSync(filePath)) return null;
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		const list = Array.isArray(parsed)
			? parsed
			: parsed && typeof parsed === "object" && Array.isArray((parsed as { paths?: unknown }).paths)
				? ((parsed as { paths: unknown[] }).paths)
				: null;
		if (!list) {
			return { entries: [], error: "expected JSON array or { paths: [...] }" };
		}
		const entries = list.filter((x): x is string => typeof x === "string" && x.length > 0);
		return { entries };
	} catch (e) {
		return { entries: [], error: (e as Error).message };
	}
}

function loadConfig(cwd: string): { config: LoadedConfig; errors: Array<{ path: string; error: string }> } {
	const sources: LoadedConfig["sources"] = [];
	const errors: Array<{ path: string; error: string }> = [];

	const gPath = globalConfigPath();
	const pPath = projectConfigPath(cwd);

	const g = parseConfigFile(gPath);
	const pr = parseConfigFile(pPath);

	if (g?.error) errors.push({ path: gPath, error: g.error });
	if (pr?.error) errors.push({ path: pPath, error: pr.error });

	if (g) sources.push({ scope: "global", path: gPath, entries: g.entries });
	if (pr) sources.push({ scope: "project", path: pPath, entries: pr.entries });

	// If neither file exists, fall back to defaults.
	if (sources.length === 0) {
		sources.push({ scope: "default", path: "<built-in defaults>", entries: [...DEFAULT_PATHS] });
	}

	const merged = new Set<string>();
	for (const s of sources) for (const e of s.entries) merged.add(e);

	return { config: { paths: [...merged], sources }, errors };
}

// --------------------------------------------------------------------------------------
// Matching
// --------------------------------------------------------------------------------------

function pathSegments(p: string): string[] {
	const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
	return norm.split("/").filter(Boolean);
}

function isProtected(filePath: string, patterns: string[]): { hit: true; pattern: string } | { hit: false } {
	const segments = pathSegments(filePath);
	if (segments.length === 0) return { hit: false };

	for (const pat of patterns) {
		if (pat.endsWith("/")) {
			const dir = pat.slice(0, -1);
			if (!dir) continue;
			if (segments.includes(dir)) return { hit: true, pattern: pat };
		} else {
			const base = segments[segments.length - 1]!;
			if (base === pat || base.startsWith(`${pat}.`)) return { hit: true, pattern: pat };
		}
	}
	return { hit: false };
}

// --------------------------------------------------------------------------------------
// /protected-paths command helpers
// --------------------------------------------------------------------------------------

function listText(config: LoadedConfig): string {
	const lines: string[] = [];
	lines.push(`Effective protected paths (${config.paths.length} entr${config.paths.length === 1 ? "y" : "ies"}):`);
	for (const p of config.paths) lines.push(`  • ${p}`);
	lines.push("");
	lines.push("Sources:");
	for (const s of config.sources) {
		lines.push(`  [${s.scope}] ${s.path} — ${s.entries.length} entr${s.entries.length === 1 ? "y" : "ies"}`);
	}
	return lines.join("\n");
}

// --------------------------------------------------------------------------------------
// Extension entry point
// --------------------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	let config: LoadedConfig = { paths: [...DEFAULT_PATHS], sources: [] };

	const reload = (ctx: ExtensionContext) => {
		const result = loadConfig(ctx.cwd);
		config = result.config;
		for (const err of result.errors) {
			ctx.ui.notify(`protected-paths: failed to parse ${err.path}: ${err.error}`, "warning");
		}
		return config;
	};

	pi.on("session_start", async (_event, ctx) => {
		reload(ctx);
		const sourceSummary = config.sources.map((s) => s.scope).join("+") || "none";
		ctx.ui.notify(
			`protected-paths: ${config.paths.length} pattern(s) loaded (${sourceSummary})`,
			"info",
		);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

		const filePath = (event.input as { path?: unknown })?.path;
		if (typeof filePath !== "string" || !filePath) return undefined;

		const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.cwd, filePath);
		const result = isProtected(resolved, config.paths);
		if (!result.hit) return undefined;

		if (ctx.hasUI) {
			ctx.ui.notify(
				`protected-paths: blocked ${event.toolName} on "${filePath}" (matched ${result.pattern})`,
				"warning",
			);
		}
		return {
			block: true,
			reason: `Path "${filePath}" matches protected pattern "${result.pattern}". Edit it manually if you really need to.`,
		};
	});

	pi.registerCommand("protected-paths", {
		description: "View and reload protected-paths configuration",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim();
			let action = trimmed.split(/\s+/)[0] || "";

			if (!action) {
				const choice = await ctx.ui.select("Protected paths:", [
					"List effective paths",
					"Reload from disk",
				]);
				if (!choice) return;
				if (choice === "List effective paths") action = "list";
				else if (choice === "Reload from disk") action = "reload";
			}

			switch (action) {
				case "list":
					ctx.ui.notify(listText(config), "info");
					return;
				case "reload":
					reload(ctx);
					ctx.ui.notify(
						`protected-paths: reloaded — ${config.paths.length} pattern(s) active`,
						"info",
					);
					return;
				default:
					ctx.ui.notify(`Unknown action: ${action}. Use list|reload`, "warning");
			}
		},
	});
}
