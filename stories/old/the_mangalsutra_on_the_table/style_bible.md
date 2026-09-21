# The Mangalsutra on the Table - style bible

Preset: **Relationship Dialogue (Realistic)** (`relationship-dialogue-real`, niche)
Format: 9:16, 8s per clip, 9 clips, 72 seconds

## The look
Photorealistic 4K cinematic film, 35mm anamorphic lens quality, natural shallow depth of field, real-world lighting balance, physical micro-textures in skin, hair and fabric, restrained natural colour grading, premium streaming drama quality

## Cast template
Photorealistic adult human with exact realistic adult proportions, natural skin texture with visible pores and fine hair, small natural asymmetries in the face, real fabric clothing in fixed colours, un-styled contemporary or gently vintage hair, an unposed and un-retouched face. NOT illustration, NOT manhwa or webtoon, NOT cartoon, NOT anime, NOT 3D CGI, NOT a painting, NOT a photograph of a known person.

## Palette
Honeyed afternoon light through gauze curtains, warm cream and porcelain white, muted sage green, dusty rose, deep teal shadow, soft gold highlights

## Camera
Static locked-off camera, no movement while a line is spoken. When one of them speaks: a clean CUT to an over-the-shoulder medium close-up from behind the listener, framed tight on the SPEAKING face, the listener a soft-focus edge in the foreground. When both speak or the beat needs air: the wide two-shot at eye level with both in frame. Occasional medium close-up on the speaker. No pans, no dollies, no zooms, no scene transitions.

## Direction
This is a two-hander. Two people sit close together in one calm room and talk to each other - the SAME room, the same table and the same light for the entire film. They never move to another place and the room never changes. Everything said is said out loud by one of them to the other, in their own voice. There is no narrator and nobody describes the scene. Build the exchange as a hook that makes the viewer stop, then two or three numbered rules, then the younger one pushing back with the doubt the audience is actually feeling, then one sharp aphorism worth repeating, then a warm resolution. Give the listener something to do while the other speaks: a teacup turned, a hand stilled, an eye-line that drops and comes back. The camera cuts to whoever is speaking: when one of them talks, the shot is an over-the-shoulder close-up framed on the speaker with the listener in soft focus in the foreground; when both speak, or a beat needs air, hold the wide two-shot. Cut between angles, never pan, and keep the same axis so their left and right positions never flip. Let the warmth be earned by the truth of the advice, never by sentimentality.

## Voices
No narrator and no voice-over. The cast speak on screen, to each other,
and every word in the film comes out of one of their mouths.

## Script
- *The Public Dismissal* — **Dev:** "Smile, Ananya. Your primary job today is looking pretty." **Ananya:** "My job?" **Dev:** "You wear my gold and grace my table. Nothing more."
- *A Quiet Correction* — **Ananya:** "Marriage is not a decorative ornament, Dev." **Dev:** "Do not start a scene here." **Ananya:** "I am merely returning your decoration."
- *The Blue Folder* — **Ananya:** "This formal notice revokes my trust fund guarantee." **Dev:** "What are you talking about?" **Ananya:** "Your firm no longer has my corporate backing."
- *Counting the Cost* — **Dev:** "You cannot withdraw this! Credit lines freeze at midnight!" **Ananya:** "Then you have six hours to find capital."
- *Desperate Entreaties* — **Dev:** "You are destroying us! On our anniversary, Ananya?" **Ananya:** "You destroyed us long before today." **Dev:** "Sign the extension. Please."
- *Exposing the Illusion* — **Ananya:** "Respect is built on character, Dev. Not fragile status." **Dev:** "I gave you everything!" **Ananya:** "You gave me gold. I kept your empire alive."
- *A Sharp Truth* — **Ananya:** "Loud arrogance creates noise, Dev. Quiet dignity makes history." **Dev:** "You are destroying us over a petty comment!"
- *Begging for Time* — **Dev:** "Please, Ananya. Just sign the extension until tomorrow morning." **Ananya:** "Your midnight deadline is yours alone to meet." **Dev:** "I am begging you."
- *The Calm Exit* — **Dev:** "What do I tell the board?" **Ananya:** "Tell them you were always entirely on your own."

## Never
no narrator and no voice-over of any kind, no on-screen text, subtitles, captions, watermarks or UI, no illustration, no manhwa or webtoon rendering, no cartoon, no anime, no 3D CGI sheen, no painted or drawn look, no glitch, no motion blur, no exaggerated or comedic expressions, no shouting matches, no explicit content, no cynicism, no graphic conflict

## Story shapes that suit this look
- a provocative opening line, then numbered rules, then the younger one pushes back, then a sharp aphorism, then a warm resolution
- an older woman tells her granddaughter the thing nobody told her in time
- two people disagree about the same relationship and both are partly right
- a hard rule delivered kindly over tea, and the doubt it has to survive

## The place
**Tearoom** - the one place this film happens in. Every clip is shot here and it
never changes: same furniture, same light, same time of day. The plate
is in `character_sheets.txt` - generate it, save it as
`character_refs/Tearoom.jpg`, and mention it with `@Tearoom` so the
model is handed the pixels rather than one more description of them.

A quiet tearoom corner by one tall window. A round marble-topped table sits between two upholstered chairs, gauze curtains hang at the window, a small vase of white orchids stands beside a stack of saucers, and a folded letter rests on the table. Warm late-afternoon light falls from the window on the left. The room is LOCKED: static background, unchanging spatial layout, the same furniture, the same light, the same camera axis in every clip - no scene transitions, no redecorating.

## Cast
**ananya** - Same Ananya throughout - Photorealistic adult human with exact realistic adult proportions, natural skin texture with visible pores and fine hair, small natural asymmetries in the face, wearing an understated royal-blue Banarasi silk saree, hair in a neat low bun with small jasmine buds, an unposed and un-retouched face. NOT illustration, NOT manhwa or webtoon, NOT cartoon, NOT anime, NOT 3D CGI, NOT a painting, NOT a photograph of a known person.
**dev** - Same Dev throughout - Photorealistic adult human with exact realistic adult proportions, natural skin texture with visible pores and fine facial hair, small natural asymmetries in the face, wearing a tailored charcoal grey bandhgala suit with small gold buttons, short neatly trimmed black hair and a groomed beard, an unposed and un-retouched face. NOT illustration, NOT manhwa or webtoon, NOT cartoon, NOT anime, NOT 3D CGI, NOT a painting, NOT a photograph of a known person.

## What happens next
1. Generate the sheets AND the place plate from `character_sheets.txt`
   (Whisk or any image tool), and save each one into `character_refs/`
   under the name it gives.
2. Do not upload them as Flow Characters. Stage 2 uploads each sheet as a
   plain image and mentions it with `@Name`, which is what holds the cast
   together; a Flow Character drifts between clips. The place plate is
   mentioned the same way.
3. Stage 1: `npm run agent:prompt -- stories/the_mangalsutra_on_the_table/the_mangalsutra_on_the_table_story.json`
4. Then the usual stages 2-4.
