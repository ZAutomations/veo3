# Ready-script import: Zack D production profiles

## What changed

The former label matcher rejected punctuation in a nested name such as
`Medical/Technical Cutaway`. The parser now distinguishes metadata, nested
Characters/Locations entries and clip fields. `Continuity:` is separate story
metadata, not another environment. Wrapped descriptions, curly quotes and timing
dashes are accepted. Unsupported clip fields and invalid timings report the
story, clip, field and source line.

The importer remains local: no Gemini calls, narration rewriting or video
generation. It validates and prepares every input story before writing packages.
The existing story JSON schema and downstream generation/checkpoints remain in
use. New metadata is additive. Re-imports reuse matching completed packages and
preserve their story files, prompts, downloads and checkpoints.

## Strict versus legacy

New master prompt: `Master prompts/3d-zack-style.txt` (V5).

Add `Production profile: zetomate-8x8` to request:

- Positive, unique `Story N` headings, title and valid preset.
- Exactly eight clips, each eight seconds, consecutive clip numbers.
- Exact supplied narration, exactly three sequential shots covering 0–8 seconds.
- Effect and Sound fields; any supplied timing must fit inside the clip.
- Narration word warnings: preferred 16–20, maximum target 22. Longer narration
  is preserved and warned about, never truncated. Speech duration is an estimate.

Studio's **Import ready script** card has a strict 8×8 checkbox for Zack D,
selected by default. Disable it for old variable-count/two-shot scripts. An
explicit production profile in a script still requests strict validation.
CLI/API imports default to legacy-compatible unless explicitly set to strict.
Other presets retain their existing requirements.

## Preview and export

Click **Validate / Preview import** to inspect all stories locally. The preview
shows metadata, narration/word counts, shots, effects, audio and exported scene
prompts. Model/resolution and attached-asset instructions are added by the
selected generation driver later. This preview spends no credits.

Each imported package includes:

- `IMPORT_PREFLIGHT.txt` and `.json`: detailed preview.
- `READY_SCRIPT_EXPORT.txt`: canonical re-importable TXT.
- `READY_SCRIPT_SOURCE.json`: source fields and line provenance for inspection.
- `READY_SCRIPT_ORIGINAL.txt`: unmodified supplied input text/batch.

JSON is a diagnostic export; TXT is the re-import format. Folder import reads
sorted top-level TXT files, validating the whole batch before package writes.

```powershell
node import_ready_script.js --input scripts.txt --strict-8x8 --preflight-only
node import_ready_script.js --input scripts-folder --strict-8x8 --out stories
```

The old JSON request-file entry point also works. Supported request keys include
`text`, `file`, `files`, `folder`, `preset`, `aspect`, `strict8x8`, `preflightOnly`
and `reportOut`. Explicit script fields override corresponding defaults.

## Retry and production limits

Invalid scripts return exit 2 with `IMPORT_VALIDATION_FAILED` and stop automatic
import retries. Local runtime failures use at most three import retries, waiting
8, 16 and 32 seconds. Stop interrupts this wait. Other generation/download retry
policies are unchanged by this importer upgrade.

Continuity and matching environment descriptions are carried into each scene.
Concrete supplied shots, timings, narration and explicit cuts remain authoritative.
The full location catalog is preserved in story JSON and reports. No generic
camera guideline substitutes a new event for a supplied shot.

This is structural validation, not scientific fact checking. Veo voice identity,
audio duration, music continuity, framing and image fidelity remain model-driven
constraints; the importer cannot guarantee them. No live generation was needed
to verify this change.

Regression coverage includes representative Story 51/141 fixtures, Unicode and
wrapped values, invalid fields/timings, exact narration, TXT round trips, preview,
batch validation, repeat-import preservation and retry classification. The actual
failed Story 141 input also passed strict local preflight. The original Story 51
TXT was unavailable, so its format is covered by a representative fixture and
existing legacy import tests.
