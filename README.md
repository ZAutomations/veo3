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

The **Agent Mode** tab is the other path — four stages run in order rather than
one button, plus a **Style preset** dropdown that rewrites the story's look. See
[Agent Mode](#agent-mode--the-second-path).

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

## Agent Mode — the second path

Everything above describes the **ingredients/extend** path. Agent Mode is a
separate surface and a separate set of scripts. It is not a replacement: the
ingredients path stays because it is the one that works once the extend models
are available on your plan.

|  | Ingredients (extend) | Agent Mode |
|---|---|---|
| Where it runs | the **scene editor** (`/project/<id>/edit/<scene>`) | the **project home** (`/project/<id>`) |
| Who plans the shots | you, scene by scene in the JSON | the agent, from one prompt |
| Output | one continuous timeline | **discrete clips**, one per scene |
| Post-processing | ffmpeg **split** | ffmpeg **concat** |
| Model choice | the extend menu | plain English in the prompt |

That last row is the reason Agent Mode exists at all: the lower-priority model
that the extend menu does not offer *is* reachable here, by asking for it in
words.

### The four stages

```bat
node story_to_agent_prompt.js stories\my_story\my_story.json   :: 1. story JSON -> agent_prompt.txt
node agent_mode.js --file stories\my_story\agent_prompt.txt ^  :: 2. type, attach @mentions, submit
                   --model "veo3.1 low priority" --auto-approve
node agent_download.js --out stories\my_story\clips            :: 3. pull the clips out of Flow
node join_clips.js stories\my_story\clips                      :: 4. ffmpeg concat
```

All four are buttons in the GUI's **Agent Mode** tab, in that order.

**Stage 1 — `story_to_agent_prompt.js`.** Derives the prompt from the story
JSON rather than having you write it. This is not a convenience: a hand-written
prompt for *The Gift of Honesty* dropped the narrator voice-over and the
"characters are silent" rule and invented dialogue the story forbids, and the
agent produced exactly that. The JSON already holds the narration
(`scenes[].script_line`), the style and the VO rule, so the prompt is generated
from it. It warns if any scene has no narration line, because the agent will
invent those scenes.

It also writes the **clip format** — aspect ratio and seconds per clip — because
Agent Mode has no settings panel to set them in. The format is asked for in
words, so if the prompt doesn't say it, you get whatever Flow defaults to. The
first two stories came out 16:9 by luck, not by request. Override per run with
`--aspect` / `--seconds`, or per story with `aspect_ratio` / `scene_seconds` in
the JSON; the CLI wins. The GUI's **Clip format** row shows whichever the story
carries, so the controls and the prompt cannot disagree.

**Stage 2 — `agent_mode.js`.** Types the prompt, then attaches each `@mention`
**last**. Typing `@Mia` mid-sentence sends the rest of the sentence into the
asset picker as a search filter, which matches nothing and truncates the
prompt — hence the split. `--no-submit` is on by default in the GUI so the
first run of a new story can be eyeballed.

**Stage 3 — `agent_download.js`.** Probe-first. Run `--probe` before trusting
it: the per-tile DOM is only half mapped. What *is* known is that each tile
carries `Favorite`, `Reuse prompt` and `More options`, the last being a
`mat-mdc-menu-trigger` — so the menu is the download route — and the script
tries a direct `<video src>` fetch first, because that needs no menu and cannot
mis-attribute a file.

**Stage 4 — `join_clips.js`.** Concatenates with `-c copy`, which is instant,
and falls back to a re-encode only when it must. It **checks the clips' stream
signatures first**: fed clips of differing resolutions, the concat demuxer exits
`0` and writes a file whose format changes mid-playback, with no error. That is
silent corruption, so it is detected and the join is forced to re-encode.

### Order is the thing that goes wrong

Flow's project grid is usually **newest first**, so DOM order is often the
reverse of scene order, and a wrong join order produces a perfectly valid video
with the scenes shuffled. Nothing guesses:

- the downloader numbers files by on-screen order and writes `manifest.json`
  recording exactly which tile became which file;
- `join_clips.js` reads that manifest, or sorts naturally (`scene-2` before
  `scene-10`), and `--dry-run` prints the plan before anything is encoded.

**Stage 3 in the GUI passes `--reverse` by default**, because numbering clips in
on-screen order names scene 7 as `scene-01.mp4`. The checkbox is *Number clips
oldest-first (Flow's grid is newest-first — leave ON)*. Turn it off only for a
project whose grid is genuinely oldest-first, which has not been observed yet.

Untick it, or download from the CLI without `--reverse`, and you get the
reversal: every clip is present, every clip plays, and the story runs backwards.

**Always check `--dry-run` output before the join.** If scene 1 is last, either
re-download with `--reverse` or pass `--order` to `join_clips.js`.

Because `scene-01.mp4` is only a *name*, the downloader also writes
**`_contact_sheet.jpg`** into the clips folder — every clip's frame with its
number burned in, so the order can be confirmed by eye against the story. The
tile captions Flow shows on hover ("Mia watches Daniel walk away") are the other
check, but they only render after the tile has been pointed at, so treat them as
a bonus, not a guarantee.

Rebuild the sheet at any time without touching the browser or spending credits:

```
node agent_download.js --sheet-only stories\my_story\clips
```

It reads `manifest.json`, so the numbers match what `join_clips.js` will use.
This is the "?" **Check order** button on the Agent tab.

### Where the clips land

Point the **Clips folder** at a story folder and the GUI quietly redirects to
`<story>/clips`. A story folder is recognisable because it holds the story JSON,
and pointing at it directly scatters `scene-*.mp4`, `manifest.json` and
`_contact_sheet.jpg` through the story directory, mixed in with the JSON and
`character_refs/`. That happened on 2026-09-12 and made "which folder do I join?"
a real question. Leave the field empty and stage 3 defaults to `<story>/clips`
anyway.

### Steps that are deliberately manual

Creating the project, uploading each character reference sheet as a **Character**
named exactly as the `@mention` (`Mia`, `Daniel`), and setting **Agent
instructions** are not automated. They are one-time per project, and a wrong
value there poisons every later stage silently — the failure shows up much later
as inconsistent characters or a photorealistic look instead of the intended
style. The GUI lists them at the top of the Agent tab.

### Bringing an old (pre-Agent) story forward

Older story files written for the ingredients/extend path already carry
`script_line` and `narrative_context`, which is most of what the builder needs.
What they lack is the three fields that produce the `@mention` list:

| Field | Where | Why |
|---|---|---|
| `character_descriptions` | top level | the identity text the agent is told to hold |
| `character_references` | top level | `{ "sarah": "./character_refs/sarah_reference_sheet.jpg" }`, relative to the story JSON |
| `scenes[].characters` | per scene | only the characters **on screen** in that scene |

Miss them and the builder still runs — it just emits `Create 7 separate clips,
one clip per scene, using , up to 8 seconds each.` The empty gap where the names
belong is the whole symptom: no mentions, so no reference sheets attach, and the
agent invents the cast. Check the `characters :` line in the builder's summary
before spending anything.

Two further fields are optional, and are the ones nothing else will catch for
you: `aspect_ratio` and `scene_seconds`. Leave them out and the builder falls
back to 16:9 and 8 s — correct for YouTube, but silently so, and a story that
wants vertical never gets it.

Two traps when converting:

- **List only who is present.** Crediting an absent character invites the model to
  insert them. A scene where someone has walked out should name only the one left.
- **Style references to a real studio.** `story_to_agent_prompt.js` sends
  `style`, the story `description` and every scene's `narrative_context` to the
  agent, so renaming just the `style` line leaves the studio name in the prompt
  many more times. Clean all three. `styles.json` is the same rule already
  applied to 23 looks — see [Style presets](#style-presets).

`convert_bridge_story.py` is a worked example of the whole conversion.

### Style presets

`styles.json` holds 23 looks — 12 content niches (`ww2-history`, `mafia`,
`true-crime`, …) and 11 art styles (`ghibli`, `chibi`, `manhwa`, …). Each entry
carries four text fields, and only the first two reach a prompt:

| Field | Goes to |
|---|---|
| `style` | the story's `style` field → the builder's `STYLE:` line |
| `whisk` | image and character-sheet prompts |
| `palette`, `camera` | notes for you; no tool reads them |
| `label`, `id` | the menu — never sent anywhere |

**A label may name a studio; `style` and `whisk` must not.** Naming a real
studio is a distinctive protected house style, and Google's models frequently
refuse or quietly sanitise such a prompt. So `ghibli` is the *id* you type and
"Ghibli-Style Animation" is the *label* you read, while the `style` text beside
them says "classic hand-painted 2D animation, traditional Japanese animated-film
look" and never uses the word. The same rule the conversion section above
describes, applied to the data this time instead of to one story.

```
npm run styles                        # list every preset
node styles.js --show ghibli          # the full entry
node styles.js --prompt ghibli        # just the STYLE line, to copy
node styles.js --apply <story.json> ghibli [--dry-run]
```

`--apply` rewrites the story's `style` field and nothing else. It preserves the
line endings and the missing trailing newline these files use, so the change
lands in git as one line rather than a 119-line reformat.

It also **warns when the cast text disagrees**. `style` is not the only place a
story's look is written — every scene repeats `character_descriptions`, so a
story whose descriptions say "manhwa webtoon" keeps pulling that way even after
the `STYLE:` line says chibi. `--apply` compares the two and prints what the cast
mentions that the new preset does not:

```
WARNING: character_descriptions still describe a different look.
  found in the cast text, absent from the new preset: manhwa, webtoon
```

It only ever warns. Rewriting a cast's identity text automatically would be
worse than the mismatch, so fix those by hand. Silence is not proof the two
agree — the check is a word list, not a reading.

In the GUI's Agent tab, **Style preset** picks from the same list and **Apply to
story** runs the same command after confirming the file it is about to edit.
Loading a story into the tab preselects its preset when its `style` text matches
one exactly; hand-written style text matches nothing and simply leaves the
dropdown alone.

### Agent Mode flags

`story_to_agent_prompt.js`

| Flag | Meaning |
|---|---|
| `--out PATH` | Where to write the prompt. Default `<story_dir>/agent_prompt.txt`. |
| `--print` | Print the prompt, write no file. |
| `--aspect R` | `16:9`, `9:16`, `1:1`. Overrides the story JSON. Default `16:9`. |
| `--seconds N` | Seconds per clip. Overrides the story JSON. Default `8`. |

An unrecognised `--aspect` is passed into the prompt as written and warned about,
rather than quietly replaced with 16:9 — Flow adds ratios from time to time and
this list cannot know about them. `--seconds` above 8 also warns: 8 s is the
documented ceiling for Veo 3.1 - Lite [Lower Priority], and asking it for longer
makes the agent refuse or re-plan the storyboard instead of failing loudly. The
GUI's spinbox stops at 8 for the same reason; go past it via the CLI or the JSON
when a model that takes longer clips is on the plan.

`agent_mode.js`

| Flag | Meaning |
|---|---|
| `--file PATH` | Prompt from a file. Use this for full stories — Windows mangles long multi-line `--prompt`. |
| `--prompt "..."` | Short prompt inline. Any `@Name` in it is split out and typed last. |
| `--mention "A,B"` | Characters to attach. Overrides any `@` in the prompt. |
| `--model "..."` | Plain English, e.g. `veo3.1 low priority`. |
| `--check` | Report state only; click nothing. |
| `--settings` | Open and dump the Agent settings menu. |
| `--no-submit` | Type the prompt, do not submit. |
| `--auto-approve` | Click approval buttons automatically. **Spends credits.** |
| `--watch N` | Seconds to keep recording after submit. |

`agent_download.js` — `--probe`, `--out DIR`, `--method auto\|src\|menu`,
`--reverse`, `--limit N`, `--no-sheet`, `--sheet-only DIR`.

`join_clips.js` — `--out FILE`, `--order a,b,c`, `--reverse`, `--dry-run`,
`--reencode`, `--copy`.

### Model limits (stated by the agent, 2026-09-11)

- **Veo 3.1 - Lite [Lower Priority] caps at 8 seconds per clip.** Asking for one
  15-second video makes the agent refuse or re-plan.
- **At most 3 reference images** (R2V). A multi-angle character *sheet* can count
  as more than one.
- **One scene per clip.** Total length is the sum of the clips — it is not
  something you request.

---

## Project layout

```
veo3_flow_new_ui.js        ingredients engine - scene-by-scene extend + split
agent_mode.js              agent engine - prompt -> storyboard -> discrete clips
story_to_agent_prompt.js   story JSON -> agent_prompt.txt (stage 1)
agent_download.js          pull generated clips out of Flow (stage 3)
join_clips.js              ffmpeg concat -> one final mp4 (stage 4)
agent_watch.js             read-only watcher; records what the agent says
styles.js                  style presets - list, inspect, apply to a story
styles.json                the 23 presets themselves (data, not code)
veo3_gui.py                tkinter launcher - both paths, in tabs
probe_editor.js            diagnostic - dumps the editor timeline DOM
probe_agent.js             diagnostic - dumps the Agent Mode surface
probe_instructions.js      diagnostic - dumps the Agent instructions panel
probe_mention.js           diagnostic - dumps the @mention asset picker
START_GUI.bat              launch the GUI
START_CHROME_CDP.bat       launch the automation browser with CDP (see caveat above)
stories/                   your stories + reference sheets + output
logs/                      engine run logs and per-run DOM snapshots
```

Every probe and every run writes its DOM snapshots to `logs/`, so a failed run
can be diagnosed after the fact instead of reproduced. `agent_mode.js` in
particular snapshots at each numbered stage, which makes the first run of a new
Flow surface double as the probe for the rest of the flow.

### `probe_editor.js`

When the timeline misbehaves, run this with the scene editor open:

```bat
node probe_editor.js --cdp 9222
```

It writes `logs/editor_probe_<timestamp>.json` containing the timeline DOM —
the scroll containers, the duration readouts and the DOM ancestors of
`.extend-placeholder-text`. It contains DOM structure only — no account data —
so it's safe to share when asking for help.

---

## Known issues

Ordered by how likely they are to bite.

1. **Selecting the newest clip was heuristic — now DOM-based.** Timeline clips
   are real DOM (`div.clip` inside `.timeline-contents`), so the engine selects
   the newest one by clicking the last `.clip-body` and then **verifies** it
   carries `.selected`. If the selection cannot be confirmed it logs a warning;
   if the clip count does not advance by exactly one it aborts the run rather
   than build on a bad assumption. This replaced an earlier coordinate-based
   click that could select a middle clip and scramble the sequence.
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
