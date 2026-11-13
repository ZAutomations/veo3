# Google TTS — service account setup

The tool includes all 30 Gemini Cloud TTS voices. Alnilam is the default Google voice.

1. Install/update the tool with Setup so the Google authentication dependency is installed.
2. Keep your service-account JSON locally, for example `TTS/cloud-tts-sa.json`. JSON files in this folder are excluded from Git.
3. Restart Studio. Open Video Editing → Voiceover, enable external voiceover, choose API Voiceover and Google TTS (service account).
4. Browse/save the JSON, select a Google voice and save editing settings.
5. For multilingual output, select Google separately for each desired language and choose its voice.

The current Cloud model is `gemini-3.1-flash-tts-preview`. Requests use OAuth service-account authentication and Cloud Text-to-Speech; there is no Developer API-key fallback. Google Cloud billing/trial credits apply.

On a second laptop, transfer the private JSON separately and browse to its local path. Git pull does not transfer credentials or saved personal provider selections.

Enable Cloud Text-to-Speech and the relevant Agent Platform API in the credential project, link active billing and grant the service account `roles/aiplatform.user` (Agent Platform User). Never edit project/email/private-key values inside a generated JSON to change accounts.

Long Google scene narration receives at most two unchanged-text pacing retries. English Google scenes are fitted independently to approximately 9.48 seconds for 10-second scenes; this avoids applying the longest line's speed to shorter lines. Speech is not cropped. Selected language timings are checked before video generation. Arbitrary text is not guaranteed to fit after the bounded retries.

Completed English/localized videos and thumbnails are published in the original story folder; Audio First working media remain available for resuming.
