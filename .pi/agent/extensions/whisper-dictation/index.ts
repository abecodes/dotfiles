// whisper-dictation
//
// Toggle "audio mode" with a keyboard shortcut, speak, and have the
// transcription inserted into the editor for review before you submit it.
//
// Two capture strategies are exposed behind two shortcuts so you can compare:
//
//   ctrl+space -> streaming mode  (whisper.cpp `whisper-stream`, mic built in,
//                                  no audio file written; lower latency, noisier)
//   alt+a      -> record mode     (recorder -> temp WAV -> `whisper-cli` once;
//                                  one extra dependency + a temp file, but more
//                                  accurate and trivial to parse)
//
// Both strategies insert the transcript into the input editor (appending to any
// text already there) so nothing is sent to the agent until you press Enter.
//
// Configuration (all optional except the model):
//   PI_WHISPER_MODEL        path to a ggml model .bin (REQUIRED), e.g.
//                           ~/whisper.cpp/models/ggml-base.en.bin
//   PI_WHISPER_STREAM_BIN   `whisper-stream` binary (default: "whisper-stream")
//   PI_WHISPER_CLI_BIN      `whisper-cli` binary    (default: "whisper-cli")
//   PI_WHISPER_RECORDER     recorder for record mode (default: "rec" from sox;
//                           set to "ffmpeg" to use avfoundation on macOS)
//   PI_WHISPER_FFMPEG_INPUT ffmpeg avfoundation input spec (default: ":0")
//   PI_WHISPER_STREAM_ARGS  extra args for whisper-stream (space separated)
//   PI_WHISPER_CLI_ARGS     extra args for whisper-cli (space separated)

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATUS_KEY = "whisper-dictation";
// Matches CSI escape sequences so whisper-stream's cursor control / line
// clearing does not pollute the captured transcript.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

type Mode = "stream" | "record";

interface Session {
  mode: Mode;
  child: ChildProcess;
  ctx: ExtensionContext;
  committed: string[];
  lineBuf: string;
  tmpDir?: string;
  wavPath?: string;
  stopping: boolean;
}

interface Config {
  model: string;
  streamBin: string;
  cliBin: string;
  recorder: string;
  ffmpegInput: string;
  streamArgs: string[];
  cliArgs: string[];
}

function splitArgs(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts : undefined;
}

function resolveConfig(): Config {
  return {
    model: process.env.PI_WHISPER_MODEL ?? "",
    streamBin: process.env.PI_WHISPER_STREAM_BIN ?? "whisper-stream",
    cliBin: process.env.PI_WHISPER_CLI_BIN ?? "whisper-cli",
    recorder: process.env.PI_WHISPER_RECORDER ?? "rec",
    ffmpegInput: process.env.PI_WHISPER_FFMPEG_INPUT ?? ":0",
    streamArgs:
      splitArgs(process.env.PI_WHISPER_STREAM_ARGS) ??
      ["--step", "500", "--length", "5000", "--keep", "200"],
    cliArgs: splitArgs(process.env.PI_WHISPER_CLI_ARGS) ?? [],
  };
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function (pi: ExtensionAPI) {
  // Only one capture can run at a time across both modes.
  let session: Session | null = null;

  function clearUI(ctx: ExtensionContext) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setWidget(STATUS_KEY, undefined);
  }

  function checkModel(ctx: ExtensionContext, cfg: Config): boolean {
    if (!cfg.model) {
      ctx.ui.notify(
        "Set PI_WHISPER_MODEL to your ggml model path (e.g. ggml-base.en.bin)",
        "error",
      );
      return false;
    }
    return true;
  }

  function transcriptSoFar(s: Session): string {
    return [...s.committed, s.lineBuf].join(" ").replace(/\s+/g, " ").trim();
  }

  function updateWidget(s: Session) {
    const preview = transcriptSoFar(s);
    const tail = preview.length > 200 ? "…" + preview.slice(-200) : preview;
    s.ctx.ui.setWidget(STATUS_KEY, [
      `🎙  audio mode (${s.mode}) — press the same key to stop`,
      tail || "(listening…)",
    ]);
  }

  // Apply whisper-stream stdout: \r overwrites the current line, \n commits it.
  function feedStream(s: Session, chunk: string) {
    const text = chunk.replace(ANSI, "");
    for (const ch of text) {
      if (ch === "\n") {
        const line = s.lineBuf.trim();
        if (line && !/^\[.*\]$/.test(line) && !line.startsWith("###")) {
          s.committed.push(line);
        }
        s.lineBuf = "";
      } else if (ch === "\r") {
        s.lineBuf = "";
      } else {
        s.lineBuf += ch;
      }
    }
    updateWidget(s);
  }

  function insertTranscript(ctx: ExtensionContext, text: string) {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) {
      ctx.ui.notify("No speech transcribed", "warning");
      return;
    }
    const existing = ctx.ui.getEditorText?.() ?? "";
    const next = existing.trim()
      ? `${existing.replace(/\s*$/, "")} ${t}`
      : t;
    ctx.ui.setEditorText(next);
    ctx.ui.notify("Transcript inserted", "info");
  }

  // Run a short-lived command, resolving its stdout (rejects on non-zero exit).
  function runCapture(bin: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args);
      let out = "";
      let err = "";
      child.stdout?.on("data", (d) => (out += String(d)));
      child.stderr?.on("data", (d) => (err += String(d)));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve(out)
          : reject(new Error(err.trim() || `exited with code ${code}`)),
      );
    });
  }

  // SIGINT lets sox/ffmpeg finalize the WAV header; SIGKILL is the backstop.
  function stopRecorder(s: Session): Promise<void> {
    return new Promise((resolve) => {
      if (s.child.exitCode !== null || s.child.killed) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      s.child.once("close", finish);
      try {
        s.child.kill("SIGINT");
      } catch {
        return finish();
      }
      setTimeout(() => {
        try {
          s.child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        finish();
      }, 4000);
    });
  }

  function transcribeFile(cfg: Config, wavPath: string): Promise<string> {
    const args = ["-m", cfg.model, "-f", wavPath, "-nt", "-np", ...cfg.cliArgs];
    return runCapture(cfg.cliBin, args).then((out) =>
      out
        .replace(ANSI, "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" "),
    );
  }

  function startStream(ctx: ExtensionContext, cfg: Config) {
    let child: ChildProcess;
    try {
      child = spawn(cfg.streamBin, ["-m", cfg.model, ...cfg.streamArgs]);
    } catch (e) {
      ctx.ui.notify(`Failed to start ${cfg.streamBin}: ${errMessage(e)}`, "error");
      return;
    }
    const s: Session = {
      mode: "stream",
      child,
      ctx,
      committed: [],
      lineBuf: "",
      stopping: false,
    };
    session = s;
    child.stdout?.on("data", (d) => feedStream(s, String(d)));
    child.on("error", (e) => {
      if (session === s) {
        session = null;
        clearUI(ctx);
      }
      ctx.ui.notify(`${cfg.streamBin} failed: ${errMessage(e)}`, "error");
    });
    child.on("close", () => {
      if (session === s && !s.stopping) {
        session = null;
        clearUI(ctx);
        ctx.ui.notify("Streaming dictation stopped unexpectedly", "warning");
      }
    });
    ctx.ui.setStatus(STATUS_KEY, "🎙 streaming");
    updateWidget(s);
  }

  function startRecord(ctx: ExtensionContext, cfg: Config) {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-whisper-"));
    const wavPath = join(tmpDir, "dictation.wav");
    let bin: string;
    let args: string[];
    if (cfg.recorder === "ffmpeg") {
      bin = "ffmpeg";
      args = [
        "-hide_banner", "-loglevel", "error",
        "-f", "avfoundation", "-i", cfg.ffmpegInput,
        "-ar", "16000", "-ac", "1", "-y", wavPath,
      ];
    } else {
      bin = cfg.recorder; // sox `rec`
      args = ["-q", "-r", "16000", "-c", "1", "-b", "16", wavPath];
    }
    let child: ChildProcess;
    try {
      child = spawn(bin, args);
    } catch (e) {
      rmSync(tmpDir, { recursive: true, force: true });
      ctx.ui.notify(`Failed to start ${bin}: ${errMessage(e)}`, "error");
      return;
    }
    const s: Session = {
      mode: "record",
      child,
      ctx,
      committed: [],
      lineBuf: "",
      tmpDir,
      wavPath,
      stopping: false,
    };
    session = s;
    child.on("error", (e) => {
      if (session === s) {
        session = null;
        clearUI(ctx);
        rmSync(tmpDir, { recursive: true, force: true });
      }
      ctx.ui.notify(`${bin} failed: ${errMessage(e)}`, "error");
    });
    ctx.ui.setStatus(STATUS_KEY, "🎙 recording");
    ctx.ui.setWidget(STATUS_KEY, [
      "🎙  recording — press alt+a to stop & transcribe",
    ]);
  }

  async function stop(ctx: ExtensionContext) {
    const s = session;
    if (!s) return;
    s.stopping = true;

    if (s.mode === "stream") {
      session = null;
      try {
        s.child.kill("SIGINT");
      } catch {
        /* ignore */
      }
      clearUI(ctx);
      insertTranscript(ctx, transcriptSoFar(s));
      return;
    }

    // record mode: stop recorder, finalize WAV, then transcribe once.
    const cfg = resolveConfig();
    ctx.ui.setStatus(STATUS_KEY, "⏳ transcribing…");
    ctx.ui.setWidget(STATUS_KEY, ["⏳ transcribing…"]);
    try {
      await stopRecorder(s);
      const text = await transcribeFile(cfg, s.wavPath!);
      insertTranscript(ctx, text);
    } catch (e) {
      ctx.ui.notify(`Transcription failed: ${errMessage(e)}`, "error");
    } finally {
      session = null;
      if (s.tmpDir) rmSync(s.tmpDir, { recursive: true, force: true });
      clearUI(ctx);
    }
  }

  async function toggle(ctx: ExtensionContext, mode: Mode) {
    if (!ctx.hasUI) return;
    if (session && session.mode === mode) {
      await stop(ctx);
      return;
    }
    if (session) {
      ctx.ui.notify(
        `Audio mode (${session.mode}) is already active — stop it first`,
        "warning",
      );
      return;
    }
    const cfg = resolveConfig();
    if (!checkModel(ctx, cfg)) return;
    if (mode === "stream") startStream(ctx, cfg);
    else startRecord(ctx, cfg);
  }

  pi.registerShortcut("ctrl+space", {
    description: "Toggle streaming dictation (whisper-stream)",
    handler: (ctx) => toggle(ctx, "stream"),
  });

  pi.registerShortcut("alt+a", {
    description: "Toggle record + transcribe dictation (whisper-cli)",
    handler: (ctx) => toggle(ctx, "record"),
  });

  pi.registerCommand("dictate", {
    description:
      "Toggle audio dictation (record mode; pass --streaming for whisper-stream)",
    getArgumentCompletions: (prefix) => {
      const item = { value: "--streaming", label: "--streaming" };
      return "--streaming".startsWith(prefix) ? [item] : null;
    },
    handler: async (args, ctx) => {
      const streaming = /(^|\s)--streaming(\s|$)/.test(args ?? "");
      await toggle(ctx, streaming ? "stream" : "record");
    },
  });

  pi.on("session_shutdown", () => {
    if (!session) return;
    try {
      session.child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    if (session.tmpDir) rmSync(session.tmpDir, { recursive: true, force: true });
    session = null;
  });
}
