// /hello — greet someone, demoing the c API surface.
// args: an optional name to greet (defaults to "world").
//
// Exercises every result section: c.phase + c.log (Steps), c.bash (Calls),
// and c.agent (Agents). Run with `/hello Ada`, then ctrl+o to expand.
export default async (c, args) => {
	const name = args.trim() || "world";

	const ctx = await c.phase("context", async () => {
		c.log("gathering local context");
		const who = (await c.bash("whoami")).stdout.trim();
		const when = (await c.bash("date +%H:%M")).stdout.trim();
		c.log(`running as ${who} at ${when}`);
		return { who, when };
	});

	return await c.phase("greet", async () => {
		c.log(`asking scout to greet ${name}`);
		const r = await c.agent({
			agent: "scout",
			prompt: `Say a short, friendly one-line hello to ${name}. For context it is ${ctx.when} and the user is "${ctx.who}" — you may reference them lightly.`,
		});
		return r.ok ? r.text : `scout failed: ${r.error}`;
	});
};
