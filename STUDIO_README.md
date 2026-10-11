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
- **Settings:** saved Sarah/George images and descriptions, mode switches and Gemini API keys. Existing keys are not returned to the interface.

Writing and Flow have independent job lanes. Writing uses the existing separate AI Studio profile, so it can continue while Flow works. Only one Flow operation runs at a time in Studio. Do not run another Flow job in the classic GUI simultaneously. A rejected or incomplete job is shown as failed, never completed successfully.

Stop ends the driver's process tree and retains its existing disk checkpoints. After restarting Studio, use the same inputs/project to continue. Writer continue uses the current on-screen input, rather than loading an old source link. Close the desktop window only after jobs finish, or stop them first; closing Studio stops its own running drivers.

This interface reuses the existing automation engines. It does not replace their manifest ordering, file verification, reference selection or batch resume logic. No paid live generation is part of interface testing.

The activity console appends output without replacing selected text. **Pause log** pauses its display, and **Copy logs** copies the full saved job log.

**Download Upscaled** selects 720p for 360p source clips and 1080p for 720p source clips. Saved files are decoded and checked against the requested resolution. Existing verified files at that resolution are skipped; replaced lower-resolution copies are retained locally.

Advanced classic-only tools remain accessible through the classic launcher, including detailed API diagnostics, preset editing and multi-story Ingredients queue controls. Studio is an additional interface, not a removal of the original one.
