# Couples Argument Gone Wrong - style bible

Preset: **3D Render Story** (`genai-3d-render`, niche)
Format: Flow, 8s per clip, 7 clips, 56 seconds

## The look
3D rendered shot, video-game engine render aesthetic, cinematic depth of field, CGI skin texture on living subjects and plain CGI texture on objects and empty scenes, physically plausible materials, warm practical lighting, blurred soft background

## Cast template
3D rendered human with CGI skin texture, realistic adult proportions, natural expression, period or plain modern clothing in fixed colours, soft practical light on the face. Objects and empty scenes get a plain CGI texture, not skin. NOT cartoon, NOT anime, NOT flat 2D.

## Palette
Warm chandelier amber, cool city blue, casino green felt, restaurant cream, steely industrial grey, deep night blue, gold accent

## Camera
3D rendered cinematic staging: close-ups on hands and faces, over-the-shoulder shots, wide establishing interiors, shallow depth of field with the background thrown soft. One clear beat per shot. No 2D look.

## Direction
A biographical DOCUMENTARY about a real figure, narrated and authoritative, never sensational. Clip 1 grounds the subject immediately - birth date and place, and the era they were born into - and can open on their later fame and then cut back. Then: family background and early hardship; early signs of talent with one specific anecdote; at least one vivid ORIGIN MOMENT told as a mini-scene rather than stated as fact; a chronological career arc through struggle, breakthrough, recognition, peak, controversy and legacy; one central 'miracle period' framed as the turning point; personal life woven through, flaws included, so the subject is not one-dimensional; the larger historical forces of their time; what their work still means for ordinary people today; any real contradiction or moral complexity honestly; later years and death factually; and a closing legacy that ends on one or two open questions to the audience. One narrator, no on-screen text.

## Narrator
documentary narrator, informative and authoritative, clear and measured

## Never
no on-screen text, subtitles, captions, watermarks or UI, no cartoon, no anime, no flat 2D illustration, no plastic or waxy skin, no real brand logos, no invented facts, dates or figures

## Story shapes that suit this look
- later fame first, then the humble origin it came from
- a childhood talent, a rejection, then the breakthrough
- the miracle year that changed everything, then the cost of it
- the empire, the scandal, and the ambiguous verdict

## The place
**Apartment Living Room** - the one place this film happens in. Every clip is shot here and it
never changes: same furniture, same light, same time of day. The plate
is in `character_sheets.txt` - generate it, save it as
`character_refs/Apartment Living Room.jpg`, and mention it with `@Apartment Living Room` so the
model is handed the pixels rather than one more description of them.

Apartment Living Room features a modern luxury lounge at night with floor-to-ceiling windows showing cool urban city lights outside. Inside, warm ambient lighting illuminates a plush dark grey sofa, a sleek glass coffee table, polished hardwood flooring, and abstract wall art. The space maintains a fixed night atmosphere with warm lamp light mixing with cool window glow, never changing or redecorating.

## Cast
**maya** - Same Maya throughout - 3D rendered human with CGI skin texture, realistic adult proportions, natural expression, plain modern dark sweater and fitted trousers, soft practical light on her face. She is a woman in her late twenties with dark hair tied in a neat bun, expressing stern annoyance. NOT cartoon, NOT anime, NOT flat 2D, NOT plastic skin.
**leo** - Same Leo throughout - 3D rendered human with CGI skin texture, realistic adult proportions, natural expression, plain modern beige henley shirt and dark jeans, soft practical light on his face. He is a man in his early thirties with short brown hair, exhibiting a relaxed smirk. NOT cartoon, NOT anime, NOT flat 2D, NOT plastic skin.

## What happens next
1. Generate the sheets AND the place plate from `character_sheets.txt`
   (Whisk or any image tool), and save each one into `character_refs/`
   under the name it gives.
2. Do not upload them as Flow Characters. Stage 2 uploads each sheet as a
   plain image and mentions it with `@Name`, which is what holds the cast
   together; a Flow Character drifts between clips. The place plate is
   mentioned the same way.
3. Stage 1: `npm run agent:prompt -- stories/couples_argument_gone_wrong/couples_argument_gone_wrong_story.json`
4. Then the usual stages 2-4.
