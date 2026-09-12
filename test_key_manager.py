"""Tests for the Script tab's multi-key manager.

Run: python test_key_manager.py
Uses a withdrawn Tk root - no window appears, nothing is written to disk.
"""
import json
import os
import sys
import tempfile
import tkinter as tk

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# Point the app at a throwaway settings file so a test run can never clobber the
# real gui_settings.json (which holds the user's actual Flow URL and keys).
TMP = tempfile.mkdtemp(prefix="veo3_keytest_")
import veo3_gui
veo3_gui.SETTINGS_FILE = os.path.join(TMP, "gui_settings.json")

passed = failed = 0


def ok(name, cond, extra=None):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" -> {extra}" if extra else ""))


root = tk.Tk()
root.withdraw()
app = veo3_gui.Veo3LauncherGUI(root)

K1 = "AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAA1111"
K2 = "AIzaSyBBBBBBBBBBBBBBBBBBBBBBBBBBB2222"
K3 = "AIzaSyCCCCCCCCCCCCCCCCCCCCCCCCCCC3333"

print("\n--- masking ---")
ok("hides the middle", "AAAA" not in app.mask_key(K1), app.mask_key(K1))
ok("keeps a recognisable head", app.mask_key(K1).startswith("AIzaSy"))
ok("keeps a recognisable tail", app.mask_key(K1).endswith("1111"))
ok("short value is not echoed", "secret" not in app.mask_key("secret"))

print("\n--- add / remove / order ---")
app.gen_keys.clear()
app.refresh_key_list()
ok("starts empty", app.effective_keys() == [])

app.gen_key_entry.set(K1)
app.add_api_key()
ok("add appends", app.gen_keys == [K1])
ok("entry is cleared after adding", app.gen_key_entry.get() == "",
   "the key must not sit on screen after being saved")

app.gen_key_entry.set(K1)
app.gen_keys.append(K2)          # bypass the dialog in add_api_key
app.gen_keys.append(K3)
app.refresh_key_list()
ok("listbox shows one row per key", app.gen_key_list.size() == 3,
   app.gen_key_list.size())
rows = [app.gen_key_list.get(i) for i in range(3)]
ok("rows are numbered in order", rows[0].startswith("1.") and rows[2].startswith("3."), rows)
ok("no row contains a whole key",
   all(K1 not in r and K2 not in r and K3 not in r for r in rows), rows)

app.gen_key_list.selection_clear(0, "end")
app.gen_key_list.selection_set(0)
app.move_api_key(1)
ok("move down swaps with the next", app.gen_keys == [K2, K1, K3], app.gen_keys)
ok("selection follows the moved key", app.gen_key_list.curselection() == (1,),
   app.gen_key_list.curselection())
app.move_api_key(-1)
ok("move up swaps back", app.gen_keys == [K1, K2, K3], app.gen_keys)

app.gen_key_list.selection_clear(0, "end")
app.gen_key_list.selection_set(2)
app.move_api_key(1)
ok("moving past the end does nothing", app.gen_keys == [K1, K2, K3], app.gen_keys)

app.gen_key_list.selection_clear(0, "end")
app.gen_key_list.selection_set(1)
app.remove_api_key()
ok("remove drops the selected key", app.gen_keys == [K1, K3], app.gen_keys)
ok("listbox shrinks", app.gen_key_list.size() == 2)

print("\n--- duplicates ---")
app.gen_key_entry.set(K3)
before = list(app.gen_keys)
# add_api_key pops a modal on a duplicate; patch the dialog so the test can run
import tkinter.messagebox as mb
real_info = mb.showinfo
mb.showinfo = lambda *a, **k: None
app.add_api_key()
mb.showinfo = real_info
ok("duplicate is refused", app.gen_keys == before, app.gen_keys)

print("\n--- effective_keys ---")
app.gen_key_entry.set("")
ok("returns the saved ring", app.effective_keys() == [K1, K3], app.effective_keys())
app.gen_key_entry.set(K2)
ok("includes a pasted-but-unadded key", app.effective_keys() == [K1, K3, K2],
   app.effective_keys())
app.gen_key_entry.set(K1)
ok("does not duplicate an already-saved key", app.effective_keys() == [K1, K3],
   app.effective_keys())
app.gen_key_entry.set("")
ok("blank entries are dropped", app.effective_keys() == [K1, K3])
app.gen_keys.append("")
ok("empty strings in the list are dropped", app.effective_keys() == [K1, K3],
   app.effective_keys())
app.gen_keys.remove("")

print("\n--- collect_inputs writes a list ---")
app.collect_inputs()
ok("saved as gemini_api_keys", app.settings["gemini_api_keys"] == [K1, K3],
   app.settings["gemini_api_keys"])
ok("legacy single key is cleared",
   app.settings["gemini_api_key"] == "",
   "a stale single key would resurrect a key the user deleted")

print("\n--- persistence round trip ---")
app.save_settings()
with open(veo3_gui.SETTINGS_FILE, encoding="utf-8") as fh:
    saved = json.load(fh)
ok("keys reached the settings file", saved.get("gemini_api_keys") == [K1, K3],
   saved.get("gemini_api_keys"))

app2 = veo3_gui.Veo3LauncherGUI(tk.Toplevel(root))
app2.withdraw() if hasattr(app2, "withdraw") else None
ok("a fresh window loads them back", app2.gen_keys == [K1, K3], app2.gen_keys)

print("\n--- a pre-ring settings file still works ---")
with open(veo3_gui.SETTINGS_FILE, "w", encoding="utf-8") as fh:
    json.dump({"gemini_api_key": K2}, fh)
app3 = veo3_gui.Veo3LauncherGUI(tk.Toplevel(root))
ok("old single key is adopted into the list", app3.gen_keys == [K2], app3.gen_keys)

root.destroy()
print(f"\n{passed} passed, {failed} failed\n")
sys.exit(1 if failed else 0)
