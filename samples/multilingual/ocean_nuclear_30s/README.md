# Four-language Zack Animation test

Topic: What Happens When You Drop a Nuclear Bomb Into the Ocean?

Import the sample through Studio or run:

```text
node import_ready_script.js --input samples/multilingual/ocean_nuclear_30s/READY_IMPORT_4_LANGUAGES.txt
```

The normal package is created under stories/3d_zack_style/<title>_ready_<hash>/.

Select the story JSON from that folder in Agent Mode. The package has three 10-second scenes (30 seconds of story), not twelve video clips. A thumbnail end card or preset CTA can increase the final output duration.

The same three visuals are reused for English, Russian, Arabic and Hindi. The JSON preserves each scene's narration_translations and uses multilingual_translation_mode: supplied_only. LANGUAGE_SCRIPTS.json and language_scripts/en.txt, ru.txt, ar.txt and hi.txt are review copies. READY_SCRIPT_EXPORT.txt can be reimported with all languages intact.

For the test:
1. Restart Studio.
2. In Settings -> Multilingual Audio First select Russian, Arabic and Hindi, and save a provider/voice for each. English uses the existing Video Editing voice.
3. In Agent Mode enable Audio First batch, select this original imported story in the queue, and run it normally.
4. Preparation uses the supplied translations without Gemini calls. All selected language audio is timing-checked before Flow generation. English renders first; then the selected language videos render on the same raw visuals.

No HeyGen speech or Flow video was generated while creating this sample. The texts target roughly 9.5 seconds per scene; they are not measured voice recordings. Actual provider delivery still needs testing. An overlong supplied translation will stop with the exact scene needing correction, without cutting speech or silently invoking Gemini. English text in a generated thumbnail is not automatically localized; shared video visuals are requested without written labels.

Factual sources used for the educational, non-operational effects overview:
- https://www.un.org/en/observances/end-nuclear-tests-day/history
- https://www.acq.osd.mil/ncbdp/nm/NMHB2020rev/chapters/chapter13.html

No construction, triggering, yield, damage-radius or deployment instructions are included.
