/**
 * pi-resolve.mjs — Module resolution hook for subagent unit tests.
 *
 * Redirects @earendil-works/* (and typebox) bare specifiers to their real
 * on-disk locations inside the globally-installed pi-coding-agent package. This
 * lets plain `node --test` load subagent source files that import from those
 * packages without needing a local node_modules installation.
 *
 * Usage:
 *   node --import ./test/pi-resolve.mjs --test test/dialog.test.ts
 *
 * Not needed for depth.ts / helpers.ts / progress.ts tests (they have no
 * third-party imports). Required for any test that imports index.ts (the
 * extension entry pulls in pi-agent-core, pi-ai, pi-tui, typebox).
 */
import { registerHooks } from "node:module";

const PI_AGENT_ROOT =
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent";

// Exact-match specifier -> absolute on-disk module.
const REDIRECTS = {
	"@earendil-works/pi-coding-agent": `${PI_AGENT_ROOT}/dist/index.js`,
	"@earendil-works/pi-tui": `${PI_AGENT_ROOT}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	"@earendil-works/pi-ai": `${PI_AGENT_ROOT}/node_modules/@earendil-works/pi-ai/dist/index.js`,
	"@earendil-works/pi-agent-core": `${PI_AGENT_ROOT}/node_modules/@earendil-works/pi-agent-core/dist/index.js`,
	typebox: `${PI_AGENT_ROOT}/node_modules/typebox/build/index.mjs`,
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		const target = REDIRECTS[specifier];
		if (target) return nextResolve(target, context);
		// Local siblings are authored as .ts but imported with a .js extension
		// (pi's runtime loader rewrites these; plain `node --test` does not). When
		// the .js doesn't exist on disk, fall back to the .ts source.
		if (specifier.startsWith(".") && specifier.endsWith(".js")) {
			try {
				return nextResolve(specifier, context);
			} catch {
				return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
			}
		}
		return nextResolve(specifier, context);
	},
});
