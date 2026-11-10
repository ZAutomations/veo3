# Optional narration in Video Editing

The default **Veo3 Native** retains the generated clip audio. Select **API Voiceover** or **Local WAV / MP3** in the Video Editing voiceover panel to replace it. Changes are local pending user testing; no automatic Git push is required.

For API narration, select ElevenLabs, HeyGen, or AI33Pro (OpenSpeaker), save that provider's key, load its voices and choose a voice. Keys are stored under the Windows user's LocalAppData/Veo3Studio directory, outside the repository. Enter a voice ID directly if needed. Save editing settings, load the story's raw joined video, then Apply editing. API calls consume the selected provider's credits. HeyGen authentication worked but its last speech test returned insufficient API credits. ElevenLabs and AI33Pro need the user's credentials for live verification.

API mode requires one story JSON and its matching JOINED_CLIP_ORDER.txt next to the raw video. One narration audio is generated from each scene's exact script_line and starts at that scene's verified join boundary. Short lines are padded with silence. A long line can be sped up to 1.20x while preserving pitch; greater overflow stops the render without truncation. Successful audio files are cached; AI33 task IDs are retained for polling on retries. This is scene alignment, not automatic word-to-action alignment or lip synchronization. Narrator API mode rejects dialogue/silent stories.

For a local WAV or MP3 already timed to the video, browse it and leave timing JSON blank. Total duration must match the story region within 2%; matching duration does not prove the words match individual scenes. For scene-level control, browse a JSON list such as:

```json
[
  {"audio_start": 0, "audio_end": 7.5, "video_start": 0, "video_end": 8},
  {"audio_start": 7.5, "audio_end": 15, "video_start": 8, "video_end": 16}
]
```

All values are seconds. Choose ranges at actual phrase boundaries. The rows must be ordered and non-overlapping. The tool pads available space or applies the same bounded tempo adjustment. It does not infer scene boundaries from arbitrary uploaded narration. The thumbnail end-card region remains silent.

External modes replace the complete original audio mix, including bundled native music and effects. Silence removal is skipped to preserve the audio/visual timeline. Transitions retain timing; captions transcribe the replacement audio; final speed changes both together. For actual-word caption preview of external narration, render once and browse the resulting video in Native mode. Sample caption preview never generates paid speech. The raw joined video is preserved.

Provider documentation: https://elevenlabs.io/docs/api-reference/text-to-speech/convert ; https://www.heygen.com/blog/heygen-api-guide ; https://openspeaker.ai/developers . AI33Pro's public spec leaves some response details in authenticated documentation, so live verification with that account remains necessary.
