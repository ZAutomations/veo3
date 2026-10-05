# AI Studio browser workflow

Use this folder as your guide. The actual automation remains in the main Veo3 folder.
You do not need GEMINI-BY-HAND's BAT files for the normal workflow.

## 1. First-time setup

1. Open your Veo3 GUI.
2. Select **Google AI Studio (browser)** as the story writer.
3. Click **Check AI Studio**. Allow the tool to open its dedicated Chrome window.
4. Sign into Google in THAT window. It uses its own profile, separate from Flow.
5. Open an AI Studio chat and select the Gemini model you want there. The automation
   uses the model selected on the website; the GUI's API model field does not select it.
6. Click **Check AI Studio** again. Start the task after it reports ready.

Technical defaults: AI Studio browser port 9223; profile
`%LOCALAPPDATA%\flow-profiles-aistudio`. You normally do not need to change these.

## 2. Normal use

1. Select your preset, for example `3d-zack-style`.
2. Choose Video link or Ideas and enter the source or your idea.
3. Set your duration and other generation options.
4. Select **Google AI Studio (browser)**.
5. Start **Write story**, or **Generate batch** if you want the enabled Flow stages too.
6. Let the automation control its AI Studio window. Avoid typing additional messages
   into that chat while it is running.

For a video link, the sequence is:

VIDEO ANALYSIS -> CAST AND OUTLINE -> SCENES -> VALIDATION -> STORY FILES

For an idea, there is no reference-video analysis step.

When a preset is selected, analysis receives that preset and its current instructions.
The full list of presets is only sent when no preset is selected.

## 3. What gets saved

Successful story writing creates:

`D:\MyFinalAutomations\Veo3\stories\<story_name>\`

The main file is `<story_name>_story.json`. The package also contains supporting
style/reference files as applicable to the preset, such as `style_bible.md`,
`character_sheets.txt`, `refs.json`, and `character_refs`.

The presence of a folder alone does not prove the story is complete: a manual
prompt-preparation step can create a folder containing only `prompts`.
Look for successful validation and the final `_story.json` file.

If you ran story writing only, select the finished story under **Existing stories**
in the GUI to begin Flow generation. Generating the story itself does not make videos.

## 4. If it stops

1. Save the useful AI Studio answer before sending anything else.
2. Check the GUI log: is the automation still running or has it exited?
3. If it exited, typing "retry" into AI Studio will not restart the stopped automation.
4. Follow **RECOVERY.md** in this folder. Choose the route by the JSON keys:

| Your answer contains | What you have | Recovery section |
|---|---|---|
| `title_suggestion`, `facts`, `clips` | Video analysis | A |
| `outline`, `characters` AND a separate object with `scenes` | Full writer reply | B |
| Only `outline` or only some `scenes` batches | Partial writer reply | C |
| A complete saved `_story.json` on disk | Finished story | D |

The analysis field `clips` is NOT the same as the finished story field `scenes`.

## 5. Current limits

- Browser mode does not use your API keys for writing. AI Studio can still fail or impose limits.
- The driver makes up to three attempts per prompt. A reply can take several minutes.
- There is currently no GUI "Recover from Gemini answer" button. Use the commands in RECOVERY.md.
- Recovery creates story files. It does not automatically resume a previously stopped Flow batch.
- A valid-looking analysis is not proof the video was actually read. Check the facts if Gemini reported source-access problems.

Guide prepared 29 September 2026 from the current local implementation.
