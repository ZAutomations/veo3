# The Secret Note That Changed History - style bible

Preset: **3D Shorts (Zack D. style)** (`3d-zack-style`, niche)
Format: Flow, 8s per clip, 7 clips, 56 seconds

## The look
Stylised realistic 3D animation, clean even studio lighting, saturated colour, a clean bright cyan-blue flat studio backdrop, glossy clean surfaces, crisp detail, soft contact shadows, NOT photorealistic film, NOT toy-like, NOT flat 2D

## Cast template
One stylised realistic 3D human adult male, realistic proportions with clean cartoon-clean skin, a plain white t-shirt, plain modern clothing in fixed colours, a natural relaxed expression. NOT anime, NOT cel-shaded, NOT photorealistic.

## Palette
Bright cyan-blue backdrop, clean white, saturated primaries, bold glowing yellow highlight, deep charcoal accents, natural skin tones

## Camera
Strong continuous movement in every shot: push-ins, fast arcs, hard framing changes. Start on A then push in fast and hard onto B with a slight arc. Kinetic and exaggerated, never static, never a subtle drift. One clear idea per shot.

## Direction
Retention-first 3D explainer. Every clip is ONE new shock, never a summary. Frame ONE already contains the anomaly: the surprising action happens in the first second - never a walk-in, a camera establish or any build-up. The first line is a STATEMENT that opens a curiosity gap, not a question ('You have eaten hundreds of bananas and never once found a seed.'). Each later line says exactly one NEW thing and never repeats the previous line. The LAST line is the biggest revelation, and the final frame visually echoes the first frame so the film loops. SHOW the fact, never narrate a walkthrough: a bold bright glowing yellow ring snaps around the exact detail being named and pulses hard, like a loud graphic annotation burned over the footage. Numbers are spoken as words ('seven thousand', not '7,000'). Exaggerate every instruction - the model treats 'moves' as 'barely moves'; say fast, aggressive, big dramatic framing change. No on-screen text anywhere; captions and emphasis text are added in post.

## Narrator
calm male narrator, casual and matter-of-fact, unhurried and slightly slowed, never salesy, never dramatic

## Sound
clean diegetic SFX only - bites, clicks, whooshes, scrapes, rattles, and a low ominous drone on the kicker - with NO background music bed at all

## Never
no on-screen text, captions, subtitles, watermarks or UI, no photorealistic film look, no toy-like or plastic childlike render, no flat 2D, no cel-shaded or anime look, no dark or moody background, no jungle or busy environment, no clutter, no background music, no walk-in or establishing build-up, no static or subtly drifting camera, no repeated line, no digits written as numbers, no real brand logos or trademarks

## Story shapes that suit this look
- an everyday object hides one wrong-looking detail - reveal why
- a thing you have seen a hundred times is secretly one single copy
- a normal fact, then each line makes it stranger until a final kicker
- a hidden process the viewer has never pictured, shown step by step

## The place
**Study** - the one place this film happens in. Every clip is shot here and it
never changes: same furniture, same light, same time of day. The plate
is in `character_sheets.txt` - generate it, save it as
`character_refs/Study.jpg`, and mention it with `@Study` so the
model is handed the pixels rather than one more description of them.

A warm, compact home study featuring a polished dark wooden desk, a comfortable green leather armchair, a tall bookshelf lined with leather-bound volumes, and a single framed photograph of a mother on the wall. Natural light streams softly through a side window illuminating dust motes. Never change the furniture, the wall decor, the lighting angle, or the desk arrangement across any scene.

## Cast
**thomas** - Same Thomas throughout - One stylised realistic 3D human adult male, realistic proportions with clean cartoon-clean skin, a plain white t-shirt, plain modern clothing in fixed colours, a natural relaxed expression. He has short messy brown hair and expressive amber eyes. Rendered in stylised realistic 3D character rendering with slightly exaggerated head proportions and soft contact shadows. NOT anime, NOT cel-shaded, NOT photorealistic.

## What happens next
1. Generate the sheets AND the place plate from `character_sheets.txt`
   (Whisk or any image tool), and save each one into `character_refs/`
   under the name it gives.
2. Do not upload them as Flow Characters. Stage 2 uploads each sheet as a
   plain image and mentions it with `@Name`, which is what holds the cast
   together; a Flow Character drifts between clips. The place plate is
   mentioned the same way.
3. Stage 1: `npm run agent:prompt -- stories/the_secret_note_that_changed_history/the_secret_note_that_changed_history_story.json`
4. Then the usual stages 2-4.
