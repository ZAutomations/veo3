# Video Reverse Engineering

Restart Studio after installing this change. Open **Video Reverse Engineering** in the main window.

1. Attach one to three local videos (MP4, MOV, M4V, WEBM, MKV or AVI; up to 400 MB each).
2. Name the new preset. Choose output clip count, aspect ratio, speech mode and sampling rate. Default output is eight eight-second clips, or 64 seconds. The reference duration never silently becomes the output duration.
3. Add notes about what should be retained or changed. Click **Analyze videos**. The files are uploaded to Google Gemini using the saved API keys. This consumes Gemini API quota, but does not generate Flow videos.
4. After completion, click **Refresh results** and select the analysis. Review the reports, references, master prompt and preset JSON. Inferred details and unknowns need human review.
5. Expand **Review and save preset**, edit if needed, and click **Save preset + master prompt**. Existing preset IDs cannot be overwritten; change the `reference-...` ID for a revision.
6. The preset appears in the preset dropdowns and **Prompts** tab. Give its master prompt to ChatGPT, then use **Story Writer → Import ready script** to build story JSON and individual/Agent clip prompts locally. Normal API/browser story writing also has the custom preset hooks.

## Analysis stages

- Local `ffprobe` metadata: actual duration, size, frame rate, codecs and audio streams.
- Per-video Gemini pass: timestamped shots, subject/action/expression/blocking, identity/wardrobe/props, framing/camera/focus, lighting/palette/materials, graphics, edits, sound/voice/music, story beats, hook/payoff/CTA, retention and continuity.
- Independent media audit: re-watch for missed cuts, fast events, audio changes, incorrect assumptions and continuity problems.
- Synthesis: compare shared, variable, contradictory and source-specific traits; build a production bible, image-reference prompts and tool-compatible preset.
- Quality review: inspect the package against all reports and audits, retain uncertainties, and remove unsupported precision.

Normally this means **2 × number of videos + 2 API calls**, excluding retries. Sampling defaults to 4 fps; 8 fps provides more temporal detail but consumes more input tokens. Sampled analysis does not guarantee detection of every frame or sound. Lens, lighting temperature, BPM and hidden production software must not be presented as measured facts.

## Saved data and recovery

Reports are saved under `stories/_reverse_engineering/<content-and-settings-hash>/`. They include measured metadata, per-video analysis/audit JSON, synthesis, quality review, `REPORT.json`, `REFERENCE_PROMPTS.txt`, `preset.json` and `MASTER_PROMPT.txt`.

**Stop analysis** stops the writing-lane process. **Retry / Continue** resumes saved stages. Changing source contents or settings creates a separate analysis; identical completed stages avoid repeat API calls. Provider refusals and exhausted bounded attempts require review rather than endless retries. Uploaded Google files are deleted on normal completion/failure where cleanup is possible; a forced process stop can leave temporary provider uploads until expiration.

Saving registers the preset in `genai_styles.json` and its master prompt in `Master prompts/<preset-id>.txt`. Registry backups are stored under `backups/reverse_presets/`. No existing preset is replaced.

Generated presets support silent/nonverbal, offscreen narration and character dialogue. Their ready scripts use `Story N`, `Title:`, `Preset:`, `Clip seconds: 8`, `Setting:`, named `Characters:`/`Locations:`, then `Clip N:`, `Start state:`, timed `Shot N:`, `End state:` and `Audio:`. Narrated mode adds `Narration:`; dialogue mode uses exact named speaker labels. All audio is native generated audio. Up to two recurring character references and one primary location design reference fit the tool's three-image limit. Other locations are described where needed, without forcing the whole story into the reference room.

## Verification

Local tests cover stage caching, media cleanup, input validation, coverage gates, all three speech modes, ready-script parsing and packaging, preset registration/collision protection, artifact access and the headless tab. These tests mock Gemini and do not spend API or Flow credits. They do not establish live provider quality or guarantee Google UI/model compatibility.
