/**
 * stats-demo.ts — TEMPORARY fabricated data for the /stats-demo command.
 *
 * Generates fake usage + savings rows so the dashboard can be previewed live
 * without any recorded history. Delete this file (and the /stats-demo command
 * block in index.ts) to remove the demo.
 */

import type { Granularity, SavingsRow, UsageRow } from "../_shared/usage-store.ts";

const MODELS = [
	{ provider: "anthropic", model: "anthropic/sonnet-4", base: 3.2 },
	{ provider: "openai", model: "openai/gpt-5", base: 1.8 },
	{ provider: "anthropic", model: "anthropic/haiku-4", base: 0.4 },
];

// Deterministic pseudo-random so the demo looks the same each render.
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0xffffffff;
	};
}

/** Bucket count + strftime-style label for a granularity. */
function buckets(granularity: Granularity): string[] {
	const now = new Date();
	const out: string[] = [];
	if (granularity === "hour") {
		for (let i = 23; i >= 0; i--) {
			const d = new Date(now.getTime() - i * 3600 * 1000);
			out.push(`${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, "0")}:00`);
		}
	} else if (granularity === "month") {
		for (let i = 11; i >= 0; i--) {
			const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
			out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
		}
	} else {
		for (let i = 29; i >= 0; i--) {
			const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
			out.push(d.toISOString().slice(0, 10));
		}
	}
	return out;
}

export function demoData(granularity: Granularity): { usage: UsageRow[]; savings: SavingsRow[] } {
	const rand = rng(granularity === "hour" ? 7 : granularity === "month" ? 13 : 42);
	const labels = buckets(granularity);
	const scale = granularity === "month" ? 22 : granularity === "hour" ? 0.5 : 1; // monthly sums are larger
	const usage: UsageRow[] = [];
	const savings: SavingsRow[] = [];

	labels.forEach((bucket, idx) => {
		const wave = 0.6 + 0.8 * Math.abs(Math.sin(idx / 3.3));
		const quiet = granularity === "day" && [0, 6].includes((idx + 4) % 7) ? 0.35 : 1;
		for (const m of MODELS) {
			const cost = +(m.base * scale * wave * quiet * (0.7 + 0.6 * rand())).toFixed(2);
			if (cost <= 0) continue;
			usage.push({
				bucket,
				provider: m.provider,
				model: m.model,
				agent: idx % 5 === 0 && m.model.includes("haiku") ? "coder" : null,
				calls: Math.max(1, Math.round(cost * 8)),
				input: Math.round(cost * 42000),
				output: Math.round(cost * 9000),
				cacheRead: Math.round(cost * 180000),
				cacheWrite: Math.round(cost * 5000),
				cost,
			});
		}
		const orig = Math.round((30000 + 40000 * wave) * scale * quiet);
		const comp = Math.round(orig * 0.23);
		savings.push({
			bucket,
			provider: "anthropic",
			model: "anthropic/sonnet-4",
			agent: null,
			tool: idx % 2 === 0 ? "read" : "bash",
			originalTokens: orig,
			compressedTokens: comp,
			estSavedUsd: +(((orig - comp) / 1e6) * 3.0).toFixed(4),
		});
	});

	return { usage, savings };
}
