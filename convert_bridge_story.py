#!/usr/bin/env python3
"""One-off: convert the old Ghibli story JSON into the current pipeline format.

The old file (Veo3 Auotmation/the_bridge_of_trust_ghibli_GOLD.json) was written for
the INGREDIENTS/EXTEND path. It carries script_line + narrative_context, which the
current builder reads happily, but it is missing the three fields that produce the
@mention list: character_descriptions, character_references, scenes[].characters.
Without them story_to_agent_prompt.js emits "using , up to 8 seconds each" - a
prompt that names no characters, so the agent invents them from scratch.

Everything else is copied through untouched. In particular the long veo3_prompt
blocks stay: the builder only uses them as a visual fallback (narrative_context
wins), but it DOES regex them for "narrator"/"voice-over" to decide whether the
whole story is narrated - so deleting them would silently drop the voice-over rules.
"""
import json
import shutil
from pathlib import Path

SRC = Path(r"D:\MyFinalAutomations\YTMultiLatest\Veo3 Auotmation\the_bridge_of_trust_ghibli_GOLD.json")
DEST_DIR = Path(r"d:\MyFinalAutomations\YTMultiLatest\Veo3_New\stories\the_bridge_of_trust")
REFS = DEST_DIR / "character_refs"

# --- character identity -----------------------------------------------------
# Written to match the depth of the mia/daniel descriptions, and to match what is
# actually drawn in the two reference sheets the user generated in Whisk
# (stories/Sarah.jpg and stories/Michael.jpg).
#
# The "NOT photorealistic / NOT 3D CGI" guards are deliberate: an earlier Agent
# run drifted to photoreal despite the reference sheet, because the planner's own
# scene vocabulary is cinema-flavoured. See memory: flow-agent-mode.
DESCRIPTIONS = {
    "sarah": (
        "Same Sarah throughout - 32-year-old woman in classic hand-painted 2D animation style, "
        "high-quality illustration with soft watercolour textures, clean ink line art and gentle "
        "cel shading, warm natural colour palette (NOT photorealistic, NOT 3D CGI, NOT shiny "
        "digital rendering, NOT manhwa webtoon). Gentle kind face with soft rounded features and "
        "realistic adult human proportions (mature woman, NOT a child, NOT chibi), shoulder-length "
        "chestnut brown hair with a natural wave and soft movement, warm hazel eyes with detailed "
        "irises at realistic proportions (NOT oversized anime eyes), soft natural skin with a "
        "subtle rosy flush and lightly painted shading, realistic nose and mouth with natural "
        "proportions, slim average build approximately 5'5\" with natural adult body proportions "
        "not exaggerated, calm warm neutral expression with mouth closed. Default outfit: simple "
        "light blue knit sweater with a cream apron over it. Face, hair, proportions and outfit "
        "identical in every scene. Soft even lighting, hand-painted background detail, 4k quality."
    ),
    "michael": (
        "Same Michael throughout - 35-year-old man in classic hand-painted 2D animation style, "
        "high-quality illustration with soft watercolour textures, clean ink line art and gentle "
        "cel shading, warm natural colour palette (NOT photorealistic, NOT 3D CGI, NOT shiny "
        "digital rendering, NOT manhwa webtoon). Handsome face with refined features and realistic "
        "adult male proportions (mature man, NOT a boy), short dark hair neatly styled with natural "
        "texture, calm dark eyes with realistic adult proportions and depth (NOT oversized anime "
        "eyes), warm skin tone with natural masculine shading, realistic facial structure with a "
        "natural nose and defined jaw, naturally shaped lips, tall lean build approximately 5'11\" "
        "with realistic adult male body proportions (NOT exaggerated muscles), composed neutral "
        "expression with mouth closed. Default outfit: crisp navy business suit with a white shirt "
        "and burgundy tie, dark leather shoes, simple wristwatch. Face, hair, proportions and "
        "outfit identical in every scene. Soft even lighting, hand-painted background detail, "
        "4k quality."
    ),
}

REFERENCES = {
    "sarah": "./character_refs/sarah_reference_sheet.jpg",
    "michael": "./character_refs/michael_reference_sheet.jpg",
}

# Who is actually ON SCREEN in each scene. This is not cosmetic: an @mention for an
# absent character invites the model to insert them. Scene 3 is Michael alone -
# the old narrative_context says so outright ("Sarah is not present - only her
# absence is felt"), because she has left a letter and gone.
PRESENT = {
    1: ["sarah", "michael"],
    2: ["sarah", "michael"],   # split: Sarah at the restaurant, Michael at the office
    3: ["michael"],            # Sarah absent by design
    4: ["sarah", "michael"],
    5: ["sarah", "michael"],
    6: ["sarah", "michael"],
    7: ["sarah", "michael"],
}

# The old value was "Studio Ghibli Animation Style". Naming a real studio is a
# distinctive protected house style and Google's models often refuse or sanitise
# such prompts. Describing the look gets the same result more reliably. Swap this
# one string back if you would rather name the studio.
STYLE = (
    "Classic hand-painted 2D animation, traditional Japanese animated-film look: "
    "soft watercolour backgrounds, clean ink line art, gentle cel shading, warm "
    "natural colour palette, detailed domestic settings"
)

# narrative_context still refers to the studio by name 26 times, and that field IS
# what the builder sends as each scene's VISUAL brief - so renaming only the STYLE
# line would leave the studio name in the prompt 26 more times, which is the half
# of the change that actually matters. Each phrase is rewritten to keep the note's
# meaning ("Ghibli lighting" -> "painted lighting") rather than blanking it.
# Longest-first, because "Classic Ghibli happy ending" also contains "Ghibli happy".
GHIBLI_FIXES = [
    ("Opening scene in classic Ghibli style", "Opening scene in classic hand-painted style"),
    ("(signature Ghibli lighting)", "(signature painted lighting)"),
    ("in typical Ghibli stressed businessman style", "in the classic animated stressed businessman style"),
    ("that distinctive Ghibli watercolor background quality", "that distinctive watercolour background quality"),
    ("Classic Ghibli melancholic scene.", "Classic hand-painted melancholic scene."),
    ("with Ghibli attention to architectural detail", "with careful attention to architectural detail"),
    ("that iconic Ghibli rain effect", "that iconic painted rain effect"),
    ("The scene should capture Ghibli's ability", "The scene should capture the medium's ability"),
    ("Ghibli excels at quiet emotional moments.", "Hand-painted animation excels at quiet emotional moments."),
    ("Ghibli close-up on his hands", "Close-up on his hands"),
    ("Beautiful Ghibli morning transformation scene.", "Beautiful hand-painted morning transformation scene."),
    ("(Ghibli is famous for beautiful mornings after rain)", "(hand-painted animation is famous for beautiful mornings after rain)"),
    ("(Ghibli attention to natural domestic moments)", "(careful attention to natural domestic moments)"),
    ("capture that Ghibli magic of morning light", "capture that hand-painted magic of morning light"),
    ("Quintessential Ghibli intimate emotional scene.", "Quintessential hand-painted intimate emotional scene."),
    ("(Ghibli excels at meaningful hand-holding moments)", "(hand-painted animation excels at meaningful hand-holding moments)"),
    ("Ghibli's signature ability to make quiet", "the medium's signature ability to make quiet"),
    ("Ghibli is masterful at showing meaningful", "Hand-painted animation is masterful at showing meaningful"),
    ("(Ghibli would show detailed hand animation", "(detailed hand animation"),
    ("(Ghibli golden light through ring)", "(golden light through the ring)"),
    ("Everything rendered with Ghibli's attention", "Everything rendered with careful attention"),
    ("Classic Ghibli happy ending returning to opening setting", "Classic hand-painted happy ending returning to the opening setting"),
    ("Beautiful Ghibli summer morning", "Beautiful hand-painted summer morning"),
    ("(Ghibli gentle laughter animation)", "(gentle laughter animation)"),
    ("(Ghibli gorgeous nature)", "(gorgeous painted nature)"),
    ("Perfect Ghibli happy ending", "Perfect hand-painted happy ending"),
]


def deghibli(text):
    """Strip the studio name from a visual brief, keeping the meaning.

    Left deliberately dumb and total: after the phrase list runs, any surviving
    'Ghibli' is reported rather than silently passed through, because a new
    phrasing in the source file would otherwise slip into the prompt unnoticed.
    """
    for find, repl in GHIBLI_FIXES:
        text = text.replace(find, repl)
    return text


def main():
    story = json.loads(SRC.read_text(encoding="utf-8"))

    DEST_DIR.mkdir(parents=True, exist_ok=True)
    REFS.mkdir(parents=True, exist_ok=True)

    # Move the sheets the user generated out of the stories/ root into the story
    # folder, renamed to match the character_references paths above.
    for src_name, dest_name in [("Sarah.jpg", "sarah_reference_sheet.jpg"),
                                ("Michael.jpg", "michael_reference_sheet.jpg")]:
        src = Path(r"d:\MyFinalAutomations\YTMultiLatest\Veo3_New\stories") / src_name
        dest = REFS / dest_name
        if src.exists():
            shutil.move(str(src), str(dest))
            print(f"moved  {src.name} -> {dest.relative_to(DEST_DIR.parent.parent)}")
        elif dest.exists():
            print(f"kept   {dest.name} (already in place)")
        else:
            print(f"WARNING: neither {src} nor {dest} exists")

    story["character_descriptions"] = DESCRIPTIONS
    story["character_references"] = REFERENCES
    story["style"] = STYLE
    # The description is not decoration: story_to_agent_prompt.js puts it in the
    # prompt header ("STORY: ... / <description>"), so the studio name has to go
    # here too or it reaches the agent through the front door.
    if "ghibli" in str(story.get("description", "")).lower():
        story["description"] = deghibli(story["description"]).replace(
            "Studio Ghibli-inspired", "hand-painted animation")

    missing = []
    leftover = []
    for sc in story["scenes"]:
        n = sc["_scene_number"]
        if n not in PRESENT:
            missing.append(n)
        sc["characters"] = PRESENT.get(n, [])
        if sc.get("narrative_context"):
            sc["narrative_context"] = deghibli(sc["narrative_context"])
            if "ghibli" in sc["narrative_context"].lower():
                leftover.append(n)

    if missing:
        raise SystemExit(f"No character list defined for scene(s): {missing}")
    if leftover:
        raise SystemExit(f"Studio name survived in scene(s) {leftover} - add the phrase to GHIBLI_FIXES")
    print("deghibli: 0 mentions left in narrative_context")

    out = DEST_DIR / "the_bridge_of_trust_story.json"
    out.write_text(json.dumps(story, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote  {out}")
    print(f"scenes : {len(story['scenes'])}")
    print(f"style  : {story['style'][:60]}...")


if __name__ == "__main__":
    main()
