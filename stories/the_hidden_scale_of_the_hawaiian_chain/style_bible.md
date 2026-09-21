# The Hidden Scale of the Hawaiian Chain - style bible

Preset: **Geography Map (2.5D relief)** (`geography-map`, niche)
Format: Flow, 8s per clip, 8 clips, 64 seconds

## The look
Dark-mode 2.5D topographic shaded-relief cartography, satellite-photoreal hybrid, exaggerated 3D elevation casting long shadows, glowing luminous neon vector boundaries, volumetric atmospheric lighting, deep-space vignette at the frame edge, premium technical infographic finish, zero on-screen text, ultra-sharp 4K satellite aesthetic, NOT flat 2D vector art, NOT toy-like, NOT cel-shaded

## Cast template
No humans, no faces, no avatars - geography, borders, vector markers, terrain and satellite elevation only.

## Palette
Deep Midnight Ocean #080C16, Charcoal Slate Terrain #1C222D with shaded ridges #2A323D, Luminous Amber Gold highlight #FFB703, Electric Neon Cyan waterways #00E5FF, Laser Crimson divider #FF2A42, Lowland Moss Green #2A4736

## Camera
Relentless kinetic motion, 9:16 vertical: high-angle orbital satellite dives, 45-degree isometric flyovers, low-altitude tracking drifts along coastlines and lines. Never a locked-off static shot. Smooth ease-in/out landing on a landmark, rapid zoom-dives through cloud layers, match-cuts on colour fills, whip-pans along neon vectors.

## Direction
Every clip is an evolving geographic VISUALISATION, not a flat slide: glowing boundaries, dashed tracer lines with animated chevron arrows, and translucent illuminated polygon fills demonstrate the single factual claim the narrator is voicing at that instant. Frame ONE already contains the anomaly: the surprising visualisation is happening in the first second - never a slow map tour, a zoom-out to establish, or any build-up. Clip 1 is a HOOK and never the first fact: lead with the single most counter-intuitive claim as a flat STATEMENT, not a question (a question is only the fallback). Every clip after carries exactly ONE new fact or deduction with its specifics (a length, a year, a country, a number) and never repeats the previous line. The last clip is the biggest revelation and its final frame visually echoes the first frame so the film loops. Show the fact, never narrate a walkthrough. Exaggerate every instruction - the model treats 'moves' as 'barely moves': say fast, aggressive, big dramatic framing change, never static. Numbers are spoken as words ('seven thousand', not '7,000'). ENGAGEMENT ICONS (one general rule, never per-topic): as the narrator voices each line, small flat emoji-style icons / sticker graphics pop in on the map, timed to the exact moment each concrete thing is named or implied. Match the icon to whatever the sentence is about - a country or city gets its flag or a simple map-pin marker, war or battle gets crossed swords / a rifle / a tank / a fighter-jet / an explosion burst, money gets a coin or a stack of cash, a ship or voyage gets a ship, a treaty or document gets a scroll, a person or role gets a small flat avatar silhouette, terrain or nature gets a mountain, river, tree or wave, and so on for any noun the line carries. Keep ONE consistent cartoony sticker language for the whole film (thick dark outline, flat fill, soft drop shadow), each icon pops in with a punchy scale-up, each sits beside the relevant point on the map, none covers the map's key line or highlighted border, and none contains any text. No people, no talking heads, no on-screen text.

## Narrator
one casual, energetic male narrator - conversational and a little wry, like a sharp friend explaining something wild, brisk pace, natural contractions and rhetorical asides, never formal or academic

## Sound
driving cinematic ambient dark synth pulse at 110-120 BPM, muted marimba and pizzicato accents, a deep sub-bass braam on every map zoom, high-tech digital chirps as a neon boundary traces, a deep sub-impact rumble when a divider line slices the territory; the music bed stays well under the narration and swells at the final payoff

## Never
no on-screen text, subtitles, captions, watermarks or UI, no country names or map labels, no garbled or distorted letterforms, no human talking heads, faces or avatars, no flat 2D whiteboard or clipart, no cartoon vector icons, no stationary or PowerPoint-style maps, no handheld shake, no film grain or scratches, no live-action footage

## Story shapes that suit this look
- a counter-intuitive geographic paradox, explained through its physical cause
- the map looks ordinary, then one glowing line divides everything
- place A and place B, and the single barrier or line between them
- a calm explanation that keeps getting stranger, then a mind-blowing payoff

## The place
**Ocean** - the one place this film happens in. Every clip is shot here and it
never changes: same furniture, same light, same time of day. The plate
is in `character_sheets.txt` - generate it, save it as
`character_refs/Ocean.jpg`, and mention it with `@Ocean` so the
model is handed the pixels rather than one more description of them.

An eternal, bottomless deep blue ocean backdrop illuminated by warm golden island highlights and clean sans-serif callout labels. The terrain features dark-mode 2.5D topographic shaded-relief cartography with exaggerated 3D elevation casting long shadows. Luminous neon vector boundaries glow against the cool navy abyss, maintaining a premium technical infographic finish. Nothing ever changes, no redecorating occurs, and no new elements ever appear.

## Cast
None. This topic is about the world rather than a person, so no
character sheets were written and there are no reference images to
upload before stage 1. Distant unnamed figures are scenery.

## What happens next
1. Generate the place plate from `character_sheets.txt` and save it
   into `character_refs/` as `Ocean.jpg`.
2. Stage 1: `npm run agent:prompt -- stories/the_hidden_scale_of_the_hawaiian_chain/the_hidden_scale_of_the_hawaiian_chain_story.json`
3. Then the usual stages 2-4.
