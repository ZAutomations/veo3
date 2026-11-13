# Multilingual Audio First: local test

This feature is optional and has not been committed or pushed.

1. Restart Studio. Open Settings -> Multilingual Audio First.
2. Enable additional language versions. For the first test select one language (Russian, Arabic or Hindi), choose HeyGen, and enter a voice ID known to support that language. Save settings. Keep the provider key in the existing Voiceover settings.
3. To reuse an existing project: browse its completed English **Audio First story JSON**, then click **Render selected languages from completed English**. Do not select a native narrated story or its English final MP4. The original raw video and verified JOINED_CLIP_ORDER report must be present beside the prepared JSON.
4. For a new project: prepare the original story through Audio First, initially scenes 1-2. Translated scripts are prepared using the saved story-writing transport before Flow starts. Generate and finish English normally. The selected language versions run automatically after English editing succeeds. Audio First batch uses the same saved language selections.
5. Review the language-suffixed MP4 files next to the English output. Review the scripts and NARRATION_REVIEW.json under multilingual/<package>/<language>/ before a larger batch.

Original visuals, narration-free ambience/SFX and thumbnail end-card timeline are reused. Existing English visual text and thumbnail text remain English. Localized versions omit the preset CTA until a matching language CTA is implemented. Narration-gap trimming is off for localized versions so scene boundaries stay fixed. Existing selected transitions and final playback-speed settings still apply.

Long narration gets at most two concise translation revisions after the first synthesis. A small pitch-preserving timing adjustment is limited to 1.30x; audio is never cropped. Unresolved timing stops the language job. Cached scripts, audio and matching renders are reused when retrying.

The real-provider test must still confirm translation meaning, voice pronunciation and caption/font rendering (particularly Arabic and Hindi). Offline tests use synthetic audio and validate provider isolation, order, scene timing, audible background preservation and retry caching; they do not establish linguistic quality or voice-provider language support.

## Supplied-language import (no translation call)

Use Languages: English, Russian, Arabic, Hindi in the header and Narration English:, Narration Russian:, Narration Arabic:, Narration Hindi: in every clip. English remains the visual/base script; translated narration is saved in each scene's narration_translations map. The importer exports per-language review TXT files and retains the format during round-trip export.

Select the desired additional languages/voices in Settings and run Audio First normally. For supplied_only stories, missing or overlong supplied language text requires correction; Gemini is never used to translate or shorten it automatically. See samples/multilingual/ocean_nuclear_30s for the imported thirty-second sample and reusable ChatGPT format.

## Actual-audio gate before Flow

Audio First now prepares and measures English and every selected additional-language voiceover before releasing new video generation. Selecting an already prepared multilingual package in Agent Mode also runs the timing gate before any new video batch submission. Existing clips are not regenerated. Matching provider/text audio is reused across language-cache versions.

For supplied-only scripts, a line that needs more than the 1.30x adjustment limit stops with TIMING_REPAIR.json. The repair report names the language/scene, measured duration, target and a rough shorter-character budget. A writing-time claim such as “9.5 seconds” is not a measured recording.

To repair a completed project's language narration without changing its Flow-bound story, use multilingual_narration_overrides.json next to the prepared story: story_sha256 must match the prepared JSON's SHA-256; narrations maps a language code to numbered scene strings. These explicit voice-only corrections retain original English visuals and checkpoints. The sample ocean project's Russian scenes 2 and 3 have been corrected this way. A changed voice/language/text still requires real audio validation.

## Japanese and English-only default

Settings -> Language output offers English only (default) or English + selected languages. English-only mode does not call translation or additional-language speech providers and works with Native or English Audio First. Japanese is available as an optional language with its own provider/voice selection and Japanese caption language. Import Japanese using Languages: English, Japanese and Narration English:/Narration Japanese: in every scene. Japanese uses the same actual-audio timing preflight.


Google service-account narration recovery:
- Google TTS uses Alnilam or the selected Google voice through Cloud Text-to-Speech.
- If an unchanged supplied line exceeds the 1.30x post-fit limit, request at most two faster native deliveries of exactly the same text and language. Original recordings and successful alternate recordings are retained. Retries reuse those alternates.
- A moderately short localized recording can be slowed by at most 15%, pitch preserved, toward 9.65 seconds in a 10-second scene. Speech is not cropped and silence is not added to fake spoken duration.
- English Google narration uses native-delivery recovery, then fits each complete scene independently to about 9.48 seconds for a 10-second clip. Its per-scene post-processing range is 0.85x–1.30x, pitch preserved. A longest-scene common speed is not applied to shorter Google English lines. Other providers and Native settings are unaffected.
- After two unsuccessful deliveries, timing still requires review. This is a bounded recovery, not a guarantee that arbitrary text fits any duration.
- Voice-only override bindings may refresh across generated timing-metadata changes only when the original source and numbered English narration are identical. Changed narration is never silently rebound.


Arabic caption rendering:
- Arabic-script text uses Noto Sans Arabic with zero character tracking.
- Arabic ASS styles use libass Encoding=-1 whole-line bidi/shaping; Unicode text remains in logical reading order and is not reversed or reshaped manually.
- FFmpeg burns with complex shaping. Word highlights remain attached to their logical spoken word.
- Caption render signature is versioned so previously broken edits are not silently reused. The native narration is not changed by this caption fix.
