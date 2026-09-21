"""Checks for the GUI progress bar and the engine's [PROGRESS] line.

    python test_progress_gui.py

Every check runs inside a real mainloop. That matters: Tk refuses
root.after() from a worker thread unless the main thread is in mainloop
("main thread is not in main loop"), so a test that only pumps update()
would report a failure that never happens in the running app.
"""
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import tkinter as tk
from tkinter import ttk

from veo3_gui import Veo3LauncherGUI

failures = []
steps = []


def check(name, fn):
    steps.append((name, fn))


root = tk.Tk()
root.withdraw()
gui = Veo3LauncherGUI(root)

# ------------------------------------------------------------------ widgets

check("progress bar and label exist in the console column",
      lambda: (gui.progress is not None and gui.progress_label is not None
               and int(gui.progress["maximum"]) == 100) or _fail("widgets missing"))


def style_registered():
    # A Progressbar with no style of its own renders as clam's default
    # blue-grey slab, which is what the accent style exists to avoid.
    assert ttk.Style(root).configure("Engine.Horizontal.TProgressbar")


check("the progress bar has its own style", style_registered)

# ------------------------------------------------------------------- parser

# _on_progress only queues the value, so every parse check is a pair: feed a
# line in one step, assert on the next. The driver waits between steps, which
# is exactly the window the mainloop needs to deliver the callback.


def feed(line):
    gui._on_progress(line)


def shows(pct, scene_word=None, note=""):
    def _():
        assert int(gui.progress["value"]) == pct, \
            f"{note}: bar shows {gui.progress['value']}, expected {pct}"
        if scene_word:
            assert scene_word in gui.progress_label["text"], \
                f"{note}: label is {gui.progress_label['text']!r}"
    return _


check("feed a full progress line",
      lambda: feed("[12:00:01] [PROGRESS] pct=42 scene=3 generating\n"))
check("bar reads 42 and the label names scene 3", shows(42, "scene 3", "full line"))

check("feed a two-digit scene",
      lambda: feed("[12:00:02] [PROGRESS] pct=77 scene=11 waiting for timeline\n"))
check("bar reads 77 and the label names scene 11", shows(77, "scene 11", "two-digit"))

check("feed a line with no trailing label",
      lambda: feed("[12:00:03] [PROGRESS] pct=5 scene=1\n"))
check("a label-less line still works", shows(5, "scene 1", "no label"))

check("feed an out-of-range percentage",
      lambda: feed("[12:00:04] [PROGRESS] pct=150 scene=2 x\n"))
check("an out-of-range percentage is clamped", shows(100, None, "clamp"))


def feed_junk():
    gui._on_progress("[PROGRESS] pct=abc scene=1\n")
    gui._on_progress("[PROGRESS] nonsense\n")
    gui._on_progress("plain log line\n")
    gui._on_progress("[PROGRESS] scene=9\n")


check("feed lines that carry no usable percentage", feed_junk)
check("junk leaves the bar where it was", shows(100, None, "junk"))


def resets():
    gui._reset_progress("idle")
    assert int(gui.progress["value"]) == 0
    assert gui.progress_label["text"] == "idle"


check("reset clears the bar and the label", resets)

# ----------------------------------------------------------------- threading

# stream_output runs on a reader thread. Start the worker in one step and
# assert in the next: the driver chain already waits a tick, which is enough
# for the mainloop to deliver the callbacks the worker queued.
check("progress from a reader thread is queued",
      lambda: threading.Thread(target=lambda: [
          gui._on_progress(f"[t] [PROGRESS] pct={i} scene=4 generating\n")
          for i in (10, 20, 30, 40, 50)], daemon=True).start())


def thread_reached_widget():
    assert int(gui.progress["value"]) == 50, \
        f"bar shows {gui.progress['value']}, expected the last value 50"
    assert "scene 4" in gui.progress_label["text"]


check("progress from a reader thread reaches the widget", thread_reached_widget)


def no_flood():
    """A burst must collapse: one scheduled callback at a time, not one each."""
    gui._progress_scheduled = False
    for i in range(200):
        gui._on_progress(f"[t] [PROGRESS] pct={i % 100} scene=1 generating\n")
    assert gui._progress_scheduled is True, "expected exactly one pending callback"


check("a burst of lines collapses to one pending update", no_flood)

# --------------------------------------------------------- story folder guard
# A guard that never fires is invisible, so it is worth pinning down. The
# finished stories now sit under an archive folder inside stories/, and the
# guard used to identify a story by its first path segment under stories/ -
# which is the archive folder's name for every one of them, so it read them all
# as the same story and stayed silent. The tree below has that shape.


def _guard_tree():
    """A temp stories/ holding one flat story and two nested under an archive."""
    import shutil
    import tempfile

    import veo3_gui

    tmp = tempfile.mkdtemp(prefix="veo3-guard-")
    for sub in ("flat", "archive/one", "archive/two"):
        d = os.path.join(tmp, *sub.split("/"))
        os.makedirs(os.path.join(d, "clips"), exist_ok=True)
        with open(os.path.join(d, sub.split("/")[-1] + "_story.json"), "w",
                  encoding="utf-8") as fh:
            fh.write("{}")
    saved = veo3_gui.STORIES_DIR
    veo3_gui.STORIES_DIR = tmp

    def folder(sub):
        return os.path.join(tmp, *sub.split("/"))

    def story_json(sub):
        return os.path.join(folder(sub), sub.split("/")[-1] + "_story.json")

    return tmp, saved, folder, story_json, veo3_gui, shutil


def guard_fires_under_an_archive_folder():
    tmp, saved, folder, story_json, mod, shutil = _guard_tree()
    try:
        # The archive nesting is what used to hide the conflict: both of these
        # share their first path segment under stories/.
        assert gui.other_story_of(folder("archive/one/clips"),
                                  story_json("archive/one")) == "", \
            "a story's own clips folder was reported as a different story"
        caught = gui.other_story_of(folder("archive/two/clips"),
                                    story_json("archive/one"))
        assert os.path.basename(caught) == "two", \
            f"clips in a sibling story went uncaught (got {caught!r})"
        assert gui.other_story_of(folder("archive/one/character_refs"),
                                  story_json("archive/one")) == "", \
            "a subfolder of the loaded story must be fine"
        assert gui.other_story_of(folder("flat/clips"),
                                  story_json("flat")) == ""
        assert gui.other_story_of(tmp, story_json("flat")) == "", \
            "the stories/ root is not itself a story"
        assert gui.other_story_of(folder("archive"),
                                  story_json("flat")) == "", \
            "the archive folder is not itself a story"
        assert gui.other_story_of(os.path.dirname(tmp),
                                  story_json("flat")) == "", \
            "a folder outside stories/ stays the user's business"
    finally:
        mod.STORIES_DIR = saved
        shutil.rmtree(tmp, ignore_errors=True)


def guard_finds_a_story_at_any_depth():
    tmp, saved, folder, story_json, mod, shutil = _guard_tree()
    try:
        assert gui.story_folder_of(folder("archive/two/clips")) == \
            folder("archive/two"), "a nested story folder was not identified"
        assert gui.story_folder_of(tmp) == ""
        assert gui.story_folder_of(folder("archive")) == ""
    finally:
        mod.STORIES_DIR = saved
        shutil.rmtree(tmp, ignore_errors=True)


check("the wrong-story guard fires under an archive folder",
      guard_fires_under_an_archive_folder)
check("a story folder is identified at any nesting depth",
      guard_finds_a_story_at_any_depth)

# --------------------------------------------------------------- Run buttons
# The green fill is what marks a button as the one that runs. The five Agent
# Mode stage buttons shipped flat, so the rule held on two tabs out of three.


def run_buttons_are_accent():
    import veo3_gui

    found = []

    def walk(w):
        for c in w.winfo_children():
            if isinstance(c, ttk.Button):
                label = str(c.cget("text"))
                if label.strip().lstrip("▶").strip().lower().startswith("run"):
                    found.append((label, str(c.cget("style"))))
            walk(c)

    walk(root)
    assert len(found) == 6, f"expected 6 Run buttons, found {len(found)}: {found}"
    for label, style in found:
        assert style.startswith("Accent"), \
            f"{label!r} is flat ({style or 'default TButton'})"

    st = ttk.Style(root)
    assert st.lookup("Accent.TButton", "background") == veo3_gui.ACCENT, \
        "the button fill is not the green the selected tab highlights with"
    assert st.lookup("Accent.TButton", "foreground") == "#0d1a12", \
        "the label must stay dark to read against the green"


check("every Run button carries the green accent fill", run_buttons_are_accent)

# -------------------------------------------------------------------- driver


def drive():
    if not steps:
        root.quit()
        return
    name, fn = steps.pop(0)
    try:
        fn()
        print(f"  ok    {name}")
    except Exception as e:
        failures.append(name)
        print(f"  FAIL  {name}\n          {e}")
    root.after(30, drive)


def banner():
    print("\nprogress bar\n")


root.after(10, banner)
root.after(30, drive)
root.after(30000, root.quit)      # safety net if a step wedges
root.mainloop()
root.destroy()

print()
if failures:
    print(f"{len(failures)} FAILED")
    sys.exit(1)
print("all good\n")
