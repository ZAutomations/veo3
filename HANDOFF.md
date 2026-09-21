# Veo3 Relationship-Dialogue — handoff

_2026-09-16. Written so another model can pick this up cold, without the
conversation that produced it._

**Project:** `D:\MyFinalAutomations\Veo3` — a Node + Python tool that writes
short relationship-dialogue videos and drives Google Flow's Agent Mode to
generate the clips. Windows. Node ≥18. Python + tkinter GUI. No git repo.

---

## 1. What the creator wants

Their words, verbatim:

> "in agent mode, and in relationship dialogue preset … I want to have consistent
> characters throughout the full video, and also the couples / both characters'
> conversation should look real throughout the full video. For example a couple
> talking about some issue while sitting on bed, or sitting on desk, or standing
> in room etc. That should be consistent — not change in any scene — continuity
> look."

> "I am attaching a model character picture, its style is 2.5D semi-realistic,
> and I want my characters to look like this style."

> "A stunning 20-year-old Indian girl, 2.5D semi-realistic anime illustration,
> high-end digital painting. Large luminous brown eyes, soft blushing cheeks,
> sweet shy smile. Long wavy dark brown hair styled in a half-updo with loose
> strands framing her face. Wearing a traditional off-white saree with blue
> striped border and an embroidered mustard-yellow blouse. Intricate dark brown
> henna mehndi on her hands and forearm, silver oxidized jhumka earrings,
> delicate necklace, glass bangles. Warm golden hour sunlight, outdoor courtyard
> with soft blurred fairy lights, ultra-detailed textures, 8K resolution,
> vertical 9:16"

Broken into requirements:

| # | Requirement | State |
|---|---|---|
| A | Every video has the same face(s) | **half done** — one face fixed, the second not |
| B | The two people read as a real conversation, not two strangers cut together | **partly done** — partly outside our control |
| C | One place per film, no jumping between scenes | **done for one hardcoded room only** — cannot pick bed / desk / room |
| D | The 2.5D semi-realistic look from the reference image | **done in the code; the GUI is pointed at the wrong preset** |

---

## 2. How the pipeline works

Four stages. Stages 1 and 3 are pure text; stage 2 is Puppeteer driving Flow.

1. **`write_story.js`** — two model calls.
   - Call 1 → cast + outline (`castPrompt`, `write_story.js:498`).
   - Call 2 → the scenes, in batches.
   - Writes `<slug>_story.json`, `character_sheets.txt`, `style_bible.md` into
     `stories/<slug>/`.
   - Invoked by the GUI as
     `node write_story.js --title … --preset … --detail-file logs/_gen_detail.txt`
     (`veo3_gui.py:1625`).
2. **`story_to_agent_prompt.js`** — story JSON → `agent_prompt.txt`. Reads
   `character_descriptions` (the CAST block) and `character_references` (the
   sheet paths). `npm run agent:prompt -- <story.json>`.
3. **`agent_mode.js`** — stage 2. Uploads the reference images into Flow, types
   the prompt, attaches each sheet to a clip. `--refs <story.json>` reads
   `character_references` and resolves each one through `mention_target.js`.
4. **`agent_download.js`** / **`join_clips.js`** — fetch the clips, join them.

### Veo 3.1 limits that shape everything

- **8 seconds maximum** per clip.
- **At most 3 reference images** per clip. A 2-person cast plus a place plate is
  exactly at the ceiling.

### The single most important fact about drift

Flow's `@` mention picker offers **two different kinds of asset under the same
name**:

- a raw **Image** tile — the reference pixels; **this holds**;
- a saved Flow **Character** — re-instantiated per clip; **this drifts**.

`mention_target.js` classifies the tiles (`tileKind`, `chooseMentionTile`) and
must always pick the Image. If a cast is drifting despite a reference being
attached, check this first.

---

## 3. What is already built

### The standing cast

`house_cast.json` (project root) holds the faces used in every video.
`house_refs/` holds their sheets. `write_story.js` reads it via `loadHouseCast`
(`:369`) and applies it via `houseCastApplies` (`:405`).

Current contents — **one person**:

```json
{ "name": "Meera", "type": "human",
  "reference": "./house_refs/Meera.png",
  "description": "Same Meera throughout - 20, Indian, …",   // 55-75 words
  "sheet_prompt": "…" }
```

`house_refs/Meera.png` is the image the creator supplied (780x1280). It is the
target; the `sheet_prompt` only exists to make extra angles of her.

`name` is a **label only** — it keys the story JSON and decides the `@`mention.
Renaming her does not change the face.

**Applicability.** It applies only to presets whose `cast_types` is exactly
`["human"]` and whose `cast` is not `"optional"` — i.e. `relationship-dialogue`
and `relationship-dialogue-real`, and nothing else. Every other preset is
byte-identical to before (asserted in `test_house_cast.js`).

**Behaviour in call 1** (`castPrompt`, `write_story.js:498`):

- the standing faces are handed over by name and description, and the model is
  told not to rename, redesign or re-describe them;
- the model **is** told to design whoever else the story needs — a conversation
  cannot be held with nobody;
- `main()` merges them: `const cast = [...houseCast, ...designed]`
  (`write_story.js:1504`), dropping any echo of a standing name so the same
  person is never described twice;
- `buildStory` writes `./house_refs/<Name>.png` into `character_references`.

**Escape hatches:** `--no-house-cast` (design a fresh cast for one story) and
`--cast my.json` (a different cast file). A `--cast` file that cannot be read,
or that names nobody, exits 1 rather than silently falling back.

**The missing-sheet trap.** Stage 2 skips a reference it cannot open **without
failing**. So a sheet that was never drawn becomes a face that drifts with no
error anywhere. `write_story.js` writes
`NOT MADE YET: ./house_refs/…` into `character_sheets.txt` to catch it.

### The 2.5D look

`styles.json` → `relationship-dialogue`:

- **style**: `2.5D semi-realistic anime illustration, high-end digital painting,
  8K resolution, ultra-detailed textures, delicate soft lighting, atmospheric
  ambient light, shallow depth of field, 35mm lens, smooth subtle facial
  movement, high aesthetic detail`
- **cast_idiom**: the same medium, and rules out by name: flat cel-shaded
  cartoon, chibi, super-deformed, live-action, photograph, 3D CGI.
- **avoid**: no flat cel-shaded look, no chibi proportions.
- **setting_prompt**: the place-plate prompt, same medium.

`relationship-dialogue-real` is the **photoreal twin** — its style string is
`Photorealistic 4K cinematic film, 35mm anamorphic lens quality, …`. Same room,
same rules, different medium. It is a separate preset, not a flag.

### The fixed room

The preset's `setting` field locks one room for the whole film; every clip
carries that text verbatim. It is currently a **tearoom corner** (round
marble-topped table, gauze curtains, white orchids, folded letter, warm
late-afternoon light from the left). Same string in both dialogue presets.

### Reference resolution

`mention_target.js:157` `resolveCharacterRef(refs, name, storyDir)`:

1. the declared path, relative to the story folder;
2. the declared path, relative to the **project root** — this is what makes
   `./house_refs/Meera.png` work from inside a story folder;
3. the declared path with a different image extension;
4. a basename search over `[story]/character_refs` then `[project]/house_refs`,
   exact basename first, then prefix, case-insensitive.

A story's own sheet always beats the shared folder.

### Tests

```
npm run check          # 9 suites, 628 checks, all passing
npm run test:house     # test_house_cast.js alone (125 checks)
```

`test_house_cast.js` is the suite for this feature. Its final section asserts
that the hand-kept `MASTER_PROMPT_relationship.txt` still agrees with
`house_cast.json` and `styles.json`.

---

## 4. WHERE IT IS STUCK — the five things to fix

### 4.1 The GUI is pointed at the photoreal preset

`gui_settings.json:21`:

```json
"gen_preset": "relationship-dialogue-real",
```

That is the **photoreal** twin. The creator wants the **drawn 2.5D** look, which
is `relationship-dialogue`.

The GUI restores its preset from this saved value (`veo3_gui.py:614`), which
overrides the factory default at `veo3_gui.py:124` (already changed to
`relationship-dialogue`, but irrelevant while the saved value exists).

**Fix:** set `gen_preset` to `"relationship-dialogue"` — in the GUI dropdown or
in the file. One line. This is the highest-value fix in the list.

### 4.2 Only one of the two people is fixed

Requirement A is half met. The creator wants **a couple** — both faces stable
across videos. The standing cast has one person, so the second is designed fresh
by every story and his face changes video to video. The drift did not go away,
it moved to the other chair.

**Fix:** obtain a second reference image from the creator and add a second entry
to `house_cast.json`, same shape as the first, with its own `reference`,
`description` (55–75 words, starting `Same <Name> throughout - `) and
`sheet_prompt`. No code change is needed — the code already reads as many
characters as the file names.

**Ceiling:** 2 people + 1 place plate = 3 reference images = the Veo 3.1 maximum.
A third character would break the mention.

### 4.3 The place is hardcoded to one room

Requirement C is half met. The preset fixes **one** room and the whole film stays
in it. What the creator described — a couple on a bed, at a desk, standing in a
room, chosen per video — is **not supported**. The room lives in `styles.json`
under the preset, not in the story.

Two ways forward:

1. **Per-story place (the real fix).** Let the story JSON carry `place_name` /
   `place_description` / `place_prompt` and have the dialogue preset's locked
   `setting` yield when they are present. The plumbing already exists —
   `write_story.js` writes those three fields for presets that have **no**
   `setting`, and `story_to_agent_prompt.js` already emits a `place` section and
   a `@<PlaceName>` mention from them. It is the dialogue preset's locked
   `setting` that overrides it. Grep for `p.setting` in `write_story.js` — the
   step numbering in `castPrompt` also branches on it.
2. **One preset per room.** `relationship-dialogue-bedroom`,
   `relationship-dialogue-office`, each with its own `setting`. No code change at
   all; each still gets the standing cast. Crude, but it ships today.

### 4.4 Continuity across clips is not fully ours to control

Each 8-second clip is generated independently by Veo. What holds a face is the
reference image **plus** the identity text repeated into every clip's CAST block
— both of which are wired up. What is **not** guaranteed:

- that Veo actually binds the reference at all (the `@`mention must land on the
  right picker tile — see §2);
- wardrobe, hairstyle and lighting staying identical between cuts;
- the two people looking like they share a room rather than being composited.

The preset's `direction` and `blocking` already pin the spatial layout: the
character laying down the rules on screen-LEFT facing right, the listener on
screen-RIGHT facing left, neither ever moving, the camera never crossing the
axis. That is the mechanism for requirement C. It is a prompt-level constraint,
not a guarantee.

### 4.5 `MASTER_PROMPT_relationship.txt` is half-updated

This is the **manual ChatGPT path** — a hand-kept copy of the cast and the look,
for writing a story by hand instead of running `write_story.js`.

- Its cast section **has been rewritten** for one fixed face plus one designed
  per story.
- Its **example JSON further down still contains the old invented character**
  (`"savitri"`) and still points `character_references` at
  `./house_refs/Savitri.png` — a file that does not exist and should not.

A hand-written story copied from that example would carry a dead character.
Either finish the example or delete the whole file if the manual path is unused.

---

## 5. Traps already hit — do not repeat these

1. **Do not invent characters.** An earlier attempt added a second character to
   `house_cast.json` that the creator never asked for, described or supplied. It
   was removed. The cast is the creator's; it is defined by the reference images
   they hand over, never by a name or a personality we make up.
2. **Do not invent names for their characters.** The one supplied image is keyed
   as `"Meera"` only because the format needs a key. That name is ours, not
   theirs, and they were not happy about it. If they give a name, use it.
3. **Do not apply the standing cast to other presets.** A human-only cast dropped
   into an animal film or a what-if explainer is worse than no feature. Keep the
   `cast_types`/`cast` gate.
4. **Never upload a Flow Character.** Plain Image tiles only.
5. **Do not edit files outside the ask.** An earlier session rewrote README
   sections, added warnings to `story_to_agent_prompt.js` and started a test
   refactor that nobody requested. The creator's reaction was severe and
   repeated. Touch only what the requirement needs.
6. **The 3-reference ceiling is real.** Adding a third cast member silently
   breaks the mention binding.

---

## 6. What has NOT been verified

**No video was generated end-to-end in this session.** Everything above is
verified at the level of prompts, story JSON and file resolution — by 628
automated checks — and **not** by producing clips in Flow and looking at them.

The claim that faces stay consistent across clips is a design argument, not an
observation. It needs one real film to confirm. **Do this first** — it will
re-rank everything in §4.

---

## 7. Suggested order of work

1. Point the GUI at `relationship-dialogue` (§4.1). One line.
2. **Generate one complete film and watch it.** Until this exists, every other
   item is guesswork.
3. Get the second reference image and fix the couple (§4.2).
4. Implement per-story place (§4.3, option 1) or ship presets per room
   (option 2).
5. Finish or delete `MASTER_PROMPT_relationship.txt` (§4.5).

---

## 8. File map

| File | What it is |
|---|---|
| `house_cast.json` | the standing cast — the faces used in every video |
| `house_refs/` | their reference sheets, made once, used by every story |
| `styles.json` | the presets. `relationship-dialogue` = 2.5D drawn, `-real` = photoreal |
| `write_story.js` | call 1 = cast + outline; call 2 = scenes. `castPrompt:498`, `loadHouseCast:369`, `houseCastApplies:405`, cast merge `:1504` |
| `story_to_agent_prompt.js` | story JSON → Agent Mode prompt (`CAST` block, mentions) |
| `agent_mode.js` | stage 2 — uploads the images, `@`-mentions them |
| `mention_target.js` | finds a sheet on disk (`:157`); picks the Image tile |
| `agent_download.js`, `join_clips.js` | fetch and join the clips |
| `veo3_gui.py` | the GUI. `gui_settings.json` holds the live settings |
| `test_house_cast.js` | the tests for all of the above |
| `MASTER_PROMPT_relationship.txt` | the manual ChatGPT path — **half-updated** |
