/**
 * Command discovery — pure scanning of command directories.
 *
 * A command lives at  <baseDir>/<name>/index.js  (one command per immediate
 * subdir that contains an index.js). Kept dep-free so it is unit-testable over
 * a fixture dir without booting pi.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface DiscoveredCommand {
	name: string;
	/** Absolute path to the command's index.js. */
	file: string;
}

/**
 * Scan a single base dir for `<name>/index.js` command entries. Returns one
 * entry per immediate subdir that has an index.js, sorted by name for a stable
 * order. A missing or unreadable baseDir yields []; loose files and subdirs
 * without an index.js are skipped.
 */
export function discoverCommands(baseDir: string): DiscoveredCommand[] {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(baseDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const commands: DiscoveredCommand[] = [];
	for (const entry of entries) {
		// A command dir may itself be a symlink; resolve via statSync on the
		// candidate index.js rather than trusting the dirent type.
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		const file = path.join(baseDir, entry.name, "index.js");
		let isFile = false;
		try {
			isFile = fs.statSync(file).isFile();
		} catch {
			isFile = false;
		}
		if (isFile) commands.push({ name: entry.name, file });
	}

	commands.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return commands;
}

/**
 * Scan several base dirs in order and merge by name. Later dirs win on a name
 * clash — callers pass `[userDir, projectDir]` so a project command shadows a
 * user command of the same name. The merged result is sorted by name.
 */
export function discoverCommandDirs(baseDirs: readonly string[]): DiscoveredCommand[] {
	const byName = new Map<string, DiscoveredCommand>();
	for (const dir of baseDirs) {
		for (const cmd of discoverCommands(dir)) byName.set(cmd.name, cmd);
	}
	return Array.from(byName.values()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
