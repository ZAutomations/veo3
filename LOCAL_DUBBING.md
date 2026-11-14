# Existing-video multilingual dubbing

This is an optional local-only workflow. It never generates English narration or submits Veo videos, and it never calls a translator. Existing English videos are preserved.

## Prepare translated scripts

Give ChatGPT the original story/script and the updated preset master prompt. Ask for English plus selected languages, keeping the exact English title, preset ID, English lines, scene count and scene durations. New narration must retain all important facts and qualifications. Do not rename the original story during localization.

Place the resulting multilingual ready-import `.txt` files or imported story `.json` files in one folder. Combined batch TXT files are supported. Do not use a folder of translation-only prose without the corresponding English scene identities.

## Run

1. Restart Studio.
2. Audio Settings → Multilingual Audio First: select English + selected languages, choose each provider/voice and save.
3. Audio Settings → **Dub existing local videos — no Veo**: browse the translated scripts folder.
4. Click **Scan scripts / existing videos**. Review the source video, clean-background status and scene timings. Scanning does not generate narration.
5. Click **Dub folder — selected languages only**. The job queue supports Stop and Retry / Continue.
6. Output `<title> Urdu.mp4`, `<title> Japanese.mp4`, etc. is saved in the original story folder, with matching thumbnails when an existing thumbnail is available.

Source selection is deterministic: title + preset + exact English scene text must identify exactly one completed project. Source order is never guessed from filenames or gallery order. Existing verified scene boundaries are required. Original projects must remain available to match new translated scripts.

The tool reuses clean Audio First backgrounds when available. Otherwise it ports Video Automation Studio's Demucs `no_vocals` stem workflow. Separation runs locally once per source content and is cached for all languages/retries. Stereo is retained. Failures do not fall back to the original English speech or silently mute the whole soundtrack. AI separation is approximate: it may affect SFX or leave artifacts, so listen to a sample. Existing burned-in English text/captions remain visible; audio dubbing cannot remove them. Prefer a verified raw joined source when available.

## Separation runtime

The helper auto-detects an installed Demucs Python, including the existing Python 3.11 used by the other tool. You may specify its executable in the optional field. If no working runtime exists, run `Setup/INSTALL_SEPARATION.bat` (requires Python 3.11); it creates a separate CPU environment. The model downloads on first use if not cached. Clean Audio First sources do not need Demucs.

MDX/ONNX is another separation architecture, but is not installed or benchmarked here. This version reuses working Demucs rather than installing another stack. It uses a single cached pass with no shift augmentation.

## Explicit sources / edited timings

If automatic matching is ambiguous, the only video is elsewhere, or silence trimming changed scene timings, add `local_dubbing_jobs.json` to the selected scripts folder:

```json
{"jobs":[{"title":"Exact English title","video":"D:/Videos/English.mp4","original_story":"D:/Stories/original_story.json","timeline":[{"scene":1,"start":0,"end":10},{"scene":2,"start":10,"end":20}]}]}
```

Use actual verified timings, not estimates. Every scene needs one row, consecutive from zero. Tail video after the last row is retained without added narration. Optional `order_report` points to a verified JOINED_CLIP_ORDER.txt. Optional `background_video` explicitly identifies an existing clean video with the same scene timeline; do not label a speech-containing video as clean.

## Dialogue presets

The updated importer supports `Dialogue English: [{"speaker":"Wolf","line":"..."}]` and matching language-labelled JSON turn arrays. Speaker identities/order are preserved. Supply an explicit voice mapping in the local dubbing card, for example:

```json
{"ur":{"Wolf":"Alnilam","Bear":"Orus"},"ja":{"Wolf":"Alnilam","Bear":"Orus"}}
```

The per-language selected provider is used with these voice names/IDs. Distinct characters require distinct selected voices. The engine preserves 0.30-second inter-speaker gaps. Audio dubbing does not create character lip sync. Silent presets do not acquire invented narration; intro-only/mixed-speech packages require explicit per-scene metadata.

## Urdu and Japanese calibration

Google Cloud Alnilam actual sample durations: Urdu 28/29 words were 9.84/10.04s; Japanese 53/59 characters were 9.40/12.20s. Final measured samples fit approximately 9.64–9.80s using bounded pitch-preserving fitting. Initial authoring guidance: Urdu 27–29 whitespace-separated words; Japanese 48–54 non-whitespace characters including punctuation, using natural kanji/kana. These are estimates, not timing guarantees or proof of pronunciation quality. Existing runtime measurement/recovery remains active. French/German calibration has not been claimed.
