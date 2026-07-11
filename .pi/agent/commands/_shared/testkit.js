// Shared test scaffolding: a programmable fake `c` for unit-testing modules
// that take the command API. Loose file under _shared/ → not a command (the
// discoverer only registers <immediate-subdir>/index.js).

export function fakeC({ bash, read, write, agent, ask } = {}) {
	const writes = {};
	const log = [];
	return {
		args: "",
		_writes: writes,
		_log: log,
		log: (m) => log.push(m),
		async phase(_name, fn) {
			return fn();
		},
		async map(items, fn) {
			const out = [];
			for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i));
			return out;
		},
		async all(ps) {
			return Promise.all(ps);
		},
		async bash(cmd, opts) {
			return (bash ? bash(cmd, opts) : null) ?? { stdout: "", stderr: "", code: 0 };
		},
		async read(p) {
			return read ? read(p) : "";
		},
		async write(p, content) {
			writes[p] = content;
			if (write) write(p, content);
		},
		async agent(req) {
			return agent ? agent(req) : { ok: true, text: "", usage: {} };
		},
		async ask(params) {
			return ask ? ask(params) : { answers: [], cancelled: true, error: "no_ui" };
		},
	};
}

/** realpath that echoes its argument back (identity; no symlink translation). */
export function identityRealpath(cmd) {
	const m = /realpath '([^']*)'/.exec(cmd);
	if (m) return { stdout: m[1] + "\n", code: 0, stderr: "" };
	return null;
}
