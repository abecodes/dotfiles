# whisper-dictation

Toggle "audio mode" with a shortcut, speak, and have a whisper.cpp transcription
dropped into the pi editor for review before you send it. Nothing is submitted
to the agent automatically — the transcript is inserted into the input box (and
appended to whatever you've already typed), so you press Enter when ready.

## Quick start

Build whisper.cpp with `-DWHISPER_SDL2=ON` (needs `brew install sdl2`) so
`whisper-stream` exists, and `brew install sox` for record mode. Then `/reload`
in pi.

## Shortcuts and commands

| Trigger              | Mode      | What it does |
|----------------------|-----------|--------------|
| `ctrl+space`         | streaming | Runs `whisper-stream` (mic capture built in, **no file written**). Lower latency, noisier output. Press again to stop and insert. |
| `alt+a`              | record    | Records to a temp WAV, then runs `whisper-cli` once on stop. More accurate, easy to parse, but needs a recorder + writes a short-lived temp file. Press `alt+a` again to stop & transcribe. |
| `/dictate`           | record    | Same as `alt+a`. Run again (or press `alt+a`) to stop. |
| `/dictate --streaming` | streaming | Same as `ctrl+space`. Run again (or press `ctrl+space`) to stop. |

Only one mode can run at a time. While active a status indicator and a widget
(showing the live transcript in streaming mode) appear above the editor.

## Dependencies

### whisper.cpp

Build whisper.cpp and grab a model:

```bash
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
# Streaming mode needs the SDL2-backed binary:
cmake -B build -DWHISPER_SDL2=ON     # brew install sdl2 first on macOS
cmake --build build -j --config Release
# Download a model (base.en is a good starting point):
./models/download-ggml-model.sh base.en
```

This produces `build/bin/whisper-stream` and `build/bin/whisper-cli`.

### Recorder (only for `alt+a` record mode)

Either:

- **sox** (default): `brew install sox` — gives you the `rec` command.
- **ffmpeg**: `brew install ffmpeg` — set `PI_WHISPER_RECORDER=ffmpeg`.

Streaming mode (`ctrl+space`) does **not** need a separate recorder.

## Configuration (environment variables)

| Variable                  | Required | Default            | Purpose |
|---------------------------|----------|--------------------|---------|
| `PI_WHISPER_MODEL`        | **yes**  | —                  | Path to a ggml model `.bin`. |
| `PI_WHISPER_STREAM_BIN`   | no       | `whisper-stream`   | Streaming binary (use an absolute path if not on `PATH`). |
| `PI_WHISPER_CLI_BIN`      | no       | `whisper-cli`      | One-shot transcription binary. |
| `PI_WHISPER_RECORDER`     | no       | `rec`              | Recorder for record mode; set to `ffmpeg` to use avfoundation. |
| `PI_WHISPER_FFMPEG_INPUT` | no       | `:0`               | ffmpeg avfoundation input spec (`ffmpeg -f avfoundation -list_devices true -i ""` to list). |
| `PI_WHISPER_STREAM_ARGS`  | no       | `--step 500 --length 5000 --keep 200` | Extra `whisper-stream` args (space separated). |
| `PI_WHISPER_CLI_ARGS`     | no       | —                  | Extra `whisper-cli` args. |

Example (e.g. in your shell profile):

```bash
export PI_WHISPER_MODEL="$HOME/whisper.cpp/models/ggml-base.en.bin"
export PI_WHISPER_STREAM_BIN="$HOME/whisper.cpp/build/bin/whisper-stream"
export PI_WHISPER_CLI_BIN="$HOME/whisper.cpp/build/bin/whisper-cli"
```

## Notes & limitations

- **Streaming stdout is messy.** `whisper-stream` reprints partial results with
  cursor control sequences; this extension strips them and accumulates committed
  lines, but the streaming transcript can still contain duplicated or partial
  words. If accuracy matters, prefer `alt+a` record mode. Tune
  `PI_WHISPER_STREAM_ARGS` (`--step`, `--length`, `--vad`) to taste.
- **macOS mic permission.** The first run will prompt for microphone access for
  your terminal app. If recording is silent, check System Settings → Privacy &
  Security → Microphone.
- The transcript is only ever inserted into the editor — review and edit it,
  then press Enter to send.

## Enabling

The extension auto-loads from `~/.pi/agent/extensions/whisper-dictation/`.
Run `/reload` in pi (or restart) to pick it up.
