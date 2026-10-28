# VEO3 Studio

Run **START_STUDIO.bat** for the new desktop interface. Its first launch installs the small desktop requirements if they are missing. Windows needs Microsoft Edge WebView2; current Windows installations generally include it. If the renderer is unavailable, install Microsoft's WebView2 Runtime and launch again.

The classic interface stays available through **START_GUI.bat** or **Open classic interface** in the sidebar.

The top bar offers **Crimson**, **Ember** and **Matte** colour themes matching OMNITUBE's palettes. Crimson is the default. Your theme selection is saved locally and restored on the next launch.

## Workflows

- **Story Writer:** titles and details, multiple ideas, video links, presets, clip count, source duration matching, AI Studio browser or Gemini API, stop and continue, and saved-analysis finalization.
- **Agent Mode:** existing story generation, reference preparation, model/ratio/resolution prompt instructions, numbered manual batches or selected scenes, failed-tile recovery, downloads, order resolution and joining.
- **Ingredients:** reference preparation, scene ranges and the existing Extend driver.
- **Single Clip Omni:** the existing five-at-a-time standalone driver, background Upscaled downloads, saved checkpoint recovery and whole-story download backlog.
- **Story Library:** finalized stories, numbered full prompts, copy, Excel export through generation tabs and story-folder access.
- **Accounts:** existing account profiles, browser switching, add, pause/resume, counter reset and removal.
- **Settings:** saved Sarah/SAM images and descriptions, mode switches and Gemini API keys. Existing keys are not returned to the interface.

Writing and Flow have independent job lanes. Writing uses the existing separate AI Studio profile, so it can continue while Flow works. Only one Flow operation runs at a time in Studio. Do not run another Flow job in the classic GUI simultaneously. A rejected or incomplete job is shown as failed, never completed successfully.

Stop ends the driver's process tree and retains its existing disk checkpoints. After restarting Studio, use the same inputs/project to continue. Writer continue uses the current on-screen input, rather than loading an old source link. Close the desktop window only after jobs finish, or stop them first; closing Studio stops its own running drivers.

**Retry / Continue** in Writer, Agent, Ingredients and Single Clip Omni uses the last interrupted job's original inputs and saved operation, even after restarting Studio. Completed earlier pipeline operations are skipped. Within a driver, its saved clip/download checkpoints determine remaining work. For Ingredients, Retry verifies the existing timeline and resumes after its completed clips. Stop a still-running job before retrying. Manual regeneration and deletion are never repeated by this button; use their dedicated controls. If you changed the source or settings intentionally, start a new normal request instead of Retry.

This interface reuses the existing automation engines. It does not replace their manifest ordering, file verification, reference selection or batch resume logic. No paid live generation is part of interface testing.

The activity console appends output without replacing selected text. **Pause log** pauses its display, and **Copy logs** copies the full saved job log.

**Download Upscaled** selects 720p for 360p source clips and 1080p for 720p source clips. Saved files are decoded and checked against the requested resolution. Existing verified files at that resolution are skipped; replaced lower-resolution copies are retained locally.

Advanced classic-only tools remain accessible through the classic launcher, including detailed API diagnostics, preset editing and multi-story Ingredients queue controls. Studio is an additional interface, not a removal of the original one.

## Generate multiple saved stories

Agent Mode, Ingredients and Single Clip Omni each have a **Generate multiple saved stories** panel. Tick stories in the library list and click **Generate story batch**. The queue uses each complete story as written, the selected video settings, and the Download/Join options. Each story gets a separate new Flow project and its own story output folder. Reference preparation is selected with **Prepare reference images for each story**. Stories run in the displayed order, one at a time; Single Clip Omni retains its five-clip groups and background Upscaled downloads inside each story. A failure stops the queue before later stories start. **Retry / Continue batch** resumes the failed story's saved project/driver checkpoint and then the remaining queue, skipping earlier completed stories. The single-story project URL and scene range do not apply to the fresh batch queue.

## Colorful Cartoon – Relationship Narration

This preset creates hand-drawn 2D relationship stories with colourful adult characters and meaningful props against light-grey/off-white backgrounds. Characters act silently while Veo generates one consistent off-screen narrator voice-over in every clip, reading the written line exactly. No character speech or lip-sync, music, speech bubbles or embedded text. The package includes numbered complete visual-and-audio prompts. `NARRATION_SCRIPT.txt` and `narration_segments.json` are reference copies of the narrated lines; no separate audio recording is required.

## Import ready scripts without AI writing

In Studio, open Story Writer > Import ready script. Paste one or multiple stories, choose a Sarah/SAM dialogue preset and aspect ratio, then click Import script → story files. No Gemini request or video generation runs during import.

Required structure:

```text
Story 1
Title: Who Stole My Blanket?
Preset: relationship-dialogue-dog-couple
Clip seconds: 8
Setting: A cozy living room with two dog beds.

Clip 1:
Action: Sarah tilts her head toward SAM.
Sarah: "You stole my blanket again."
SAM: "I was keeping it warm for you."
```

Repeat Clip 2:, Clip 3: and so on. Repeat Story 2 for another story. Preset: is optional and otherwise uses the selected preset. Clip seconds: overrides the selector. Duration: 30 seconds. Exactly 5 clips of 6 seconds. is also supported and checked against the actual clip count. Action: is optional. Dialogue remains unchanged; long lines produce warnings. Setting and clip numbering are validated.

Supported presets: realistic, Ghibli, stylized 3D, colorful cartoon dialogue and dog-couple dialogue. Narration and arbitrary cast presets need their existing writer.

Imports appear in Story Library and contain standard story JSON, refs.json, character sheets, agent_prompt.txt, individual clip prompts and simple prompts. A deterministic _ready_ suffix keeps imports separate from previous stories; importing the same script and settings again preserves its package and downloads. Changed text or settings create a new package.

### Show or hide cards
Every Studio settings card and expandable section has a Show/Hide control in its corner. Collapsing retains input values, selections and ongoing jobs. States are remembered separately for each tab in desktop preferences and restored after navigation or restart. The Activity log retains its existing expand/collapse control.

## Zack D ready-script import

Story Writer > Import ready script also accepts `Preset: 3d-zack-style`. Use eight-second clips with Narration:, two to four timed Shot N: fields, Effect: and Sound:. Define Characters: (None or up to two named recurring people) and Locations: above Clip 1. Estimated duration is validated against the actual supplied clips. Shots must cover 0–8 seconds continuously; narration and shot text stay unchanged. The preset supplies style, palette, narrator and silent-cast rules. No additional CTA or invented event is appended. Named locations remain shot-specific rather than forcing every scene into one room. Compatible individual and Agent prompts, references, narration copy and hook guide are created locally. This is not a factual verification or an AI rewrite.

For stronger hooks, ask ChatGPT to open within 1–2 seconds with a factual misconception, surprising contrast, immediate consequence or specific question. Avoid routine setup. Keep the narration short enough for eight seconds and preserve all source facts and qualifications. The importer preserves the supplied hook; improve it before importing.

Zack D narrative modes: titles such as What would happen if / What if activate the hypothetical explainer contract. Viewer-facing conditional narration is permitted; factual historical retellings and Fern still keep their documentary viewpoint. Ready-script import preserves supplied wording; improve the hook and conditional framing before import.

## Separate Studio Story Writer window

Click Open separate Story Writer in the sidebar or Story Writer page. It opens the same maintained Studio writing UI in a dedicated window (including batch writing and direct script import), with no generation tabs. Flow jobs and writer jobs use separate lanes on the same backend. The writer window has its own saved form/collapse preferences in desktop_writer_settings.json; it inherits the main palette on first use. Closing this child window does not stop the main Flow job. Reopening focuses/restores the existing child window or creates it again after closing. Only one writing job can run at a time across Studio windows to avoid conflicting AI Studio sessions; writing can run concurrently with a Flow job.

Agent batch download fallback: When source prompt text is shared by multiple generated clips, a matching fully completed batch checkpoint and exact unique video inventory allow asset-by-asset Original/Upscaled collection. Files use asset identities, not guessed story numbers. The manifest records downloadComplete while keeping complete:false and needsSceneOrdering:true until Resolve clip order verifies narration. Automatic joining still runs narration ordering first and refuses an unresolved manifest. Verified existing asset transfers are skipped. Incomplete/changed checkpoints, missing assets and active/failed generation cannot authorize the fallback.
