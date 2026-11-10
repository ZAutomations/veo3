# Optional preset CTA video

Put one playable video in `Preset References/<preset-id>/<preset-id>CTA.mp4`.
For Cats Behavior: `Preset References/cats-behavior-3d/cats-behavior-3dCTA.mp4`.
For Zack Animation: `Preset References/3d-zack-style/3d-zack-styleCTA.mp4`.
Use the actual folder ID, not the displayed preset label. MP4 is recommended; MOV, MKV and WebM are also recognized. Keep only one matching file. A different filename is ignored.

Video Editing > Preset CTA > Append preset CTA video when present is ON by default. Save settings for automatic jobs. Missing CTA files leave normal rendering unchanged. Auto-apply must be enabled for automatic finishing. This applies to all presets that record preset_id, including Audio First packages; no new story is required.

Final edited order: story -> local CTA -> existing thumbnail end card. Raw joined video, story scene manifests and verified scene order remain unchanged. CTA is inserted after normal effects, captions, voice replacement and final speed adjustment, preserving its own audio and speed. It fits the output ratio without stretching, with padding when necessary. Use a matching ratio for edge-to-edge artwork. CTA without audio gets a silent audio bed. No thumbnail available: CTA ends the edited video.

The tool does not upload the CTA as a reference image or generate the CTA for you. Reference image loading continues to accept image files only. The permanent CTA video may contain its own call to action; the cats master prompt separately supports one topic-specific viewer question inside the final story narration budget.

Each render checks the local file. The editing receipt fingerprints its path, size and modification time; changing or removing it invalidates that cached render. Re-render from the raw video. Reusing a known finished CTA export as editing input is stopped to avoid duplicate endings. No effects/CTA present means the existing normal no-op behavior is retained.

Validation uses synthetic color segments and audio tones to check story/CTA/thumbnail order, ratio fitting, CTA sound, original speed, missing/disabled behavior and repeat safety. Review your actual CTA for appearance and audio balance before batch production.
