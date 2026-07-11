/**
 * Process-env overrides applied before package extensions load.
 *
 * Pi loads extensions in this order (see dist/core/extensions/loader.js,
 * discoverAndLoadExtensions):
 *   1. project-local: <cwd>/.pi/agent/extensions/
 *   2. global:        ~/.pi/agent/extensions/      <-- THIS FILE
 *   3. configured packages from settings.json `packages`
 *
 * Within bucket #2 the order is whatever `fs.readdirSync` returns. There's
 * no explicit sort, so we use a "00-" filename prefix to come first under
 * any alphabetical-ish ordering (APFS, ext4 with dir_index off, etc.).
 *
 * Use this file for env vars and other process-global tweaks that other
 * extensions (typically packages from `settings.json`) read at their own
 * factory-load time. Anything placed inside the exported factory below
 * runs AFTER package extensions, so put module-level side effects ABOVE
 * the export, like the PI_FFF_MODE line.
 *
 * Pattern: use `??=` so an explicit shell-exported value still wins.
 */

// pi-fff: default to tools-only (disable @-mention autocomplete editor override).
// Read at the top of @ff-labs/pi-fff's factory; we have to set it before that runs.
process.env.PI_FFF_MODE ??= "tools-only";

export default function envOverrides() {
  // No-op factory. All work happens at module load (above) so it runs
  // before package extensions are imported.
}
