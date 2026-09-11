# Project Summary

Working notes for this tool. For setup and usage, see [README.md](README.md) —
this file tracks **state and direction**, not instructions.

## Where it stands

| Area | Status |
|---|---|
| Engine syntax | `node --check veo3_flow_new_ui.js` passes. |
| Scene 1 (project grid) | Works. Refs attach, prompt types, clip generates, editor opens. |
| Extends (scenes 2+) | Works, but see the clip-selection caveat below. |
| Extend model | Configurable via `--extend-model`; tolerant of Flow renaming tiers. |
| Completion detection | 75 s minimum wait + timeline-seconds growth + placeholder-slot drop. Reliable on normal generations. |
| Per-scene reference attachment | Implemented (`openAssetPicker` / `findAssetItem` / `selectRefsForScene`). **Not yet validated against live Flow.** |
| Newest-clip selection | **Heuristic and unreliable** — the main open problem. |
| Export + split | Flow exports a ZIP; the engine extracts the largest `.mp4` and splits it with ffmpeg. |
| GUI | Minimal launcher only — no aspect ratio, duration, outputs, style or model controls yet. |

## The main open problem: selecting the newest clip

Clips **are** DOM elements — this was originally misdiagnosed. The only
`<canvas>` in the scene editor is `.video-canvas`, the video *preview*. The
timeline is ordinary Angular DOM:

```
div.timeline-contents                      (cdk-drop-list)
  ├─ div.clip.is-first.is-last.selected    ← one node per clip
  │    └─ div.clip-body                    ← drag surface, click target
  ├─ div.add-clip-button-container
  │    └─ button[aria-label="Add clip"]
  └─ flow-extend-menu
```

The newest clip is the **last** `.clip` in that list, so the engine selects it
by clicking the last `.clip-body` and then verifies `.selected` is present.

Relevant selectors confirmed by probe:

| Thing | Selector |
|---|---|
| All clips | `.timeline-contents .clip` |
| Newest clip | last of the above (`is-last` when it is the tail) |
| Click target | `.clip-body` |
| Horizontal scroller | `.timeline-area` (scrollWidth 2061 vs clientWidth 1912) |
| Total duration | `.duration-timecode-value` → `MM:SS:FF` (8s reads `00:08:00`) |
| Playhead position | `.timecode-value` |
| Add clip | `button[aria-label="Add clip"]` |

One 8-second clip measured 816px wide against a ruler marked 00–19, i.e. about
**102px per second** — enough to sanity-check a duration against a clip's width.

`probe_editor.js` is the diagnostic written to fix this properly. Run it with
the scene editor open:

```bat
node probe_editor.js --cdp 9222
```

It dumps the timeline DOM, every horizontally scrollable container, the
duration readouts and the ancestor chain above `.extend-placeholder-text` to
`logs/editor_probe_<timestamp>.json`. The goal is to find a stable DOM anchor —
or a reliable coordinate derivation — to replace the blind click.

## Not yet answered

- **Can an existing reference sheet be registered as a Flow Character?**
  Flow's help centre documents **Agent Mode** and **Agent Instructions**, and
  documents an `@` mention system for `@me` (your own avatar). A "Characters"
  feature that you create from a reference and reference as `@name` appears in
  walkthroughs but has no help-centre topic. If it works, `@name` mentions would
  likely hold character consistency better than per-scene ingredient attachment.
- **Does Flow retain ingredients in the prompt box between extends?** If it
  does, scene *n* can inherit scene *n-1*'s references and exceed the limit.

## Directions under consideration

Both of these are **additive**. The ingredients workflow is the path that works
on a plan exposing all models, so it stays intact regardless of what is added.

- **Agent Mode as a second mode.** Flow's Agent can plan, generate and pick its
  own model, and its confirmation setting can be set to *never ask*, which
  removes the approval loop that would otherwise make it unscriptable. It would
  suit a project-wide Agent Instruction holding style and character rules
  instead of prefixing every scene prompt. Candidate shape: a
  `--mode ingredients|agent` switch rather than a rewrite.
- **Fill the GUI out** to match the old tool: aspect ratio, duration, output
  count, style presets, per-run model selection.

## Rejected

- Removing the ingredients path in favour of Agent Mode. Ingredients mode is
  what runs on a plan with every model available, so it is kept.

## Engine issues found but not yet fixed

1. **Dead retry.** `processScene` catches its own exceptions, so
   `processSceneWithRetry`'s `maxFullRetries` never actually triggers. Recovery
   is manual (`--from`) until this is restructured.
2. **Split offsets assume contiguity.** `(n - 1) * SCENE_SECONDS` is wrong when
   earlier clips are missing from the timeline.
3. **`slotsAfterArm`** is threaded into `waitForExtendComplete` but never read.
