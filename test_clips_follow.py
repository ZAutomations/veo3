"""Tests for the clips-folder-follows-the-story fix.

Reproduces the 2026-09-12 bug: clips were downloaded into
stories/the_bridge_of_trust/clips while a different story was loaded, because a
saved clips_dir outvoted the story on screen.

Run: python test_clips_follow.py
"""
import os
import sys
import tempfile
import tkinter as tk

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

TMP = tempfile.mkdtemp(prefix="veo3_clipstest_")
import veo3_gui
veo3_gui.SETTINGS_FILE = os.path.join(TMP, "gui_settings.json")

# A throwaway stories/ root with two story folders in it, so the test does not
# depend on whatever happens to be on disk and cannot touch the real stories.
STORIES = os.path.join(TMP, "stories")
os.makedirs(os.path.join(STORIES, "story_a"))
os.makedirs(os.path.join(STORIES, "story_b"))
veo3_gui.STORIES_DIR = STORIES

passed = failed = 0


def ok(name, cond, extra=None):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" -> {extra}" if extra else ""))


def eq(name, got, want):
    ok(name, os.path.normcase(str(got)) == os.path.normcase(str(want)),
       f"got {got!r} want {want!r}")


A = os.path.join(STORIES, "story_a", "story_a_story.json")
B = os.path.join(STORIES, "story_b", "story_b_story.json")
for p in (A, B):
    with open(p, "w", encoding="utf-8") as fh:
        fh.write("{}")

root = tk.Tk()
root.withdraw()

# Start the app with the stale setting that caused the bug: story B loaded, but
# the clips folder still pointing at story A from an earlier session.
import json
with open(veo3_gui.SETTINGS_FILE, "w", encoding="utf-8") as fh:
    json.dump({
        "story_json": B,
        "clips_dir": os.path.join(STORIES, "story_a", "clips"),
    }, fh)

app = veo3_gui.Veo3LauncherGUI(root)

print("\n--- startup with a stale folder from another story ---")
eq("clips folder corrected to the loaded story", app.clips_var.get(),
   os.path.join(STORIES, "story_b", "clips"))

print("\n--- THE BUG: switch story, folder must follow ---")
app.agent_story_var.set(A)
eq("clips folder moved to the new story", app.clips_var.get(),
   os.path.join(STORIES, "story_a", "clips"))

app.agent_story_var.set(B)
eq("and follows back again", app.clips_var.get(),
   os.path.join(STORIES, "story_b", "clips"))

print("\n--- other_story_of ---")
eq("same story is not 'other'",
   app.other_story_of(os.path.join(STORIES, "story_a", "clips"), A), "")
eq("its own clips subfolder is not 'other'",
   app.other_story_of(os.path.join(STORIES, "story_a", "clips", "sub"), A), "")
eq("a different story IS flagged",
   app.other_story_of(os.path.join(STORIES, "story_b", "clips"), A), "story_b")
eq("a folder outside stories/ is left alone",
   app.other_story_of(os.path.join(TMP, "somewhere"), A), "")
eq("the story root itself is not 'other'",
   app.other_story_of(os.path.join(STORIES, "story_a"), A), "")

print("\n--- a custom folder outside stories/ ---")
custom = os.path.join(TMP, "my_render")
app.clips_var.set(custom)
eq("not flagged", app.other_story_of(custom, A), "")
app.agent_story_var.set(B)
eq("but re-follows once the story changes", app.clips_var.get(),
   os.path.join(STORIES, "story_b", "clips"))

print("\n--- correct_clips_dir self-heals a hand-edited field ---")
import tkinter.messagebox as mb
warned = []
real_warn = mb.showwarning
mb.showwarning = lambda *a, **k: warned.append(a)
app.agent_story_var.set(A)
app.clips_var.set(os.path.join(STORIES, "story_b", "clips"))
app.collect_inputs()
fixed = app.correct_clips_dir("download")
mb.showwarning = real_warn
eq("redirected to the loaded story's folder", fixed,
   os.path.join(STORIES, "story_a", "clips"))
ok("the user was told", len(warned) == 1, warned)
ok("the warning names both stories",
   warned and "story_b" in str(warned[0]) and "story_a" in str(warned[0]), warned)
eq("the field was updated too", app.clips_var.get(),
   os.path.join(STORIES, "story_a", "clips"))

print("\n--- no story loaded: field is left alone ---")
app.agent_story_var.set("")
app.clips_var.set(custom)
eq("empty story does not blank the field", app.clips_var.get(), custom)
eq("correct_clips_dir leaves a custom folder alone", app.correct_clips_dir(), custom)

print("\n--- a story path typed by hand is followed too ---")
app.agent_story_var.set(B)
eq("typing a path moves the folder", app.clips_var.get(),
   os.path.join(STORIES, "story_b", "clips"))

root.destroy()
print(f"\n{passed} passed, {failed} failed\n")
sys.exit(1 if failed else 0)
