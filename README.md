# Veo3 Flow Automation (new "Scenes" UI)

Automates multi-scene video generation on [Google Flow](https://flow.google.com)
using Puppeteer over the Chrome DevTools Protocol.

You supply a story JSON and a folder of character reference sheets; the engine
drives the Flow UI to generate scene 1, then **extends** it scene by scene into
a single continuous timeline, exports the timeline, and splits the export back
into one `scene-XX.mp4` per scene with ffmpeg.

> **Status: working but actively stabilising.** See [Known issues](#known-issues)
> before relying on an unattended run.

---

## How it works

Flow's new Scenes UI keeps every clip of a project inside **one** scene on a
`<canvas>` timeline. There is no per-clip DOM, so the engine anchors on the
things that are real DOM: the "Add clip" button, the model menu, the
`.extend-placeholder-text` slot, and the duration readouts.

```
Scene 1   project grid  -> attach refs -> type prompt -> Start generation
                         -> wait for clip -> editor opens
Scene 2+  editor        -> "Add clip" -> "Extend (<model>)" -> attach the refs
                           for the characters in THIS scene -> type prompt
                         -> "Start generation" -> wait for the timeline to grow
                         -> select the newest clip so the next one appends after it
Final     editor        -> "Download scene" -> unzip -> ffmpeg -ss/-t split
                         -> stories/<name>/output/scene-01.mp4 ...
```

**Completion detection** is the hard part — the timeline shows a reserved slot
the instant you hit generate, so a naive "did it grow?" check fires immediately.
The engine requires a **75 s minimum wait**, then a timeline-seconds reading at
or past the target, then a drop in the empty-placeholder count. There is no
usable "stop" button in the DOM to wait on.

**Pause and resume:** press `P` to pause, `R` to resume, `Ctrl+C` to exit. Every
run can be resumed from any scene with `--from`/`--to`, which is the intended
recovery path when a run dies mid-way.

---

## Requirements

| | |
|---|---|
| **Node.js** | 18+ (uses `puppeteer` ^24) |
| **Python** | 3.8+ with tkinter (only for the GUI launcher) |
| **Google Chrome** | installed at the default Windows path |
| **ffmpeg** | on your `PATH` (only needed for the final split) |
| **Google Flow account** | with access to the Scenes UI |

---

## Setup

```bat
git clone https://github.com/ZAutomations/veo3.git
cd veo3
npm install
```

Then **log into Flow once by hand**, because the automation browser is a
separate Chrome profile and does not inherit your everyday session:

```bat
START_CHROME_CDP.bat
```

That launches the dedicated profile at `%LOCALAPPDATA%\flow-mcp-profile`. Sign
into Google Flow in that window, close it, and the login persists for every
later run.

> The engine will seed that profile from your real `Profile 3` on first use, so
> you may already be signed in. Either way, verify before a long run.
>
> Keep `START_CHROME_CDP.bat`'s `--user-data-dir` in sync with
> `buildDedicatedProfile()` in `veo3_flow_new_ui.js`. A mismatch means the
> script opens a **different** browser than the engine attaches to.

---

## Usage

### GUI

```bat
START_GUI.bat
```

Pick a story JSON, set the scene range, tick **Skip refs** if the references are
already attached, and hit **Run**. The GUI shells out to the CLI below and
streams the log.

### CLI

```bat
node veo3_flow_new_ui.js <story.json> [options]
```

| Flag | Meaning |
|---|---|
| `--project-url URL` | Flow project to work in. Also readable from the story JSON's `project_url`. |
| `--from N` | First scene to process. Omit it and the engine asks interactively (fresh start vs. resume). |
| `--to N` | Last scene to process. Defaults to the last scene in the JSON. |
| `--skip-refs` | Don't attach reference sheets — use when they're already on the timeline. |
| `--extend-model NAME` | Model for **extends**, matched as a substring against the entries Flow offers. Default: `Veo 3.1 - Lite [Lower Priority]`. |
| `--cdp PORT` | CDP port. Default `9222`. |

Example — resume scenes 3 to 5 of an existing run without re-attaching refs:

```bat
node veo3_flow_new_ui.js stories\my_story\my_story.json --from 3 --to 5 --skip-refs
```

**On `--extend-model`:** the name is a *substring* match, and the engine logs
every model Flow actually offered when your preference isn't among them. If
Flow renames a tier, the run degrades to the first `Extend (Veo ...)` entry
rather than stalling — read the log to see which one it picked. Your plan
decides what's on that menu; the default reflects a plan where only the
lower-priority queue is exposed.

---

## Story JSON

See [`stories/example_story/example_story.json`](stories/example_story/example_story.json)
for a complete template. The engine reads:

| Field | Purpose |
|---|---|
| `title`, `description`, `niche`, `style` | Metadata. Logged, not sent to Flow. |
| `project_url` | Optional default for `--project-url`. |
| `character_references` | `{ "alex": "./character_refs/alex_reference_sheet.jpeg" }` — paths resolve **relative to the story JSON's folder**. |
| `scenes[]` | The scenes, in order. |
| `scenes[].scene_builder_action` | `text_to_video` (scene 1) or `extend` (scenes 2+). Logged; the engine derives the real behaviour from scene position. |
| `scenes[].characters` | Which `character_references` keys to attach for **this** scene. Omit or leave empty to attach all of them. |
| `scenes[].veo3_prompt` | The prompt typed into the box. |
| `_`-prefixed fields | Yours — notes, titles, timings. Ignored. |

Layout:

```
stories/
  my_story/
    my_story.json
    character_refs/
      alex_reference_sheet.jpeg
      sam_reference_sheet.jpeg
    output/            # generated: scene-01.mp4 ...
    logs/              # generated: <name>_FAILED.txt, <name>_FINAL.txt
```

`output/` and `logs/` are created for you and are gitignored.

---

## The final split

Flow's **Download scene** exports a **ZIP** (the video plus the ingredient
images), not a bare `.mp4`. The engine extracts the largest `.mp4` from it and
splits on `SCENE_SECONDS` (default `8`) boundaries:

```
ffmpeg -ss <n*8> -t 8 -i timeline.mp4 -c copy scene-0n.mp4
```

Two consequences worth knowing:

- If your scenes aren't all the same length, the split will drift. Change
  `SCENE_SECONDS` in `CONFIG` to match.
- The split assumes scenes are contiguous from 1. Processing a *middle* slice
  with `--from` on a timeline that is missing earlier clips will produce
  offsets shifted by the missing time.

---

## Project layout

```
veo3_flow_new_ui.js   engine - all automation logic
veo3_gui.py           tkinter launcher
probe_editor.js       diagnostic - dumps the editor timeline DOM
START_GUI.bat         launch the GUI
START_CHROME_CDP.bat  launch the automation browser with CDP (see caveat above)
stories/              your stories + reference sheets + output
logs/                 engine run logs
```

### `probe_editor.js`

When the timeline misbehaves, run this with the scene editor open:

```bat
node probe_editor.js --cdp 9222
```

It writes `logs/editor_probe_<timestamp>.json` containing the timeline canvas,
the scroll containers, the duration readouts and the DOM ancestors of
`.extend-placeholder-text`. It contains DOM structure only — no account data —
so it's safe to share when asking for help.

---

## Known issues

Ordered by how likely they are to bite.

1. **Selecting the newest clip is heuristic.** The timeline is a `<canvas>` with
   no per-clip DOM, so the engine scrolls to the end and clicks by coordinate.
   When it misses, the next extend appends after the wrong clip and the
   sequence comes out out of order. `probe_editor.js` exists to replace this
   with a real anchor — that work is not finished.
2. **Per-scene reference attachment is unverified against live Flow.** Scenes 2+
   open the asset picker, match `asset-title` against the character name, select,
   and confirm with **Add to prompt**. Flow ignores selections that skip that
   confirmation. Treat the first run of a new story as a test.
3. **Reference carry-over.** If Flow retains ingredients in the prompt box
   between extends, a scene can end up with the previous scene's references plus
   its own, possibly exceeding the ingredient limit. Watch the first few extends
   of a new story.
4. **Full-scene retry is currently dead code.** `processScene` catches its own
   exceptions, so `processSceneWithRetry`'s retry never fires. Recovery today is
   manual: re-run with `--from`.
5. **Timing constants are tuned, not derived.** The 75 s minimum wait and the
   8-minute ceiling in `CONFIG` are empirical. A slow generation can still be
   declared complete early, or time out.

---

## Legal / fair use

This is a UI automation tool for a Google product. It drives your own
authenticated browser session and spends your own Flow credits. It is not
affiliated with or endorsed by Google. Automating a web UI can break whenever
that UI changes, and may be contrary to the service's terms — check them, and
use it on your own account at your own risk.
