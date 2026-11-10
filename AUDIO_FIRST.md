# Audio First: local test workflow

## Batch processing

In Agent Mode expand **Generate multiple saved stories**. Enable **Audio First batch** in **References & finishing**, select original narrated stories, enable Download/Join as wanted, and click **Generate story batch**. Native is the default option. The From/To boxes apply to single-story controls, not this full-story batch.

The provider and voice come from saved Video Editing settings. The queue first validates every selected story and prepares all narration packages. Only after these steps succeed does it start the normal sequence of separate Flow projects, reference generation, background-only clips, verified downloads/order, Join and optional editing. Enable **Apply enabled editing features after every Join** in Video Editing to mix narration automatically. Each prepared package identifies its own audio, so saved narration from one story is never applied to another. Retry / Continue batch skips completed operations; the remaining preparation uses cached audio, and generation reuses its saved project. A preparation/timing failure stops before the Flow phase. Already prepared Audio First JSONs can also use the existing Native batch option, which runs those packages as-is; do not prepare them again.

For local-audio batches, browse a **Local audio batch manifest** JSON. It maps every selected original story to its recording and optional per-scene timing JSON. Relative paths resolve against the manifest's folder; absolute paths are supported. Example when the manifest is in the tool root:

```json
{
  "stories/story_a/story_a_story.json": {
    "audio": "voiceovers/story_a.wav",
    "timing": "voiceovers/story_a_timing.json"
  },
  "stories/story_b/story_b_story.json": {
    "audio": "voiceovers/story_b.mp3",
    "timing": "voiceovers/story_b_timing.json"
  }
}
```

Each timing file is a JSON array containing one `audio_start`/`audio_end` range in seconds per story scene. Missing mappings, invalid ranges, dialogue stories and 10-second narration outside 28–30 words fail preflight. API batch mode does not need this manifest. All generation still depends on the selected provider/Flow availability and requires listening review for unexpected speech in background-only outputs.

Native stories and their default generation behavior are preserved. Audio First prepares a separate package under the original story folder's audio_first directory, with its own JSON, audio files, prompts and generation checkpoints. Nothing is pushed automatically.

1. Restart Studio. In Video Editing choose API Voiceover (provider and voice ID) or Local WAV/MP3. Save editing settings. API preparation sends narration text to the selected provider and can consume its credits; HeyGen currently uses the explicitly selected free Turbo model. For a local multi-scene recording, provide a JSON array containing one audio_start/audio_end pair per selected scene; automatic word alignment is not assumed.
2. Open Settings and scroll to Audio First — Single Story / Scene Test. Choose the original ready-import story and set From/To to 1–2 scenes, then click Prepare Audio First package. API audio is generated per scene before video; successful files are cached. Narration exceeding the selected supported clip length stops preparation before video generation. This version keeps the story's 4/6/8/10-second clip duration; it does not silently rewrite narration or choose a different duration.
3. The activity log prints AUDIO_FIRST_STORY with the new JSON path. Review AUDIO_FIRST_REVIEW.json beside it, including the narration, actual audio durations and scaled shot timings. Existing shot beats are scaled to the audio duration, with the last shot holding to the clip end. These are duration-based estimates, not measured sentence/word alignment; revise shots before generation when exact action synchronization matters.
4. Browse that new JSON in Agent Mode and use a NEW Flow project. Prepare references and thumbnail normally, then generate/download. Audio First exports dedicated background-only prompts; old native narrator/audio blocks are not forwarded. The voice ingredient is cleared. Only natural ambience/SFX are requested, without speech, vocals or music. Google may still produce unwanted speech; listen to the test clips and regenerate those before mixing if this happens.
5. Resolve order from verified scene asset identities and join normally. No Whisper narration ordering is possible for background-only clips; uncertain scene mapping must remain blocked.
6. Apply Video Editing to the new raw joined video (or leave automatic editing enabled after Join). The editor detects its Audio First package, aligns the prepared narration to verified scene boundaries, and mixes it over the original background at reduced volume with narration-triggered ducking. Short narration is padded; up to 1.20x pitch-preserving tempo accommodates small rendered-duration drift, while greater overflow stops rather than cutting speech. When enabled, silence is detected on the separate narration timeline and identical cuts are applied to video plus mixed audio, preserving their synchronization and the thumbnail end card. Captions and final speed apply to the mixed result.

The original narrated video must not be used as Audio First background: it would retain the original speaker underneath the new narration. This workflow generates fresh background-only clips. Existing narrated clips require separate speech separation, which this feature does not implement. API dialogue/lip-sync is also outside this initial narrated-story workflow. BGM is not generated in this test mode; natural ambience and SFX are retained.

Local regression tests cover package isolation, speech-free prompt export, actual FFmpeg narration/background mixing, local timing and overflow protection, provider caching, UI controls and the protected generation/order baselines. A real 1–2-scene Flow test and listening review are still required before using a full batch. ElevenLabs and AI33Pro need live credentials for end-to-end provider validation.

HeyGen timeout recovery: generation uses a saved request identity and a completed response is saved before its audio download. Downloads retry up to three times and write atomically. Retry / Continue batch reuses the saved URL instead of generating the same narration again. An uncertain request older than the safe retry window stops for provider-history review.

## Saved voice calibration and common story pace

In Video Editing choose a provider and Voice ID, then use **Calibrate selected voice (3 samples)**. This generates three 30-word samples and saves measured durations and a starting tempo per provider/model/voice/clip duration outside Git. A new API voice is calibrated automatically during Audio First preparation if its profile is missing. Provider credits may apply; repeated calibration reuses its saved profile and cached samples.

Preparation measures every full scene recording before choosing ONE final tempo for the complete story: the greater of the saved baseline and the pace needed by the longest actual scene. Every scene receives that same tempo. Ten-second clips finish narration by 9.5 seconds. A common rate above 1.50x stops for review rather than truncating or individually speeding a clip. The review JSON records the shared tempo. This is pitch-preserving local audio processing, not an undocumented provider speed parameter. Word count and sample calibration do not guarantee every future text has the same duration. Existing generated packages remain separate; new common-pace packages use a distinct preparation version.

Pacing correction (2026-11-10): calibration is advisory, never a minimum speed or a pre-generation rejection. The common story tempo comes from actual narration recordings. Audio First preserves scene durations by default even when general silence removal is enabled. Enable �Audio First: trim narration gaps (shortens video)� explicitly to cut gaps. Existing prepared packages retain their old fitted audio; prepare from the original story for corrected narration.
