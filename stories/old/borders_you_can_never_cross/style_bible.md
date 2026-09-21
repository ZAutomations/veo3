# Borders You Can Never Cross - style bible

Preset: **3D Map** (`3d-map`, niche)
Format: Flow, 8s per clip, 8 clips, 64 seconds

## The look
Dynamic 3D satellite globe map animation, photoreal satellite terrain and cloud layers, stylised flat colour fills standing in for each country (abstract, not real national flags), glowing border highlights, animated barrier and route graphics, bold geometric callout shapes, fast smooth camera pans and zooms across regions, bright overhead key light, cinematic colour grading, premium data-visualisation quality

## Cast template
No characters. The subject is the world itself; if a single small distant figure is needed for scale it is a plain silhouette with no facial features.

## Palette
Deep ocean blues and satellite greens, arid tan and ochre, cold slate grey, glowing cyan and red border-highlight lines, clean white callout accents

## Camera
Fast but smooth pans and zooms across a 3D globe, regional push-ins that land on a border or a chokepoint, occasional pull-backs to the whole planet. One clear move per beat, no shaky motion.

## Narrator
energetic clear male voice, fast and precise, documentary authority, punchy but measured

## Never
no on-screen text, words, subtitles, captions, watermarks or UI, no readable country names or labels, no real national flags, emblems or political symbols, no live-action people, no flat 2D paper-map look, no cartoon or anime styling, no wobbly or invented coastlines, no glitch, no motion blur

## Story shapes that suit this look
- a surprising fact about a border or a chokepoint, explained in three moves
- the globe looks ordinary, then one highlighted border changes everything
- place A and place B, and the one sealed line between them
- a calm explanation that keeps getting stranger

## The place
**Virtual Globe** - the one place this film happens in. Every clip is shot here and it
never changes: same furniture, same light, same time of day. The plate
is in `character_sheets.txt` - generate it, save it as
`character_refs/Virtual Globe.jpg`, and mention it with `@Virtual Globe` so the
model is handed the pixels rather than one more description of them.

A photorealistic 3D digital satellite globe floating in dark space, lit by a bright overhead directional light. Topographic mountain terrain, ocean blues, and cloud layers wrap around the rotating sphere. Styled flat color fills define national territories without flags or text labels. The environment remains static, with smooth camera movements zooming into glowing border highlights.

## Cast
None. This topic is about the world rather than a person, so no
character sheets were written and there are no reference images to
upload before stage 1. Distant unnamed figures are scenery.

## What happens next
1. Generate the place plate from `character_sheets.txt` and save it
   into `character_refs/` as `Virtual Globe.jpg`.
2. Stage 1: `npm run agent:prompt -- stories/borders_you_can_never_cross/borders_you_can_never_cross_story.json`
3. Then the usual stages 2-4.
