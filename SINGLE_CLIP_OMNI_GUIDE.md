# Single Clip Omni

## Run

1. Reopen the launcher and select **Single Clip Omni**.
2. Choose your story JSON and From/To range (To = 0 means the last scene).
3. Select Omni Flash, aspect ratio and generation resolution.
4. Prepare references as before, or enable **References already in this project**. Saved couple uploads Sarah/George and generates the location. All references attach to every standalone prompt.
5. Enable **Use simple test prompts when available** to use `simple_test_clip_prompts/clip_001.txt`, etc. Otherwise the scene's stored prompt is used directly.
6. Enable **Download Upscaled 720p between batches** and click **Generate clips**.

## Five-clip workflow

- Submit clips 1-5 individually, pausing 5 seconds between submissions.
- Wait for all five to finish.
- Submit clips 6-10 individually.
- While 6-10 generate, download completed clips 1-5 through **More options > Download > Upscaled 720p** in a background tab.
- Wait for 6-10 to finish, submit the next group, and download the preceding group.
- Download the final group after it finishes. A last group may contain fewer than five clips.

The generation page stays open: no per-prompt reload, repeated whole-project inventory or scrolling during the completion wait. It may be positioned at the top once if initially scrolled away. The download tab walks only as needed to locate a requested completed clip.

Files are saved as `clips/scene-01.mp4`, etc., using the exact source prompt and original story scene number. Each file is decoded and checked for 720p before it is recorded as downloaded. The menu must offer an Upscaled choice; original-size downloads are never substituted. Existing verified Upscaled files for the same project and prompt are skipped.

## Stop and continue

Reuse the same project URL, story and scene range. The separate `single_clip_omni_PROJECT_FROM_TO.json` checkpoint skips completed scenes and waits for submitted scenes. An interruption during an unconfirmed submission stops safely instead of submitting a possible duplicate.

Compatible checkpoints from earlier scene ranges in the same project contribute to the download backlog. An earlier submitted group whose checkpoint was interrupted is checked once against actual source tiles. Completed older clips download while the next group generates.

The upscaled-download ledger is `omni_upscaled_PROJECT.json`. It preserves completed downloads. **Download clips** checks ALL story scenes, regardless of the generation range, skips verified files and can finish downloads without generating videos.

An already-open project home tab is reused without navigating or reloading it. Failed clips can use their own Retry or Reuse prompt control, with at most two automatic attempts per scene. Policy, unusual-activity and credit restrictions stop for correction. There is no conversation-level retry or blind resubmission.

## Join

`clips/omni_manifest.partial.json` records download progress. The main `manifest.json` is replaced only after every story scene has a verified download, in story order. A previous manifest is backed up; partial downloads do not overwrite it. Joining waits for all story scenes. Earlier versions of a replaced scene are retained in `clips/_replaced/`.

Local tests cover sequencing, no per-prompt reload/scroll, source-prompt matching, menu selection, actual video decoding/resolution checks, resume skipping and manifest ordering. A live paid Flow generation/upscale has not been run as part of this update.
