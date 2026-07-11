/**
 * pi-portkey-auth fixes (active)
 * ==============================
 *
 * Companion to `pi-portkey-auth_fixes.ts.disabled`, which is the archived
 * reference / staging area for portkey -> Bedrock *payload-rewrite*
 * workarounds (strip eager_input_streaming, force adaptive thinking). See
 * that file's STATUS block and debug playbook before adding new payload
 * rewrites here.
 *
 * This file holds the one portkey fix that is currently REQUIRED:
 *
 *   Fix 3 — expose the `xhigh` thinking level on portkey Anthropic Opus
 *   models.
 *
 * ---------------------------------------------------------------------------
 * Why this is needed
 * ---------------------------------------------------------------------------
 *
 * pi-portkey-auth registers its models via pi.registerProvider() WITHOUT a
 * `thinkingLevelMap` (see environments.ts: the Opus entries only set
 * reasoning/cost/contextWindow/compat). pi-ai's getSupportedThinkingLevels()
 * has a special gate for the top rung:
 *
 *     if (level === "xhigh") return mapped !== undefined;
 *
 * i.e. every level EXCEPT xhigh is offered by default, but `xhigh` is only
 * offered when the model entry explicitly maps it. With no thinkingLevelMap,
 * `mapped` is undefined, so `xhigh` is filtered out and Shift+Tab
 * (app.thinking.cycle) caps at `high` on portkey/claude-opus-4-*.
 *
 * The built-in pi-ai catalog avoids this by shipping thinkingLevelMap on the
 * same models (opus-4-7 / opus-4-8 -> "xhigh", opus-4-6 -> "max"). We mirror
 * those provider effort values here.
 *
 * Why patch the live registry objects instead of the cleaner alternatives:
 *   - models.json `modelOverrides` only apply to BUILT-IN providers
 *     (ModelRegistry.loadBuiltInModels), never to a dynamically-registered
 *     provider like `portkey`.
 *   - Re-calling pi.registerProvider("portkey", { models }) is a FULL
 *     replacement and its validation requires re-supplying baseUrl +
 *     apiKey/oauth — which for portkey means reconstructing the gateway
 *     endpoint and OAuth config owned by pi-portkey-auth. Too coupled.
 *   - getSupportedThinkingLevels() reads the model object FRESH every time
 *     the level list is computed (footer render, Shift+Tab cycle, selector).
 *     ctx.modelRegistry.find(provider, id) returns that same live object, and
 *     agent state holds the same reference. So adding the field in place makes
 *     `xhigh` appear in the cycle immediately — no /reload required.
 *
 * Removable when pi-portkey-auth/environments.ts ships `thinkingLevelMap` on
 * its Opus entries (opus-4-8/4-7 -> "xhigh", opus-4-6 -> "max").
 *
 * ---------------------------------------------------------------------------
 * Startup clamp caveat (stickiness)
 * ---------------------------------------------------------------------------
 *
 * pi selects the initial model and clamps the saved `defaultThinkingLevel`
 * during bootstrap, BEFORE session_start fires — i.e. before this patch runs
 * and while `xhigh` is still hidden. So a saved default of "xhigh" gets
 * clamped down to "high" each launch, and the session starts at "high".
 * After this patch you can Shift+Tab up to "xhigh" normally.
 *
 * To make a level sticky despite that clamp, set PORTKEY_THINKING_DEFAULT
 * (e.g. "xhigh"); it is re-asserted on every session_start after the patch.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** pi `xhigh` -> provider effort value, matching pi-ai's built-in catalog. */
const XHIGH_EFFORT: Record<string, string> = {
  "claude-opus-4-8": "xhigh",
  "claude-opus-4-7": "xhigh",
  "claude-opus-4-6": "max",
};

/** Both portkey variant provider names (opencode + claude). */
const PORTKEY_PROVIDERS = ["portkey", "portkey-claude"];

const VALID_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = (typeof VALID_LEVELS)[number];

type PatchableModel = {
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
};

type ModelLookup = {
  find(provider: string, id: string): PatchableModel | undefined;
};

function patchPortkeyThinkingLevels(modelRegistry: ModelLookup): void {
  for (const provider of PORTKEY_PROVIDERS) {
    for (const [id, effort] of Object.entries(XHIGH_EFFORT)) {
      const model = modelRegistry.find(provider, id);
      if (!model || !model.reasoning) continue;
      if (model.thinkingLevelMap?.xhigh !== undefined) continue; // already mapped
      model.thinkingLevelMap = { ...(model.thinkingLevelMap ?? {}), xhigh: effort };
    }
  }
}

export default function piPortkeyAuthFixes(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    patchPortkeyThinkingLevels(ctx.modelRegistry as unknown as ModelLookup);

    // Optional stickiness knob — see "Startup clamp caveat" above.
    const desired = process.env.PORTKEY_THINKING_DEFAULT;
    if (desired && (VALID_LEVELS as readonly string[]).includes(desired)) {
      pi.setThinkingLevel(desired as ThinkingLevel);
    }
  });

  // Re-assert after a /reload re-registers fresh model objects, or any model swap.
  pi.on("model_select", (_event, ctx) => {
    patchPortkeyThinkingLevels(ctx.modelRegistry as unknown as ModelLookup);
  });
}
