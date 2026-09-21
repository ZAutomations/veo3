# She Let His Mistress Win - style bible

Preset: **Relationship Dialogue** (`relationship-dialogue`, niche)
Format: 9:16, 8s per clip, 9 clips, 72 seconds

## The look
Cinematic digital manhwa art style, soft 3D cel-shaded realism, 4k resolution, delicate soft lighting, atmospheric indoor ambient light, shallow depth of field, 35mm lens, smooth subtle facial movement, high aesthetic detail

## Cast template
Cinematic digital manhwa character, soft 3D cel-shaded semi-realistic rendering, realistic adult human proportions, delicate defined facial structure, detailed hair with individual strands, expressive but restrained eyes, contemporary or gently vintage clothing in fixed colours. NOT live-action, NOT a photograph, NOT 3D CGI, NOT western cartoon, NOT chibi.

## Palette
Honeyed afternoon light through gauze curtains, warm cream and porcelain white, muted sage green, dusty rose, deep teal shadow, soft gold highlights

## Camera
Static locked-off camera, no movement while a line is spoken. When one of them speaks: a clean CUT to an over-the-shoulder medium close-up from behind the listener, framed tight on the SPEAKING face, the listener a soft-focus edge in the foreground. When both speak or the beat needs air: the wide two-shot at eye level with both in frame. Occasional medium close-up on the speaker. No pans, no dollies, no zooms, no scene transitions.

## Direction
This is a two-hander. Two people sit close together in one calm, beautiful room and talk to each other - the SAME room, the same table and the same light for the entire film. They never move to another place and the room never changes. Everything said is said out loud by one of them to the other, in their own voice. There is no narrator and nobody describes the scene. Build the exchange as a hook that makes the viewer stop, then two or three numbered rules, then the younger one pushing back with the doubt the audience is actually feeling, then one sharp aphorism worth repeating, then a warm resolution. Give the listener something to do while the other speaks: a teacup turned, a hand stilled, an eye-line that drops and comes back. The camera cuts to whoever is speaking: when one of them talks, the shot is an over-the-shoulder close-up framed on the speaker with the listener in soft focus in the foreground; when both speak, or a beat needs air, hold the wide two-shot. Cut between angles, never pan, and keep the same axis so their left and right positions never flip. Let the warmth be earned by the truth of the advice, never by sentimentality.

## Voices
No narrator and no voice-over. The cast speak on screen, to each other,
and every word in the film comes out of one of their mouths.

## Script
- *The Final Demand* — **Daehyun:** "Sign the papers, Sora. You were never enough for me." **Sora:** "Is that what you truly think?" **Daehyun:** "I know it. Beg all you want, it changes nothing."
- *Surprising Acceptance* — **Sora:** "Give me the pen." **Daehyun:** "No hesitation? You aren't even going to cry?" **Sora:** "Crying is for people who have something to lose."
- *Laying Down Rules* — **Sora:** "Marriage was a transaction, Daehyun. Read these." **Daehyun:** "What is this nonsense?" **Sora:** "The actual state of your family business."
- *Exposing Liabilities* — **Sora:** "Your main accounts are completely drained." **Daehyun:** "That's impossible! We're record profitable this year!" **Sora:** "You inherit only hidden liabilities, my dear."
- *Smug Resistance* — **Daehyun:** "These are fake! My family empire is far too strong!" **Sora:** "Arrogance always blinds the fool." **Daehyun:** "You think a few numbers change who holds power?"
- *Silent Power* — **Sora:** "True power moves in silence." **Daehyun:** "Stop talking in riddles!" **Sora:** "You lost everything hours ago, Daehyun."
- *The Asset Transfer* — **Daehyun:** "What are you talking about?" **Sora:** "Your father transferred the entire profitable portfolio into my private trust." **Daehyun:** "That's impossible!"
- *Settling The Check* — **Sora:** "You inherit only the corporate debt." **Daehyun:** "You ruined me..." **Sora:** "And the dinner bill is yours, too."
- *Quiet Departure* — **Daehyun:** "You can't just leave me with nothing!" **Sora:** "Good luck with your liabilities, Daehyun."

## Never
no narrator and no voice-over of any kind, no on-screen text, subtitles, captions, watermarks or UI, no live-action or photographic realism, no 3D CGI sheen, no glitch, no motion blur, no exaggerated or comedic expressions, no shouting matches, no explicit content, no cynicism, no graphic conflict

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
**sora** - Same Sora throughout - Cinematic digital manhwa character, soft 3D cel-shaded semi-realistic rendering, age twenty-eight, slender build, pale skin, delicate defined facial structure, dark eyes with cold gaze, sleek straight black bob hair. Wears a minimalist black silk dress with high neckline and delicate silver necklace. NOT live-action, NOT a photograph, NOT 3D CGI, NOT western cartoon, NOT chibi.
**daehyun** - Same Daehyun throughout - Cinematic digital manhwa character, soft 3D cel-shaded semi-realistic rendering, age thirty, broad-shouldered build, fair skin, sharp defined facial structure, arrogant dark eyes, slicked-back jet-black hair. Wears a tailored navy blue designer double-breasted suit with a crisp white dress shirt and silk tie. NOT live-action, NOT a photograph, NOT 3D CGI, NOT western cartoon, NOT chibi.

## What happens next
1. Generate the sheets AND the place plate from `character_sheets.txt`
   (Whisk or any image tool), and save each one into `character_refs/`
   under the name it gives.
2. Do not upload them as Flow Characters. Stage 2 uploads each sheet as a
   plain image and mentions it with `@Name`, which is what holds the cast
   together; a Flow Character drifts between clips. The place plate is
   mentioned the same way.
3. Stage 1: `npm run agent:prompt -- stories/she_let_his_mistress_win/she_let_his_mistress_win_story.json`
4. Then the usual stages 2-4.
