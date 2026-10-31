# Cinematic Story Sarah and SAM

Select **Cinematic Sarah & SAM — Film / Serial**. In **Prompts**, copy its updated master prompt into ChatGPT. It asks whether you want a single film or an episode-wise serial. Film mode asks for duration and idea; serial mode offers an optional reference channel/playlist/episode and current niche research, then establishes duration per episode, language, ratio and episode count (10 by default).

The importer uses whole eight-second clips: 12 minutes is 90 clips. For a 60-second request, choose 56 or 64 seconds. Short/long are not exact durations; specify seconds or minutes. Maximum 500 clips (4000 seconds) per imported film. This preset has no 60-clip limit.

ChatGPT returns one complete ready-script TXT with the exact preset ID `reference-cinematic-sarah-sam`. Include all chunks in one file if a long answer needs continuation. Keep outline, SEO and thumbnail material outside that TXT.

Use **Story Writer → Import ready script**, choose this preset, set aspect ratio and attach/paste the complete script. Imported clip count comes from the script. Import writes story JSON, per-character sheet prompts, every location reference prompt, individual clip prompts, Agent prompts, `CONTINUITY_LEDGER.json` and production review notes. It does not generate images or videos by itself.

Then use **Generate References** and the existing **Agent** or **Single Scene** workflow. Model, aspect ratio and credentials still need to be configured. Use the saved download/order/join workflow once the clips are complete; joining requires verified scene mapping. Ingredients Extend is not the recommended route for independent cinematic cuts between locations.

Both leads must be declared exactly **Sarah** and **SAM**. Their appearances/voices are defined once per film. Supporting characters and location names are free, unique simple IDs. Each clip explicitly lists zero to two visible named characters and one location; only those reference assets belong on that clip. Use `Characters: None` for empty shots, and `Voice SAM:` for an offscreen speaker. A film may use many different character/location references across its clips.

Every clip requires `Characters:`, `Location:`, `Transition:`, `Action:`, `Start state:`, timed `Shot N:`, `End state:` and `Audio:`. Optional character dialogue, `Voice Name:` or `Narration:` supplies speech; narration and dialogue cannot share the same clip. Silent clips are valid. Shots must cover exactly 0–8 seconds. A `continuous` transition must keep the location and copy the previous end state exactly. Use `cut` or `time jump` for other transitions, preserving story continuity.

Reference generation, video generation and downloads use existing provider/browser actions. Review faces, wardrobe, props, voice, lip-sync, timing and audio joins before final joining. Music stitching, grading or audio leveling may need editing. A continuity ledger records intended states; it does not inspect rendered video. SEO and thumbnail text from ChatGPT remain separate; import does not publish them.

Run `node tests/cinematic_story.js`, `node tests/reverse_video.js`, `node tests/import_ready_script.js`, `node tests/stable_workflows.js` and `python tests/stable_gui_order.py` for local regression checks. These tests do not spend AI credits or prove live video quality.

## Episode-wise series

In serial mode, ChatGPT reviews the accessible reference material, researches current English AI drama/film niches with dated source links when browsing is available, and suggests five original series titles. Choose a concept to receive a ten-episode roadmap (or your chosen count), a separate SERIES_BIBLE and an episode plan. Missing browsing/video access is disclosed rather than replaced with invented analysis.

Each episode remains a separate ready-script import using the same preset. Example title: `The Last Message - S01E01 - A Voice After Midnight`. Clip numbering starts at 1 in each new episode, and the duration header describes only that episode. Do not paste the season plan, research, bible or SEO into the script importer. The existing importer grammar and eight-second clips remain in use.

After writing each episode ChatGPT supplies a separate SERIES_STATE for the next episode, preserving Sarah/SAM identities, voice, locations, wardrobe, injuries, secrets and props. Keep these files for future chats. The tool writes the existing per-episode continuity ledger; it does not automatically create a season database or share generated reference-image files between episode packages. Reuse approved images through the existing reference workflow where available and check the assets before generation.

Channel and playlist links are planning references for ChatGPT. Video Reverse Engineering accepts individual YouTube video links or local videos, not a whole channel or playlist. You can analyze 1–3 representative videos there and supply the report when detailed media review is needed.
