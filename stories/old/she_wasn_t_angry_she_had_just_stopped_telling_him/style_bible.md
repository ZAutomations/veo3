# She Wasn't Angry. She Had Just Stopped Telling Him. - style bible

Preset: **Relationship Dialogue** (`relationship-dialogue`, niche)
Format: 9:16, 8s per clip, 9 clips, 72 seconds

## The look
2.5D semi-realistic anime illustration, high-end digital painting, 8K resolution, ultra-detailed textures, delicate soft lighting, atmospheric ambient light, shallow depth of field, 35mm lens, smooth subtle facial movement, high aesthetic detail

## Cast template
2.5D semi-realistic anime illustration, high-end digital painting, 8K ultra-detailed, polished manhwa/webtoon cover finish. Realistic adult human proportions with gently idealised features: large luminous expressive eyes with long lashes, delicate defined facial structure, a small refined nose, soft blushing cheeks, smooth glossy semi-realistic skin, and hair rendered strand by strand with individual highlights. Warm golden-hour glow, rich saturated colour, high aesthetic detail. Indian household styling: a saree or salwar-kameez whose colours, border and pallu are stated once, henna mehndi on the hands and forearms, oxidised silver jhumka earrings, glass bangles and a delicate necklace, all fixed for that character and never changed. NOT chibi, NOT super-deformed, NOT a flat cel-shaded cartoon, NOT live-action, NOT a photograph, NOT 3D CGI.

## Palette
Warm golden-hour light, honeyed amber, warm cream and porcelain white, mustard yellow and off-white, indigo and dusty rose, deep teal shadow, henna brown, oxidised silver, soft gold highlights

## Camera
Static locked-off camera, no movement while a line is spoken. When one of them speaks: a clean CUT to an over-the-shoulder medium close-up from behind the listener, framed tight on the SPEAKING face, the listener a soft-focus edge in the foreground. When both speak or the beat needs air: the wide two-shot at eye level with both in frame. Occasional medium close-up on the speaker. No pans, no dollies, no zooms, no scene transitions.

## Direction
This is a two-hander. Two people are together in one calm, beautiful room and talk to each other - the SAME room and the same light for the entire film. They never move to another place and the room never changes. Nothing about either of them changes either: the same face, the same hairstyle and the same clothes from the first clip to the last. Everything said is said out loud by one of them to the other, in their own voice. There is no narrator and nobody describes the scene. Build the exchange as a hook that makes the viewer stop, then two or three numbered rules, then the younger one pushing back with the doubt the audience is actually feeling, then one sharp aphorism worth repeating, then a warm resolution. Give the listener something to do while the other speaks: a hand stilled, a shoulder turned away, an eye-line that drops and comes back. The camera cuts to whoever is speaking: when one of them talks, the shot is an over-the-shoulder close-up framed on the speaker with the listener in soft focus in the foreground; when both speak, or a beat needs air, hold the wide two-shot. Cut between angles, never pan, and keep the same axis so their left and right positions never flip. Let the warmth be earned by the truth of the advice, never by sentimentality.

## Voices
No narrator and no voice-over. The cast speak on screen, to each other,
and every word in the film comes out of one of their mouths.

## Script
- *The Hook* — **Mira:** "I'm not angry with you, Dev. That's the problem." **Dev:** "Wait, isn't that a good thing?"
- *His Defense* — **Dev:** "We haven't fought in months. We're finally peaceful." **Mira:** "Peace and distance look the same from far away."
- *The Truth* — **Mira:** "I didn't stop because I was happy. You only ever defended yourself." **Dev:** "I was just trying to solve things for us."
- *The Turn* — **Dev:** "So all this time... you were just slipping away?" **Mira:** "I was standing right here, waiting for you to hear me."
- *The Exhaustion* — **Mira:** "Silence was less exhausting than talking to someone who wouldn't listen." **Dev:** "I never wanted you to feel alone in this room."
- *The Doubt* — **Mira:** "Why should I believe this time will be any different?" **Dev:** "Because I am actually listening now. Please, Mira."
- *The Aphorism* — **Mira:** "A house isn't happy just because it's quiet." **Mira:** "Silence is either love or a door closing." **Dev:** "I never heard it shut."
- *His Realization* — **Dev:** "I mistook your quiet for happiness." **Dev:** "I thought no fighting meant we were fine." **Mira:** "It just meant I had given up."
- *Resolution* — **Dev:** "Tell me the first thing you stopped saying." **Dev:** "I'm listening now, Mira. Every word." **Mira:** "It started six months ago, Dev."

## Never
no narrator and no voice-over of any kind, no on-screen text, subtitles, captions, watermarks or UI, no live-action or photographic realism, no 3D CGI sheen, no flat cel-shaded cartoon look, no chibi or super-deformed proportions, no glitch, no motion blur, no exaggerated or comedic expressions, no shouting matches, no explicit content, no cynicism, no graphic conflict

## Story shapes that suit this look
- a provocative opening line, then numbered rules, then the younger one pushes back, then a sharp aphorism, then a warm resolution
- an older woman tells her granddaughter the thing nobody told her in time
- two people disagree about the same relationship and both are partly right
- a hard rule delivered kindly over tea, and the doubt it has to survive

## The place
**Bedroom** - the one place this film happens in. Every clip is shot here and it
never changes: same furniture, same light, same time of day. The plate
is in `character_sheets.txt` - generate it, save it as
`character_refs/Bedroom.jpg`, and mention it with `@Bedroom` so the
model is handed the pixels rather than one more description of them.

A dimly lit late-night bedroom featuring a low wooden bed framed against a neutral wall with a crumpled cream quilt. On the left, a warm brass bedside lamp casts soft amber light, while deep soft shadows fill the room. A half-open window reveals city lights outside, and a smartphone lies face-down on the wooden nightstand. Fixed room that never changes.

## Cast
**mira** - Same Mira throughout - 2.5D semi-realistic anime illustration, high-end digital painting, 8K ultra-detailed, polished manhwa cover finish. Realistic adult human female, 27 years old, soft features, long dark wavy hair loose over one shoulder, large luminous tired brown eyes with long lashes, smooth semi-realistic skin. Wearing a dusty-rose cotton kurta set with thin gold border, small gold stud earrings, plain gold wedding band. Henna mehndi on forearms. NOT chibi, NOT 3D CGI, NOT live-action, NOT photographic realism.
**dev** - Same Dev throughout - 2.5D semi-realistic anime illustration, high-end digital painting, 8K ultra-detailed, polished manhwa cover finish. Realistic adult human male, 30 years old, short dark hair, light stubble, kind but distracted brown eyes, subtle facial structure, smooth semi-realistic skin. Wearing a plain charcoal t-shirt, grey pyjama trousers, and a silver wedding ring. NOT chibi, NOT 3D CGI, NOT live-action, NOT photographic realism, NOT flat cel-shaded cartoon.

## What happens next
1. Generate the sheets AND the place plate from `character_sheets.txt`
   (Whisk or any image tool), and save each one into `character_refs/`
   under the name it gives.
2. Do not upload them as Flow Characters. Stage 2 uploads each sheet as a
   plain image and mentions it with `@Name`, which is what holds the cast
   together; a Flow Character drifts between clips. The place plate is
   mentioned the same way.
3. Stage 1: `npm run agent:prompt -- stories/she_wasn_t_angry_she_had_just_stopped_telling_him/she_wasn_t_angry_she_had_just_stopped_telling_him_story.json`
4. Then the usual stages 2-4.
