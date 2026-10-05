"""Idea-box boundaries: detailed briefs must never become accidental films."""

import os
import tempfile

from veo3_gui import Veo3LauncherGUI

parse = Veo3LauncherGUI._parse_ideas_text

one = parse("""TITLE: What Happens Inside a Bridge During an Earthquake
THE QUESTION: How does a suspension bridge survive when the ground moves?
THE SUBJECT: towers, cables, hangers, deck and foundations
THE HOOK: the deck starts moving under the protagonist
ENDING: the dampers absorb the final movement
""")
assert len(one) == 1, one
assert one[0]["title"] == "What Happens Inside a Bridge During an Earthquake"
assert "THE QUESTION:" in one[0]["detail"]
assert "THE HOOK:" in one[0]["detail"]

many = parse("""STORY 1
TITLE: The First Conversation
THE ISSUE: One partner feels ignored.
THE ENDING: They agree on a boundary.

STORY 2
TITLE: The Second Conversation
PRESET: relationship-dialogue
THE ISSUE: Trust after a hidden message.

STORY 3: The Bridge Question
THE QUESTION: Why does the deck move?
""")
assert len(many) == 3, many
assert [x["title"] for x in many] == [
    "The First Conversation", "The Second Conversation", "The Bridge Question"
]
assert many[1]["preset"] == "relationship-dialogue"
assert "Trust after" in many[1]["detail"]

plain = parse("""A relationship title
The first detail line.
The second detail line.
""")
assert plain == [{
    "title": "A relationship title",
    "detail": "The first detail line.\nThe second detail line.",
}], plain

compact = parse("""First title | relationship-dialogue | First detail
Second title | geography-map | Second detail
""")
assert len(compact) == 2, compact
assert compact[0]["preset"] == "relationship-dialogue"
assert compact[1]["title"] == "Second title"

with tempfile.TemporaryDirectory(prefix="veo-ideas-") as tmp:
    source = os.path.join(tmp, "ideas.txt")
    with open(source, "w", encoding="utf-8") as fh:
        fh.write("""STORY 1
TITLE: Imported One
THE HOOK: first detail

STORY 2
TITLE: Imported Two
THE ENDING: second detail
""")
    app = Veo3LauncherGUI.__new__(Veo3LauncherGUI)
    refs, imported = app._read_items_file(source)
    assert refs == []
    assert [x["title"] for x in imported] == ["Imported One", "Imported Two"]

print("Idea parser checks passed: one brief, STORY markers, safe default, compact batch, text import.")
