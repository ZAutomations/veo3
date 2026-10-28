# Video Editing

The **Video Editing** tab ports the existing VideoAuotmation engines into VEO3.
It does not launch or import the original application's installation. The copied
source modules, fonts, sound samples and source-control schema live inside
`video_editing_port/`; `PORT_PROVENANCE.json` records their origins and adapters.

## Set up once

1. Open Video Editing and enable the desired cards.
2. Choose the captions style, colour, position and size. The expandable Pro
   Captions section includes all 19 presets, the five original word-animation
   modes, font family, exact size, outline/colour overrides, background, opacity,
   word grouping, language and timing/position offsets.
3. Choose silence threshold, minimum duration and speech padding. Optional
   crossfade + click is the original overlapping-segment effect.
4. Enable the desired camera transitions and swoosh/SFX settings.
5. Enable **Apply enabled editing features after every Join**, then Save.

New generation/join jobs capture the saved editing settings. These follow Agent,
Ingredients, Single Clip Omni and story queue jobs into the existing Join driver.
Existing running jobs keep their captured settings. For an already combined
video, Browse video or load a saved story's combined video, then choose **Apply
editing to this video**. Standalone editing has its own job and Stop button.

## Processing and output

The existing verified join runs first. Its original MP4 and
`JOINED_CLIP_ORDER.txt` remain intact. The editing pipeline then:

1. Removes qualifying silent gaps with the source FFmpeg detector and cut/concat
   engine. The video and audio use the same keep intervals.
2. Maps verified clip boundaries through the removed time; applies the ported
   camera effects and SFX there. Optional silence-cut transitions use the retained
   segment boundaries as well. Camera transitions preserve duration; optional
   silence crossfades shorten it by the actual overlaps, as in the source tool.
3. Transcribes the resulting audio locally using the ported Whisper word-timing
   helper and burns Pro Captions using the original ASS engine and libass.

`clips_final.mp4` therefore produces `clips_final_edited.mp4`. Editing never
overwrites the original. The `video_editing/` subfolder stores the settings,
keep intervals, mapped boundaries, cached words, ASS and completed-output receipt.
Matching completed edits are skipped when Skip already-processed is enabled.

Transitions require a matching verified join report. A standalone video without
that report cannot identify its original clip boundaries; the UI explains this
and the engine logs that boundary transitions were skipped. Captions and silence
removal can still process it. The threshold detector measures audio level, so
continuous music can keep a pause above the selected threshold.

## Live caption preview

The caption card follows the supplied Frameloom layout: style tiles, colour chips,
position/size buttons and a live preview. Detailed original controls remain
expandable. Preview frames and the playable five-second preview use FFmpeg/libass
and the same settings adapter as export, rather than approximate browser text.

Use sample text for quick styling. Select a combined video and enable **Use actual
spoken words** to load local word timings. Scrub and change settings to update the
rendered caption frame; Play shows the selected word animation with audio. The
caption preview covers caption styling. Silence removal and camera effects are
applied by the full editing render.

## Dependencies

The normal setup includes `Setup/requirements-editing.txt`. An existing Python
environment can install it with:

```powershell
python -m pip install -r Setup/requirements-editing.txt
```

FFmpeg/ffprobe must be available as they are for Join. Whisper uses local models;
the first use of an uncached model may download it. Caption transcription uses no
Gemini API or Flow generation credits.


Frameloom caption renderer (2026-10-27): the five style cards now use the
actual installed source's ASS event engine, not approximations via legacy
presets. Bold Pop / Karaoke Fill / One Word Punch / Highlighter Box / Smooth
Rise retain source phrase grouping, font choice, animation curves, margins and
resolution scaling. Both preview and final export call this engine. Select a
card once and save settings to use it for future jobs; previously saved legacy
presets remain available. Source-defined grouping/outline/animation controls
are disabled for these cards; size, accent, position, font, case and sync/vertical
offsets remain adjustable. Legacy presets still allow their original controls.
Fonts are bundled locally. The source app was read, not modified.


Final Video Speed: 0.15x to 2.00x, default 1x, with a 0.05-step slider and exact
numeric entry. This is applied after captions are burned and all other effects
finish. Video and audio tempo change together; chained atempo preserves voice
pitch. Original files remain unchanged. Caption frame preview uses the original
timeline; playable preview includes speed. Speed alone can be applied with all
other features off. Saved settings apply to both manual and automatic editing.
