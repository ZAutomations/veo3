# Master prompt - Relationship Dialogue (Realistic)

Ye wohi prompt hai jo hamara tool Gemini ko bhejta hai, is preset ke liye. Ismein
kuch bhi naya likha nahi gaya - sirf do cheezein jori gayi hain: tool do calls karta
hai (pehle cast + outline, phir clips) aur yahan dono ek hi message mein hain, aur
runtime par jo cheezein tool khud bharta hai (title, cast, beats) unki jagah ye
hidayat hai ke PART 1 mein jo aapne likha wohi use karo.

**Kaise use karein:** neeche diye gaye cut-off ke baad ka poora text copy karein,
Gemini (AI Studio) mein paste karein, aur sab se aakhir mein apna video link laga
dein (`<PASTE THE VIDEO LINK HERE>` ki jagah). Gemini ek hi jawab mein dono JSON
dega - pehla title/cast/place/outline, doosra scenes. Pehle JSON mein video ka
apna title bhi hoga: story aur uska folder usi naam se banega, is liye aapko title
khud likhne ki zaroorat nahi.

Agar Gemini itna lamba text ek saath na le, to usi chat mein do hisson mein
bhej dein: pehle `PART 1` se `PART 1` ke JSON tak, phir `PART 2` se aakhir tak.

NOTE: video ka format (16:9 ya 9:16) is prompt ka hissa nahi - woh tool render ke
waqt lagata hai. Prompt mein 8 second ka zikr sirf isliye hai ke har line 8 second
mein bolne layak rahe.

===================== YAHAN SE NEECHE COPY KAREIN =====================

ONE JOB, IN TWO PARTS. PART 1 designs the film: the cast, the one place it happens
in, and the beat-by-beat outline. PART 2 writes the actual clips, using exactly what
PART 1 decided. Return BOTH JSON objects, in order, and nothing else.

========================================================================
PART 1 - cast, place and outline
========================================================================
You are writing the character bible for a Relationship Dialogue (Realistic) video.

TITLE: the video's own title, word for word as it is written on the video. Drop any emoji, hashtags, channel name or " #shorts" from it, and keep it to 8 words or fewer. This becomes the story's name, so it has to read as a title.
THE VIDEO TO COVER: the link is at the end of this message. Watch it. Cover ITS facts, in ITS order, rewritten in your own words as a film in this genre - the facts are the ground truth, the wording is entirely yours.
TOTAL LENGTH: decide the clip count from the video's own length - roughly one beat per 8 seconds of video, minimum 6 clips, maximum 20. Each clip is 8 seconds.

LOOK: Photorealistic 4K cinematic film, 35mm anamorphic lens quality, natural shallow depth of field, real-world lighting balance, physical micro-textures in skin, hair and fabric, restrained natural colour grading, premium streaming drama quality
CAST TEMPLATE (every character description must follow this shape): Photorealistic adult human with exact realistic adult proportions, natural skin texture with visible pores and fine hair, small natural asymmetries in the face, real fabric clothing in fixed colours, un-styled contemporary or gently vintage hair, an unposed and un-retouched face. NOT illustration, NOT manhwa or webtoon, NOT cartoon, NOT anime, NOT 3D CGI, NOT a painting, NOT a photograph of a known person.
PALETTE: Honeyed afternoon light through gauze curtains, warm cream and porcelain white, muted sage green, dusty rose, deep teal shadow, soft gold highlights
CAMERA: Static locked-off camera, no movement while a line is spoken. When one of them speaks: a clean CUT to an over-the-shoulder medium close-up from behind the listener, framed tight on the SPEAKING face, the listener a soft-focus edge in the foreground. When both speak or the beat needs air: the wide two-shot at eye level with both in frame. Occasional medium close-up on the speaker. No pans, no dollies, no zooms, no scene transitions.
BLOCKING (FIXED - never changes for the whole film): SPATIAL BLOCKING (LOCKED): the two of them are anchored to the room, not to the frame. Each one stays on the exact piece of furniture they are first seen on - the one on the bed is on that bed, the one on the couch is on that couch, the one in the chair is in that chair - in every clip of the film. Nobody moves once they are placed: nobody stands up, sits down, lies down, walks across the room or drifts to another part of it, unless a clip's own words say they do. The character laying down the rules holds the screen-LEFT position in the wide shot and the character hearing them holds screen-RIGHT, and the camera never crosses the axis between the two of them - so when a cutaway goes over one shoulder the camera has moved and the frame side has swapped, but that is the camera, not them: the furniture they are on never changes. The one who was on the left in clip 1 is on the left in every clip. Neither of them changes clothes, hairstyle or jewellery between clips - the face and the wardrobe in clip 1 are the face and the wardrobe in the last.
DIRECTION: This is a two-hander. Two people are together in one calm room and talk to each other - the SAME room and the same light for the entire film. They never move to another place and the room never changes. Nothing about either of them changes either: the same face, the same hairstyle and the same clothes from the first clip to the last. Everything said is said out loud by one of them to the other, in their own voice. There is no narrator and nobody describes the scene. Build the exchange as a hook that makes the viewer stop, then two or three numbered rules, then the younger one pushing back with the doubt the audience is actually feeling, then one sharp aphorism worth repeating, then a warm resolution. Give the listener something to do while the other speaks: a hand stilled, a shoulder turned away, an eye-line that drops and comes back. The camera cuts to whoever is speaking: when one of them talks, the shot is an over-the-shoulder close-up framed on the speaker with the listener in soft focus in the foreground; when both speak, or a beat needs air, hold the wide two-shot. Cut between angles, never pan, and keep the same axis so their left and right positions never flip. Let the warmth be earned by the truth of the advice, never by sentimentality.
SPEAKING: two people talk to each other on screen, in their own voices. There is no narrator, no voice-over, and nobody describes the scene out loud.
POLICY-SAFE (hard rule): never name or depict a real living or historical person, and never invoke their likeness - describe the ROLE instead ("the inventor", "the nurse", "the soldier"). Keep emotion restrained: no weeping or sobbing, no blood, gore, wounds or injuries, no weapon aimed at a person, no hate symbols, no real brand logos or trademarks. The video model refuses all of these.
NEVER: no narrator and no voice-over of any kind, no on-screen text, subtitles, captions, watermarks or UI, no illustration, no manhwa or webtoon rendering, no cartoon, no anime, no 3D CGI sheen, no painted or drawn look, no glitch, no motion blur, no exaggerated or comedic expressions, no shouting matches, no explicit content, no cynicism, no graphic conflict

TASK
1. Write a one-sentence "description" of the whole video (max 30 words). It must
   describe WHAT HAPPENS, never what it looks like - the look is already fixed above.
2. Write a one-sentence "moral" (max 25 words).
3. Write "target_audience" (max 12 words).
4. Design the cast. Use 2 or 3 characters at most; a small cast stays
   consistent. This genre is about people, so there is always a cast - never
   return an empty list.
   For EACH character give:
     "name"        - one word, capitalised, no spaces (e.g. "Mira")
     "type"        - one of: human
     "description" - 55 to 75 words, STARTING with "Same <name> throughout - "
                     and following the CAST TEMPLATE exactly, plus the rules for
                     its type:
                       animal - the exact breed or mix, build and size, base fur
                         colour, secondary coat markings, eye colour, and at least
                         TWO unchanging physical markers (a notched ear tip, a
                         chest patch, one white paw, an old scar). Those markers
                         are what hold the animal together across cuts - without
                         them the model renders a different animal in every clip.
                       human  - age, build, hair, face and skin tone, in one fixed
                         multi-layered wardrobe that never changes.
                     End with the NEVER guard restated as "NOT ..." so the model
                     cannot drift. Every character must be described in the SAME
                     medium.
     "sheet_prompt" - a 40 to 60 word prompt for an image generator to make that
                     character's reference sheet as ONE image containing the SAME
                     individual repeated from SEVERAL ANGLES: a full-body front
                     view, a full-body three-quarter view, a full-body side profile,
                     and a head-and-shoulders close-up of the face. Identical
                     outfit, hair and lighting in every view, evenly spaced in a row
                     on a plain neutral grey studio background. Say that it is one
                     identical individual in every view, and that there is no text,
                     no labels and no watermark. Include the medium.
                       animal - the breed and BOTH unchanging physical markers must
                         stay readable in every view. Every physical marker must be visible
                         in it, and the close-up is of the head, so both the face
                         and the coat markings are covered.
                       human  - the close-up is what locks the face; the full-body
                         views lock the wardrobe and the build.
                     Every sheet in the cast must end with this exact background
                     phrase, word for word, with nothing added to it:
                     "plain neutral grey studio background"
                     Do not vary it per character - not "plain background", not
                     "plain gray background with a soft vignette". Sheets that
                     disagree on the background read as a different production.

5. Choose ONE place for this whole film, and describe it once. Every clip
   happens here and the place NEVER changes. It can be anywhere - a park bench,
   a kitchen table, a hotel bed, a garden, a stairwell, a car. What it cannot be
   is a different place from one clip to the next.
     - Pick somewhere that suits the story, then commit to it.
     - Give it the fixed details a camera keeps coming back to: the furniture or
       landmarks, what is on the walls or the ground, where the light comes from,
       and the time of day. Those details are what hold it still.
     - Say what must NEVER change: no redecorating, no moving to another place,
       no different time of day, nothing new appearing.
     - "place_name"        - ONE word, no spaces: "Tearoom", "Bedroom", "Kitchen",
       "Globe", "Courtyard". It becomes the image's asset name and the @mention
       the agent types, and a space in it makes that mention ambiguous - so keep
       it to a single word even if the place itself is described in detail below.
     - "place_description" - 45 to 70 words describing the fixed place ON ITS OWN,
       with nobody in it. This is repeated into every clip, so it must read
       identically every time.
     - "place_prompt"      - a 40 to 60 word prompt for an image generator to make
       that place as ONE image: the EMPTY place, no people and no animals, a
       straight-on wide view, evenly lit, the whole space readable. Same medium as
       the character sheets. Say that it is empty of people, and that there is no
        text, no labels and no watermark. Include the medium.
6. Fix WHERE THE TWO OF THEM ARE, and write it once for the whole
   film. This is a conversation, not a montage: two people talk, and they talk
   from the same two spots in the same room from the first clip to the last.
   Nothing looks worse on screen than a couple who are sitting on the bed in one
   clip and standing at the window in the next, or who trade sides between clips
   for no reason.
     - Place each of them EXACTLY, and anchor them to the FURNITURE, not to the
       frame: on what (the bed, a chair, the floor, their own feet), with which
       part of it (the edge of the bed, the left-hand chair at the table), which
       way they face, and what their hands and body are doing. Furniture does not
       move when the camera cuts; a screen side does. For example: "Godwin sits
       on the edge of the bed, forearms on his knees, facing the couch. Tari sits
       on the couch opposite him with an open book in her lap, facing the bed."
     - If you name a frame side, name the anchor first and the side second, and
       say plainly that the cutaway shot may reverse the camera - so the side is
       what the wide shot shows, and the bed is where they are whatever the shot.
     - Choose spots the whole conversation can be held from, so that nobody has
       to move: sitting, lying or standing, but the SAME spot in every clip.
     - Close enough that both fit in one frame, and neither of them ever out of
       shot.
     - "blocking" - 25 to 45 words, present tense, describing ONLY where they
       are and what they do with their bodies. It is repeated WORD FOR WORD into
       every clip, so write a fixed state, never a moment and never a movement.
       Name each person against the thing they are on, so the statement survives
       a cut from the wide shot to an over-the-shoulder and back.
     - Write no movement into it at all: nobody stands up, lies down, crosses
       the room, turns away or swaps sides. The only exception is a beat the
       story itself is about - if the script calls for one of them to get up and
       leave, that clip says so in its own words, and every clip after it keeps
       them wherever they ended up.
7. Write an "outline": exactly as many entries as there are clips.
     "title" - 2 to 5 words
     "beat"  - one sentence: what happens in this clip and what changes.
   The beats must form ONE story with a turn and an ending, not a list
   of nice moments.
   WHAT A BEAT HAS TO BE - this is where these scripts go flat, so it is a rule
   and not a preference:
     - Every beat delivers ONE NEW surprise the viewer did not have before. Ask
       of each beat: what does the viewer learn HERE that they did not know one
       clip ago? If the answer is nothing, or the same thing again in bigger
       words, rewrite the beat.
     - It has to be CONCRETE. A number, a comparison the viewer can picture, or
       something that looks physically impossible. Never a general claim.
     - NO BEAT MAY BE THE PREVIOUS BEAT MADE BIGGER. "It reaches the street" ->
       "it reaches the city" -> "it reaches the country" -> "it reaches the
       world" is ONE beat stretched over four clips. That is the single most
       common way a script dies, and it is banned.
     - No tour beats (a list of places, a list of examples, a list of dates), no
       "an expert explains" beats, and no beat that only summarises what the
       viewer has already seen.
     - The beats ESCALATE: each one is stranger or bigger than the last, and the
       beat before the final one is the biggest reveal of the film.
     - Never end on "scientists still do not know", "remains a mystery" or
       "is still studied". The film ends on the strongest thing the viewer can
       be told, not on the fact that nobody knows it.
     - A viewer who half-watches has to be pulled back by every single beat.
   Draw on these shapes that suit this look:
     - a provocative opening line, then numbered rules, then the younger one pushes back, then a sharp aphorism, then a warm resolution
     - an older woman tells her granddaughter the thing nobody told her in time
     - two people disagree about the same relationship and both are partly right
     - a hard rule delivered kindly over tea, and the doubt it has to survive

   This film is a CONVERSATION, not a montage. Every beat is something one of the
   two says to the other. Write each beat as the turn it turns
   on - the hook that stops the viewer, a rule, the doubt that pushes back, the
   aphorism worth repeating, the resolution - not as a description of what is
   seen. A beat that is only a picture has nothing for anyone to say.
   They stay where the BLOCKING above puts them. A beat is a turn in the
   conversation, never a reason to move them to a different part of the room -
   if a beat does move somebody, it has to be the story's own turn (they get up
   and leave), and there can only be one such beat in the film.

Then return this JSON, and go on to PART 2:
{"title":"","description":"","moral":"","target_audience":"","place_name":"","place_description":"","place_prompt":"","blocking":"","characters":[{"name":"","type":"","description":"","sheet_prompt":""}],"outline":[{"title":"","beat":""}]}

========================================================================
PART 2 - the clips
========================================================================
Take the JSON you returned in PART 1 as given: its characters are the cast, its
blocking is where they are, its outline is the beats. Return the second JSON now.

You are writing the clips of the film whose cast, place and outline YOU designed in PART 1 above. Use exactly that cast, that place and those beats - do not redesign, rename or add anyone.

TITLE: the title YOU chose in PART 1.
STORY: the story YOU designed in PART 1 - its place, its people and its beats, unchanged.
LOOK: Photorealistic 4K cinematic film, 35mm anamorphic lens quality, natural shallow depth of field, real-world lighting balance, physical micro-textures in skin, hair and fabric, restrained natural colour grading, premium streaming drama quality
CAST TEMPLATE (every character description must follow this shape): Photorealistic adult human with exact realistic adult proportions, natural skin texture with visible pores and fine hair, small natural asymmetries in the face, real fabric clothing in fixed colours, un-styled contemporary or gently vintage hair, an unposed and un-retouched face. NOT illustration, NOT manhwa or webtoon, NOT cartoon, NOT anime, NOT 3D CGI, NOT a painting, NOT a photograph of a known person.
PALETTE: Honeyed afternoon light through gauze curtains, warm cream and porcelain white, muted sage green, dusty rose, deep teal shadow, soft gold highlights
CAMERA: Static locked-off camera, no movement while a line is spoken. When one of them speaks: a clean CUT to an over-the-shoulder medium close-up from behind the listener, framed tight on the SPEAKING face, the listener a soft-focus edge in the foreground. When both speak or the beat needs air: the wide two-shot at eye level with both in frame. Occasional medium close-up on the speaker. No pans, no dollies, no zooms, no scene transitions.
BLOCKING (FIXED - never changes for the whole film): SPATIAL BLOCKING (LOCKED): the two of them are anchored to the room, not to the frame. Each one stays on the exact piece of furniture they are first seen on - the one on the bed is on that bed, the one on the couch is on that couch, the one in the chair is in that chair - in every clip of the film. Nobody moves once they are placed: nobody stands up, sits down, lies down, walks across the room or drifts to another part of it, unless a clip's own words say they do. The character laying down the rules holds the screen-LEFT position in the wide shot and the character hearing them holds screen-RIGHT, and the camera never crosses the axis between the two of them - so when a cutaway goes over one shoulder the camera has moved and the frame side has swapped, but that is the camera, not them: the furniture they are on never changes. The one who was on the left in clip 1 is on the left in every clip. Neither of them changes clothes, hairstyle or jewellery between clips - the face and the wardrobe in clip 1 are the face and the wardrobe in the last.
DIRECTION: This is a two-hander. Two people are together in one calm room and talk to each other - the SAME room and the same light for the entire film. They never move to another place and the room never changes. Nothing about either of them changes either: the same face, the same hairstyle and the same clothes from the first clip to the last. Everything said is said out loud by one of them to the other, in their own voice. There is no narrator and nobody describes the scene. Build the exchange as a hook that makes the viewer stop, then two or three numbered rules, then the younger one pushing back with the doubt the audience is actually feeling, then one sharp aphorism worth repeating, then a warm resolution. Give the listener something to do while the other speaks: a hand stilled, a shoulder turned away, an eye-line that drops and comes back. The camera cuts to whoever is speaking: when one of them talks, the shot is an over-the-shoulder close-up framed on the speaker with the listener in soft focus in the foreground; when both speak, or a beat needs air, hold the wide two-shot. Cut between angles, never pan, and keep the same axis so their left and right positions never flip. Let the warmth be earned by the truth of the advice, never by sentimentality.
SPEAKING: two people talk to each other on screen, in their own voices. There is no narrator, no voice-over, and nobody describes the scene out loud.
POLICY-SAFE (hard rule): never name or depict a real living or historical person, and never invoke their likeness - describe the ROLE instead ("the inventor", "the nurse", "the soldier"). Keep emotion restrained: no weeping or sobbing, no blood, gore, wounds or injuries, no weapon aimed at a person, no hate symbols, no real brand logos or trademarks. The video model refuses all of these.
NEVER: no narrator and no voice-over of any kind, no on-screen text, subtitles, captions, watermarks or UI, no illustration, no manhwa or webtoon rendering, no cartoon, no anime, no 3D CGI sheen, no painted or drawn look, no glitch, no motion blur, no exaggerated or comedic expressions, no shouting matches, no explicit content, no cynicism, no graphic conflict

THE STAGE POSITIONS FOR THE WHOLE FILM - do not change them:
  (the blocking YOU wrote in PART 1 - repeat it word for word in every clip)

HOW THIS FILM SPEAKS - the two of them talk, on screen, to each other:
  There is NO narrator and NO voice-over anywhere in this film. Every word spoken
  is spoken by one of the cast above, out loud, in the room, to the other one.
  So do not write a line of narration, and never put a description of the scene
  into a character's mouth - nobody says what the camera can already see.
  Write speech as people actually say it: contractions, short sentences, one
  cutting the other off. Every clip needs at least one exchange.

THE CAST - do not change, rename or redesign anyone:
  The cast is the "characters" array from PART 1. Each description is repeated
  WORD FOR WORD, and every "speaker" below must be one of those names.

THE BEATS FOR THESE CLIPS (one clip each, same order):
  The beats are the "outline" from PART 1: one clip per entry, in that order,
  with that entry's own title. Do not add, drop or reorder a beat.

For EACH clip above, in order, return:
  "scene_title"       - the beat's title
  "dialogue"          - the lines spoken in THIS clip, in the order they are said,
                        as an array of objects:
                          {"speaker": "<a cast name, spelled exactly as above>",
                           "line": "what they say, out loud"}
                        Two to four turns per clip, and at least one - this film is
                        a conversation, so a clip with nobody speaking has nothing
                        in it. Keep each line 12 words or fewer;
                        across ALL the lines in one clip the total is 24 words
                        or fewer, hard limit 30, because it all has to be
                        said aloud inside 8 seconds. Punctuate for speech, not
                        for prose. The last line of the clip should be worth hearing
                        on its own.
  "narrative_context" - 80 to 130 words describing what is ON SCREEN: the setting,
                        who is present, what they do, the light, the mood, and the
                        camera.
                        Describe the action and the emotion. Do NOT name a
                        rendering medium, a studio or an art style - the look is
                        already fixed above and naming it again is what makes
                        scenes drift apart.
                        The same goes for the cast's material words. Their
                        descriptions say "matte surface", "mannequin", "cel-shaded"
                        and so on because that is how the reference sheet must be
                        drawn - but inside the action, say what a person DOES and
                        what they WEAR. Write "the wind pulls at his coat", never
                        "the wind whips the fabric around his matte grey legs".
                        Repeating medium words in the action is what makes the
                        model render plastic where it should render a person.
  "characters"        - array of the cast names actually VISIBLE in this clip.
                        Only who is on screen. Never list an absent character:
                        naming someone who is not there invites the model to
                        insert them.

Write every clip of the outline from PART 1, in order - the JSON below is one "scenes" entry per clip. Return ONLY this JSON, no other text:
{"scenes":[{"scene_title":"","dialogue":[{"speaker":"","line":""}],"narrative_context":"","characters":[]}]}

========================================================================
THE VIDEO
========================================================================
Watch this video and cover its facts in the film you are writing:

<PASTE THE VIDEO LINK HERE>
