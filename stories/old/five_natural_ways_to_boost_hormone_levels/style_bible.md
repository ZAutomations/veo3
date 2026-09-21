# Five Natural Ways to Boost Hormone Levels - style bible

Preset: **Health & Wellness** (`health-wellness`, niche)
Format: 16:9, 8s per clip, 8 clips, 64 seconds

## The look
Professional medical documentary style, clean bright lighting, modern healthcare aesthetic, trustworthy scientific presentation, calming professional atmosphere, educational clarity

## Cast template
Healthy realistic adult humans with realistic adult proportions, clean simple modern clothing, calm approachable expressions, bright even lighting. NOT cartoon, NOT anime, NOT exaggerated anatomy.

## Palette
Clean whites, medical blues, calming greens, professional grays

## Camera
Clear educational framing, professional presentation style, clean compositions

## Narrator
clear warm female voice, reassuring and professional, steady pace

## Never
no medical gore, no fear-mongering, no unproven claims, no on-screen text, no dark or clinical coldness

## Story shapes that suit this look
- one habit changed and what followed over a year
- a body process explained through one person living it
- a common mistake and the simple fix

## The place
**Studio** - the one place this film happens in. Every clip is shot here and it
never changes: same furniture, same light, same time of day. The plate
is in `character_sheets.txt` - generate it, save it as
`character_refs/Studio.jpg`, and mention it with `@Studio` so the
model is handed the pixels rather than one more description of them.

A bright modern wellness studio featuring polished white oak flooring, soft off-white walls, and large floor-to-ceiling glass windows welcoming natural morning light. A minimalist oak credenza sits against the back wall beneath a healthy potted fiddle-leaf fig. The room maintains consistent diffused daytime illumination, with no changes in decor or lighting across all angles.

## Cast
**elena** - Same Elena throughout - Healthy realistic adult woman in her early thirties with realistic adult proportions, wearing a clean sage green athletic top and modern grey trousers. She has shoulder-length brown hair neatly tied back, a calm approachable expression, and fair skin under bright even lighting in a modern live-action photographic medium. NOT cartoon, NOT anime, NOT exaggerated anatomy.

## What happens next
1. Generate the sheets AND the place plate from `character_sheets.txt`
   (Whisk or any image tool), and save each one into `character_refs/`
   under the name it gives.
2. Do not upload them as Flow Characters. Stage 2 uploads each sheet as a
   plain image and mentions it with `@Name`, which is what holds the cast
   together; a Flow Character drifts between clips. The place plate is
   mentioned the same way.
3. Stage 1: `npm run agent:prompt -- stories/five_natural_ways_to_boost_hormone_levels/five_natural_ways_to_boost_hormone_levels_story.json`
4. Then the usual stages 2-4.
