# Ready script import compatibility

All 65 registered presets support direct local ready-script import. No Gemini story-writing call is made during import.

Copy the current preset master prompt from the Prompts tab. Each story starts with Story N and uses Title, Preset, Clip seconds, Estimated duration, Setting or Locations, Characters, then consecutive Clip N headings. Use the selected preset template for narration, named dialogue or silent action. Visual and Veo Prompt are not script field labels; use timed Shot N fields. Motivational presets retain their continuous Action/state format.

Original identities, rendering, assigned voices and locked-camera rules remain preset-specific. Intro narration stays in the first clip; silent presets have no invented voice-over. A supported script duration does not override a video model that cannot produce that duration.

Validation: tests/all_presets_ready_import.js checks 65 presets at four durations (260 combinations), TXT round trips, exact supplied speech, and one actual temporary JSON/Agent/individual-prompt package per preset. It does not call Gemini or generate media. Passing validates these fixtures and export paths, not every possible model-written script or future Flow UI.

Existing scripts with unsupported labels still need conversion to the updated template; the importer does not silently reinterpret arbitrary prose.

| Preset | Speech mode | Clip seconds | Import route |
|---|---|---|---|
| world-politics-map-explain | narrated | 4 / 6 / 8 / 10 | Dedicated importer |
| fern-documentary | narrated | 4 / 6 / 8 / 10 | Dedicated importer |
| 3d-zack-style | narrated | 4 / 6 / 8 / 10 | Dedicated importer |
| geography-map | narrated | 4 / 6 / 8 / 10 | Dedicated importer |
| intimacy-health-3d | narrated | 4 / 6 / 8 / 10 | Dedicated importer |
| reference-wolf-dark-secrets-fable-dialogue | dialogue | 4 / 6 / 8 / 10 | Dedicated importer |
| reference-babyandghost-relationship | dialogue | 4 / 6 / 8 / 10 | Dedicated importer |
| relationship | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| relationship-dialogue | dialogue | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| relationship-dialogue-ghibli | dialogue | 4 / 6 / 8 / 10 | Dedicated importer |
| relationship-dialogue-real | dialogue | 4 / 6 / 8 / 10 | Dedicated importer |
| relationship-dialogue-3d | dialogue | 4 / 6 / 8 / 10 | Dedicated importer |
| fantasy-princess-relationship-advice | dialogue | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| relationship-narration-colorful-cartoon | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| relationship-dialogue-colorful-cartoon | dialogue | 4 / 6 / 8 / 10 | Dedicated importer |
| relationship-dialogue-dog-couple | dialogue | 4 / 6 / 8 / 10 | Dedicated importer |
| genai-stone-age | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-anime-recap | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-crime-2d | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-horror-2d | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-history-graphic | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-history-cel | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-history-painterly | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-dark-conspiracy | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-stick-battle | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-stick-realface | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-stick-whiteface | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-stick-flat | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-3d-render | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-vox-collage-history | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-vox-collage-crime | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-vox-collage-business | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-vector-health | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-papercut-history | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-papercut-finance | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-oil-finance | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| genai-space-cel | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| ww2-history | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| mafia | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| true-crime | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| health-wellness | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| personal-finance | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| fall-asleep | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| travel-adventure | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| cooking | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| gaming-esports | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| technology-ai | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| ghibli | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| pixar-3d | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| anime-cinematic | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| disney-classic | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| shinkai | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| lofi-anime | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| cartoon-network | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| realistic-cgi | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| vintage-anime-90s | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| chibi-cute | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| avatar-korra | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| science-what-if | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| animal-kindness | intro | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| 3d-moral-story | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| 3d-explainer | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| 3d-map | narrated | 4 / 6 / 8 / 10 | Shared preset-preserving importer |
| 3d-motivational-red-green | narrated | 4 / 6 / 8 / 10 | Dedicated importer |
| heartwarming-cat-3d | silent | 4 / 6 / 8 / 10 | Dedicated importer |
