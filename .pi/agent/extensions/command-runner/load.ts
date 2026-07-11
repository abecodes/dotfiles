/**
 * Command module loading — native dynamic import of a command's index.js.
 *
 * NO node:vm (see DESIGN.md "Trust model"): scripts run unsandboxed at the same
 * trust level as any extension. This module only does the import + shape
 * validation + invocation; truncation/delivery live in the runner. Kept free of
 * heavy runtime deps (the c-api import is type-only) so it is unit-testable by
 * importing tiny .js fixtures.
 */

import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { CommandApi, CommandModule } from "./c-api.ts";

/**
 * Import a command module and validate its default export. Throws a clear error
 * (naming the file) when there is no callable default export — the runner
 * catches it and surfaces it as a failed command rather than crashing pi.
 */
export async function loadCommandModule(file: string): Promise<CommandModule> {
	// Cache-bust by mtime: Node's ESM registry keys modules by URL forever, so
	// without this an edited command keeps serving the version imported earlier in
	// the process. Keying the query on mtimeMs means an unchanged file reuses the
	// cached module (no reload, no leak), while an edit pulls a fresh one — so
	// editing a command takes effect on its next run without restarting pi.
	// (Caveat: a helper module imported by index.js is keyed by its own URL; edits
	// to it aren't seen unless index.js's mtime also changes.)
	let version = "";
	try {
		version = `?m=${fs.statSync(file).mtimeMs}`;
	} catch {
		// stat failed (file vanished mid-run); import without a buster and let the
		// import error surface normally.
	}
	const mod = await import(pathToFileURL(file).href + version);
	if (typeof mod.default !== "function") {
		throw new Error(`command module ${file}: index.js must \`export default async (c, args) => string\``);
	}
	return mod.default as CommandModule;
}

/**
 * Load and run a command module, returning its report string. A non-string
 * return is coerced to string so the delivery path always has text. Errors
 * (missing default export, or a throw from the script) propagate to the caller.
 */
export async function runCommandModule(file: string, c: CommandApi, args: string): Promise<string> {
	const run = await loadCommandModule(file);
	const report = await run(c, args);
	return typeof report === "string" ? report : String(report ?? "");
}
