"""Tests for the preset-driven running length on the Script tab.

Run: python test_preset_length.py
Uses a withdrawn Tk root - no window appears, and the settings file it writes
is a throwaway, so the real gui_settings.json is never touched.
"""
import json
import os
import sys
import tempfile
import tkinter as tk

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

TMP = tempfile.mkdtemp(prefix="veo3_len_")
SETTINGS = os.path.join(TMP, "gui_settings.json")
# A saved duration that disagrees with the animal preset's own length, so the
# "startup must not overwrite it" test has something to catch.
with open(SETTINGS, "w", encoding="utf-8") as f:
    json.dump({"gen_duration": 56, "gen_preset": "animal-kindness"}, f)

import veo3_gui
veo3_gui.SETTINGS_FILE = SETTINGS

passed = failed = 0


def ok(name, cond, extra=None):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" -> {extra}" if extra else ""))


print("\n--- styles.json ---")
displays, ids, styles, lengths = veo3_gui.load_style_presets()
ok("returns four mappings", all(isinstance(x, (list, dict)) for x in (displays, ids, styles, lengths)))
ok("every preset has a style", len(styles) == len(displays))
ANIMAL = next(d for d, i in ids.items() if i == "animal-kindness")
GHIBLI = next(d for d, i in ids.items() if i == "ghibli")
ok("only the animal preset declares a length",
   list(lengths.keys()) == [ANIMAL], ", ".join(sorted(lengths)))
ok("its length is 80", lengths.get(ANIMAL) == 80, str(lengths.get(ANIMAL)))
ok("ghibli has none", GHIBLI not in lengths)

print("\n--- startup does not overwrite a saved duration ---")
root = tk.Tk()
root.withdraw()
app = veo3_gui.Veo3LauncherGUI(root)
ok("the saved 56s survives opening the GUI",
   int(app.gen_duration_var.get()) == 56, str(app.gen_duration_var.get()))
ok("the preset box shows the animal preset", app.gen_preset_var.get() == ANIMAL,
   app.gen_preset_var.get())

print("\n--- switching preset ---")
app.gen_preset_var.set(GHIBLI)
ok("a preset with no length leaves the duration alone",
   int(app.gen_duration_var.get()) == 56, str(app.gen_duration_var.get()))

app.gen_preset_var.set(ANIMAL)
ok("picking the animal preset fills in its length",
   int(app.gen_duration_var.get()) == 80, str(app.gen_duration_var.get()))

print("\n--- the box stays editable afterwards ---")
app.gen_duration_var.set(96)
ok("you can still type your own duration", int(app.gen_duration_var.get()) == 96)
app.gen_preset_var.set(ANIMAL + " ")
app.gen_preset_var.set(ANIMAL)
ok("re-picking the preset restores its length",
   int(app.gen_duration_var.get()) == 80, str(app.gen_duration_var.get()))
app.gen_duration_var.set(56)
app.gen_preset_var.set(GHIBLI)
ok("moving to a plain preset keeps your edited value",
   int(app.gen_duration_var.get()) == 56, str(app.gen_duration_var.get()))

print("\n--- the count line keeps up ---")
app.gen_preset_var.set(ANIMAL)
app.update_gen_count()
ok("count reflects 80s at 8s per clip", "10 clips" in app.gen_count.get(), app.gen_count.get())

print("\n--- an unknown value is ignored, not crashed on ---")
app.gen_preset_var.set("styles.json missing or empty")
ok("a bogus preset selection is harmless",
   int(app.gen_duration_var.get()) == 80, str(app.gen_duration_var.get()))

root.destroy()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
