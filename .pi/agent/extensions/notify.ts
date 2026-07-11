/**
 * notify
 *
 * Sends a native terminal notification when pi needs the user's attention:
 *   - agent_end:                     "ready for input" (turn finished)
 *   - ask_user_question tool start:  "question pending"
 *   - pi.events "notify:attention":  ad-hoc, used by allow-list before prompts
 *
 * Falls back silently if the terminal doesn't speak any supported protocol.
 *
 *  - OSC 777: iTerm2, WezTerm, Ghostty, rxvt-unicode
 *  - OSC 99:  Kitty (uses o=unfocused so the OS banner is suppressed when
 *             the kitty window has focus — the user is already looking)
 *  - PowerShell toast: Windows Terminal (WSL)
 *
 * Focus-aware behaviour is only guaranteed on Kitty. OSC 777 has no
 * in-protocol "only when unfocused" flag, so iTerm2/WezTerm/Ghostty will
 * fire regardless of focus. Use macOS Focus/DND or terminal-level settings
 * to filter those.
 *
 * Originally seeded from pi-coding-agent examples/extensions/notify.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function windowsToastScript(title: string, body: string): string {
	const type = "Windows.UI.Notifications";
	const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText01`;
	const toast = `[${type}.ToastNotification]::new($xml)`;
	return [
		`${mgr} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show(${toast})`,
	].join("; ");
}

function notifyOSC777(title: string, body: string): void {
	process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyOSC99(title: string, body: string): void {
	// o=unfocused: kitty itself only raises the desktop notification when its
	// window is not focused. d=0 = first chunk of metadata, payload is the title.
	process.stdout.write(`\x1b]99;i=1:o=unfocused:d=0;${title}\x1b\\`);
	process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

function notifyWindows(title: string, body: string): void {
	const { execFile } = require("node:child_process");
	execFile("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)]);
}

function notify(title: string, body: string): void {
	if (process.env.WT_SESSION) {
		notifyWindows(title, body);
	} else if (process.env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body);
	} else {
		notifyOSC777(title, body);
	}
}

interface AttentionPayload {
	title?: string;
	body?: string;
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async () => {
		notify("pi", "Ready for input");
	});

	// Fired when the agent calls ask_user_question. Notify on start so the
	// user is alerted while the question UI is still pending input.
	pi.on("tool_execution_start", async (event: { toolName: string }) => {
		if (event.toolName === "ask_user_question") {
			notify("pi", "Question pending");
		}
	});

	// Cross-extension hook. Other extensions (e.g. allow-list) can emit this
	// right before opening a blocking dialog, without re-implementing the
	// per-terminal notify logic.
	pi.events.on("notify:attention", (payload: AttentionPayload | undefined) => {
		const title = payload?.title ?? "pi";
		const body = payload?.body ?? "Attention required";
		notify(title, body);
	});
}
