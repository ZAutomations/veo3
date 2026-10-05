# Recover a story after AI Studio automation stops

First confirm the old automation has stopped. Save the answer you want to recover.
Do not start two writers against the same AI Studio window.

## Before running any command

Open PowerShell and run:

```powershell
Set-Location 'D:\MyFinalAutomations\Veo3'
```

Save recovery answers in `AI-STUDIO-WORKFLOW\saved-answers` using Notepad and UTF-8.
Use a separate filename for each video. The examples below use `analysis.json`,
`complete-answer.txt`, `cast.json`, and `clips-1.json`.

All commands below assume PowerShell remains in the main Veo3 folder.
Replace example titles, preset IDs and durations with YOUR original settings.
If a destination story already exists, use a different title for recovery instead
of overwriting it. Do not add `--force` just to silence an existing-folder warning.

## A. You have VIDEO ANALYSIS JSON

Recognise it by `title_suggestion`, `preset_suggestion`, `facts`, and `clips`.
This is the kind of JSON returned for "How Game Shows Equalize Contestant Heights".
It is not yet a finished story.

1. Copy the JSON only, from its opening `{` to closing `}`. Remove surrounding
   Markdown fences or explanatory text.
2. Save it as:

   `D:\MyFinalAutomations\Veo3\AI-STUDIO-WORKFLOW\saved-answers\analysis.json`

3. Keep the dedicated AI Studio browser signed in.
4. Run:

```powershell
node write_story.js --content-map "AI-STUDIO-WORKFLOW\saved-answers\analysis.json" --preset 3d-zack-style --transport web
```

The tool reads the saved analysis, uses its suggested title, and asks AI Studio for
the cast/outline and scenes. It then validates and writes the story package. It does
not repeat video analysis. Further Gemini responses are still required.

To control the title and length explicitly, use this version instead:

```powershell
node write_story.js --content-map "AI-STUDIO-WORKFLOW\saved-answers\analysis.json" --preset 3d-zack-style --title "Game Show Heights Recovery" --duration 24 --transport web
```

Here 24 means three 8-second clips. Change it to your intended duration. Without
`--duration`, the content map sets an initial length; a preset's default duration
may subsequently override it.

### If browser writing also fails: finish by copy/paste

Prepare the first writer prompt locally:

```powershell
node write_story.js --content-map "AI-STUDIO-WORKFLOW\saved-answers\analysis.json" --preset 3d-zack-style --title "Game Show Heights Recovery" --duration 24 --print-prompts
```

This sends nothing to Gemini. Open the printed `prompts\1_cast_and_outline.txt`
and `prompts\HOWTO.txt` paths. Paste the first prompt into AI Studio yourself,
save its JSON response, then follow section C and the generated HOWTO.

## B. You have BOTH full story-writer answers

You need:

- One JSON object with `outline`, characters and location information.
- One JSON object with a `scenes` array containing EVERY intended scene.

1. Put both objects, one after the other, in `saved-answers\complete-answer.txt`.
   The importer accepts Markdown JSON fences and surrounding explanation.
2. Run:

```powershell
node GEMINI-BY-HAND\make_story_from_answer.js "AI-STUDIO-WORKFLOW\saved-answers\complete-answer.txt" --preset 3d-zack-style --title "My Recovered Story" --duration 24
```

Use the preset that generated those answers. Set duration to the full clip count
times 8, for example 13 clips = 104 seconds. This prevents a default length from
conflicting with your recovered answer.

With complete answers, this builds the package locally; no further Gemini request
is needed. Validation must still pass.

Do NOT use this route for analysis JSON with `facts` and `clips`.
Do NOT use the old `1 - STORY BANAO.bat` for a different preset: that BAT is fixed
to `relationship-dialogue-real`. The command above lets you choose the preset.

If scenes arrived as MULTIPLE separate JSON replies, use section C with repeated
`--from-file` arguments. The one-text importer selects only the first scenes object.

## C. You have only the cast/outline or some scene batches

Save each response as its own valid JSON file, without Markdown fences:

- `saved-answers\cast.json`: the object with `outline` and cast/location fields.
- `saved-answers\clips-1.json`: first response containing `scenes`.
- `saved-answers\clips-2.json`: next response containing `scenes`, and so on.

For a 13-clip story, keep `--duration 104` in EVERY command below. Keep title,
preset and any custom cast/content-map options consistent too.

### Only cast/outline saved

```powershell
node write_story.js --title "My Recovered Story" --preset 3d-zack-style --duration 104 --from-file "AI-STUDIO-WORKFLOW\saved-answers\cast.json" --print-prompts
```

Open the scene prompt file(s) whose paths the tool prints. Paste the next requested
prompt into AI Studio and save the complete response as `clips-1.json`.

### Cast and some scenes saved

```powershell
node write_story.js --title "My Recovered Story" --preset 3d-zack-style --duration 104 --from-file "AI-STUDIO-WORKFLOW\saved-answers\cast.json" --from-file "AI-STUDIO-WORKFLOW\saved-answers\clips-1.json" --print-prompts
```

The tool uses the saved responses and prepares the missing prompt(s). Follow its
printed instructions, saving each new scene batch separately. Repeat with another
`--from-file` for every batch you have already obtained, in their original order.
`--print-prompts` prepares prompts locally rather than sending missing requests.

### All batches saved: write the final package

Remove `--print-prompts` and provide every response. For example:

```powershell
node write_story.js --title "My Recovered Story" --preset 3d-zack-style --duration 104 --from-file "AI-STUDIO-WORKFLOW\saved-answers\cast.json" --from-file "AI-STUDIO-WORKFLOW\saved-answers\clips-1.json" --from-file "AI-STUDIO-WORKFLOW\saved-answers\clips-2.json" --from-file "AI-STUDIO-WORKFLOW\saved-answers\clips-3.json"
```

The number of batch files depends on your run. Include only real files, and include
all scenes. Incomplete answers are not a complete story. If validation fails, fix
the specific reported fields in Gemini, save the corrected response, and import again.

If you have scenes but lost the cast/outline reply, recover that earlier answer from
the chat. Scene JSON alone normally does not contain the full character and place
definitions required to recreate the package faithfully.

## D. The story already exists, but Flow generation stopped

1. Select its `_story.json` in the GUI under Existing stories.
2. If reference images already exist and are correctly named in Flow, choose your
   clip-generation start phase and paste the existing Flow project URL.
3. If preparation never completed, use From start instead.
4. If the clips already generated, use the download/join controls rather than
   starting generation again.

Do not rebuild the story just because downloading or video generation failed.

## Quick troubleshooting

- **"No JSON" / parse error:** save actual JSON, not the browser error or thinking text.
- **Analysis imports into the wrong script:** `facts` + `clips` use A; `outline` + `scenes` use B/C.
- **Title missing:** supply `--title "Your Title"`.
- **Wrong number of scenes:** check that all scene batches were saved, without duplicates,
  and use the intended `--duration` consistently.
- **Failed validation:** the tool has not accepted the story. Correct the reported
  fields; do not treat the presence of a folder as success.
- **AI Studio signed out:** sign into the dedicated browser and check readiness again.
- **You manually got an answer after the process exited:** save it and use the
  appropriate recovery section. The stopped process cannot collect new replies.

Your original answers are valuable: keep them until the final story and video are verified.
