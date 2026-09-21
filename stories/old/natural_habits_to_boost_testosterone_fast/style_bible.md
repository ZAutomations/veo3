# Natural Habits to Boost Testosterone Fast - style bible

Preset: **Health & Wellness** (`health-wellness`, niche)
Format: Flow, 8s per clip, 2 clips, 16 seconds

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
**Gym** - the one place this film happens in. Every clip is shot here and it
never changes: same furniture, same light, same time of day. The plate
is in `character_sheets.txt` - generate it, save it as
`character_refs/Gym.jpg`, and mention it with `@Gym` so the
model is handed the pixels rather than one more description of them.

A modern, high-end fitness facility featuring sleek rubber flooring, clean ambient overhead lighting, weight racks, pull-up bars, and floor-to-ceiling windows. Natural sunlight streams across the floor from the side. The layout, equipment positioning, dynamic high-contrast lighting, and bright daylight remain completely unchanged throughout, maintaining a pristine, professional atmosphere free of clutter or changing equipment.

## Cast
**david** - Same David throughout - Healthy realistic adult human, 30 years old, athletic build, wearing a clean charcoal gray athletic t-shirt and dark shorts, short dark brown hair, calm approachable expression, bright even lighting, live-action photograph style. Natural realistic proportions, well-defined features, smooth skin tone, professional look. NOT cartoon, NOT anime, NOT exaggerated anatomy.
**ethan** - Same Ethan throughout - Healthy realistic adult human, 32 years old, lean muscular build, wearing a clean navy blue crewneck t-shirt and grey joggers, neat black hair, calm approachable expression, bright even lighting, live-action photograph style. Natural realistic proportions, friendly clear face, professional wellness presentation. NOT cartoon, NOT anime, NOT exaggerated anatomy.

## What happens next
1. Generate the sheets AND the place plate from `character_sheets.txt`
   (Whisk or any image tool), and save each one into `character_refs/`
   under the name it gives.
2. Do not upload them as Flow Characters. Stage 2 uploads each sheet as a
   plain image and mentions it with `@Name`, which is what holds the cast
   together; a Flow Character drifts between clips. The place plate is
   mentioned the same way.
3. Stage 1: `npm run agent:prompt -- stories/natural_habits_to_boost_testosterone_fast/natural_habits_to_boost_testosterone_fast_story.json`
4. Then the usual stages 2-4.
