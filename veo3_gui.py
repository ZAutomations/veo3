#!/usr/bin/env python3
"""
VEO3 FLOW LAUNCHER GUI
======================
Two modes, side by side, in tabs. Neither replaces the other.

  Ingredients (extend)  the original path. Needs a future Ultra account (or a
                        plan with the extend models), so it is kept working and
                        untouched. Drives veo3_flow_new_ui.js.
  Agent Mode            the newer path. Drives agent_mode.js, and adds the two
                        post-processing stages Agent Mode needs: download the
                        discrete clips, then JOIN them with ffmpeg (the
                        ingredients path SPLITS one export instead - opposite
                        operation, which is why they are separate scripts).

Agent Mode is a 4-stage pipeline, deliberately not one button:

  1. Build prompt   story JSON -> agent_prompt.txt   (story_to_agent_prompt.js)
  2. Run agent      types the prompt, attaches @mentions, submits
  3. Download       pulls the clips out of Flow      (agent_download.js)
  4. Join           ffmpeg concat -> one final mp4   (join_clips.js)

Between 2 and 3 sit the steps that are NOT automated on purpose - creating the
project, uploading the character reference images, and setting Agent
Instructions. They are one-time-per-project and they are exactly the places
where a wrong guess would silently poison every later stage, so the Agent tab
spells them out instead of pretending to do them.

Fields:
  - Story JSON picker (stories/ folder)
  - Scene range (From / To) + skip refs        [ingredients]
  - Model hint, auto-approve, submit gate      [agent]
  - Project URL (optional - engine asks if empty)
  - CDP port (your Chrome debug port, default 9222)
"""

import json
import os
import subprocess
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(BASE_DIR, "veo3_flow_new_ui.js")
AGENT_ENGINE = os.path.join(BASE_DIR, "agent_mode.js")
PROMPT_BUILDER = os.path.join(BASE_DIR, "story_to_agent_prompt.js")
STYLES_TOOL = os.path.join(BASE_DIR, "styles.js")
STYLES_FILE = os.path.join(BASE_DIR, "styles.json")
WRITER = os.path.join(BASE_DIR, "write_story.js")
DOWNLOADER = os.path.join(BASE_DIR, "agent_download.js")
JOINER = os.path.join(BASE_DIR, "join_clips.js")
SETTINGS_FILE = os.path.join(BASE_DIR, "gui_settings.json")
STORIES_DIR = os.path.join(BASE_DIR, "stories")

DEFAULTS = {
    "story_json": "",
    "from_scene": 1,
    "to_scene": 5,
    "skip_refs": False,
    "project_url": "",
    "cdp_port": 9222,
    # agent mode
    "model_hint": "veo3.1 low priority",
    "auto_approve": False,
    "no_submit": True,
    "watch_secs": 300,
    "clips_dir": "",
    # Clip format. Agent Mode has no settings panel, so these reach Flow as words
    # in the prompt. 16:9 is YouTube's shape; the first two stories came out that
    # way only because it is Flow's default, not because anything asked for it.
    "aspect_ratio": "16:9",
    # 8s is the ceiling for Veo 3.1 - Lite [Lower Priority]. The spinbox stops
    # there on purpose; a longer clip needs the CLI or the story JSON, and the
    # builder warns when you go over.
    "scene_seconds": 8,

    # Flow's project grid is newest-first, so DOM order is the reverse of scene
    # order and numbering clips by on-screen order names scene 7 as scene-01.mp4.
    # Both stories run so far have been newest-first, hence the default.
    "reverse": True,

    # Last style preset picked in the Agent tab. Stored as an id, not a label, so
    # renaming a preset in styles.json does not strand the saved setting.
    "style_preset": "",

    # ---- Script tab ----
    "gen_detail": "",
    "gen_duration": 56,
    # Its own copy rather than sharing the Agent tab's: a story is written once
    # and read back by the Agent tab from the story JSON, so these two never need
    # to agree, and sharing them would silently rewrite the other tab's fields.
    "gen_aspect_ratio": "16:9",
    "gen_scene_seconds": 8,
    "gen_preset": "ghibli",
    # Pinned, not "gemini-flash-latest": an alias changes the model under you
    # between runs with nothing on screen to say why. Google retired the previous
    # default within hours of this being written, so press "List models" and pick
    # from what your key can actually use - that list is the only source of truth.
    "gemini_model": "gemini-3.6-flash",
    # Lands in gui_settings.json, which is gitignored. Never logged or echoed.
    #
    # A list, not a single key. write_story.js walks it in order and moves to the
    # next one when a key reports itself out of quota, so one exhausted key does
    # not fail a story half-written. "gemini_api_key" is still read as a fallback
    # for settings files written before this existed.
    "gemini_api_keys": [],
}


def load_style_presets():
    """Read styles.json into the Agent tab's dropdown data.

    Returns (displays, id_by_display, style_by_display). A preset is offered as
    "Label  [id]" - the label is what a person picks by, the id is what styles.js
    resolves. All three come back empty if the file is missing or malformed, so
    the tab starts with a disabled button and a line saying why, instead of a
    menu of ids that every apply would reject.
    """
    try:
        with open(STYLES_FILE, "r", encoding="utf-8") as f:
            styles = json.load(f).get("styles") or []
    except Exception:
        return [], {}, {}
    displays, id_by_display, style_by_display = [], {}, {}
    for s in styles:
        sid = str(s.get("id") or "").strip()
        if not sid:
            continue
        label = str(s.get("label") or "").strip() or sid
        disp = f"{label}  [{sid}]"
        # Two presets sharing a label would collide in the map and the second
        # would be unselectable; disambiguate rather than silently drop it.
        while disp in id_by_display:
            disp += " "
        displays.append(disp)
        id_by_display[disp] = sid
        style_by_display[disp] = str(s.get("style") or "")
    return displays, id_by_display, style_by_display


class Veo3LauncherGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("VEO3 Flow Launcher")
        self.root.geometry("900x760")
        self.root.configure(bg="#1e1e28")

        self.settings = self.load_settings()
        self.build_style()
        self.build_ui()

    # ── settings ──────────────────────────────────────────────
    def load_settings(self):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                s = json.load(f)
            for k, v in DEFAULTS.items():
                s.setdefault(k, v)
            return s
        except Exception:
            return dict(DEFAULTS)

    def save_settings(self):
        self.collect_inputs()
        try:
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.settings, f, indent=2)
        except Exception:
            pass

    # ── style ─────────────────────────────────────────────────
    def build_style(self):
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("TFrame", background="#1e1e28")
        style.configure("TLabel", background="#1e1e28", foreground="#e8e8f0", font=("Segoe UI", 10))
        style.configure("Header.TLabel", foreground="#7ee787", font=("Segoe UI", 16, "bold"))
        style.configure("Hint.TLabel", foreground="#9a9ab0", font=("Segoe UI", 9))
        style.configure("Warn.TLabel", foreground="#ffb86c", font=("Segoe UI", 9))
        style.configure("Step.TLabel", foreground="#e8e8f0", font=("Segoe UI", 10, "bold"))
        style.configure("TButton", font=("Segoe UI", 10, "bold"), padding=6)
        style.configure("TCheckbutton", background="#1e1e28", foreground="#e8e8f0")
        style.configure("TEntry", fieldbackground="#2a2a38", foreground="#e8e8f0")
        style.configure("TSpinbox", fieldbackground="#2a2a38", foreground="#e8e8f0")
        # Notebook needs its own colours or the tab strip renders light on dark.
        style.configure("TNotebook", background="#1e1e28", borderwidth=0)
        style.configure("TNotebook.Tab", background="#2a2a38", foreground="#c8c8d8",
                        padding=(16, 8), font=("Segoe UI", 10, "bold"))
        style.map("TNotebook.Tab",
                  background=[("selected", "#1e1e28")],
                  foreground=[("selected", "#7ee787")])

    # ── ui ────────────────────────────────────────────────────
    def build_ui(self):
        ttk.Label(self.root, text="🎬 VEO3 Flow Launcher", style="Header.TLabel").grid(
            row=0, column=0, columnspan=2, sticky="w", padx=14, pady=(14, 4))

        self.nb = ttk.Notebook(self.root)
        self.nb.grid(row=1, column=0, columnspan=2, sticky="nsew", padx=12, pady=(4, 6))

        scr = ttk.Frame(self.nb)
        ing = ttk.Frame(self.nb)
        agt = ttk.Frame(self.nb)
        # Script first: it is where a video now starts. The ingredients path is
        # unchanged and still second.
        self.nb.add(scr, text="Script")
        self.nb.add(ing, text="Ingredients (extend)")
        self.nb.add(agt, text="Agent Mode")
        self.agent_tab = agt

        self.build_script_tab(scr)
        self.build_ingredients_tab(ing)
        self.build_agent_tab(agt)

        # Shared output - both modes stream into one panel so a run is never
        # half-visible in a tab you are not looking at.
        ttk.Label(self.root, text="Engine output:").grid(row=2, column=0, sticky="ne", padx=14, pady=6)
        outwrap = tk.Frame(self.root, bg="#1e1e28")
        outwrap.grid(row=2, column=1, sticky="nsew", padx=(0, 14), pady=6)
        self.output = tk.Text(outwrap, height=16, bg="#14141c", fg="#c7f0c7",
                              insertbackground="#fff", font=("Consolas", 9), wrap="word")
        sb = ttk.Scrollbar(outwrap, orient="vertical", command=self.output.yview)
        self.output.configure(yscrollcommand=sb.set)
        self.output.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        self.output.insert("end", "Waiting to start...\n")

        self.root.columnconfigure(1, weight=1)
        self.root.rowconfigure(2, weight=1)

        self.proc = None
        self.load_story_info()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    # ── tab 0: script ─────────────────────────────────────────
    def build_script_tab(self, f):
        pad = dict(padx=14, pady=5)
        f.columnconfigure(1, weight=1)
        r = 0

        tk.Label(f, justify="left", anchor="w", bg="#2a2333", fg="#d8d0e0",
                 font=("Segoe UI", 9),
                 text=("Write a whole story package from a title and a preset. Produces the story\n"
                       "JSON, a style bible, and paste-ready character-sheet prompts, in its own\n"
                       "folder under stories/. It writes NO video and spends NO Flow credits -\n"
                       "the images are still made by hand, then run through the Agent Mode stages.")
                 ).grid(row=r, column=0, columnspan=3, sticky="ew", padx=10, pady=(10, 8), ipady=6)
        r += 1

        ttk.Label(f, text="Video title:").grid(row=r, column=0, sticky="e", **pad)
        self.gen_title_var = tk.StringVar()
        ttk.Entry(f, textvariable=self.gen_title_var, width=58).grid(
            row=r, column=1, columnspan=2, sticky="w", **pad)
        r += 1

        ttk.Label(f, text="Detail:").grid(row=r, column=0, sticky="ne", **pad)
        self.gen_detail = tk.Text(f, height=4, width=58, bg="#14141c", fg="#d8d0e0",
                                  insertbackground="#fff", wrap="word", font=("Segoe UI", 9))
        self.gen_detail.grid(row=r, column=1, columnspan=2, sticky="w", **pad)
        self.gen_detail.insert("1.0", self.settings.get("gen_detail") or "")
        r += 1

        ttk.Label(f, text="a sentence or two - who, where, what changes. The model fills the rest",
                  style="Hint.TLabel").grid(row=r, column=1, columnspan=2, sticky="w", padx=14, pady=(0, 4))
        r += 1

        # Style preset - the same list the Agent tab applies after the fact. Here
        # it is an input: the story is written in this look from the first word,
        # rather than having the look bolted on once the text already disagrees.
        ttk.Label(f, text="Style preset:").grid(row=r, column=0, sticky="e", **pad)
        sty = tk.Frame(f, bg="#1e1e28")
        sty.grid(row=r, column=1, columnspan=2, sticky="w", padx=14)
        self._gen_displays, self._gen_ids, _ = load_style_presets()
        self.gen_preset_var = tk.StringVar()
        self.gen_preset_box = ttk.Combobox(sty, textvariable=self.gen_preset_var, width=44,
                                           values=self._gen_displays, state="readonly")
        self.gen_preset_box.pack(side="left")
        ttk.Button(sty, text="Manage…", command=self.open_styles_help).pack(side="left", padx=(8, 0))
        if self._gen_displays:
            want = self.settings.get("gen_preset") or ""
            for disp, sid in self._gen_ids.items():
                if sid == want:
                    self.gen_preset_var.set(disp)
                    break
        else:
            self.gen_preset_box.configure(values=["styles.json missing or empty"])
            self.gen_preset_var.set("styles.json missing or empty")
        r += 1

        ttk.Label(f, text="Shape & format:").grid(row=r, column=0, sticky="e", **pad)
        fmt = tk.Frame(f, bg="#1e1e28")
        fmt.grid(row=r, column=1, columnspan=2, sticky="w", padx=14)
        self.gen_duration_var = tk.IntVar(value=self.settings.get("gen_duration", 56))
        ttk.Spinbox(fmt, from_=8, to=1200, increment=8, textvariable=self.gen_duration_var,
                    width=6).pack(side="left")
        ttk.Label(fmt, text="seconds total", style="Hint.TLabel").pack(side="left", padx=(6, 18))
        self.gen_seconds_var = tk.IntVar(value=self.settings.get("gen_scene_seconds", 8))
        ttk.Spinbox(fmt, from_=1, to=8, textvariable=self.gen_seconds_var,
                    width=4).pack(side="left")
        ttk.Label(fmt, text="sec per clip", style="Hint.TLabel").pack(side="left", padx=(6, 18))
        self.gen_aspect_var = tk.StringVar(value=self.settings.get("gen_aspect_ratio", "16:9"))
        ttk.Combobox(fmt, textvariable=self.gen_aspect_var, width=6,
                     values=["16:9", "9:16", "1:1"]).pack(side="left")
        ttk.Label(fmt, text="aspect", style="Hint.TLabel").pack(side="left", padx=(6, 0))
        r += 1

        self.gen_count = tk.StringVar()
        ttk.Label(f, textvariable=self.gen_count, style="Hint.TLabel").grid(
            row=r, column=1, columnspan=2, sticky="w", padx=14, pady=(0, 4))
        for v in (self.gen_duration_var, self.gen_seconds_var):
            v.trace_add("write", lambda *a: self.update_gen_count())
        self.update_gen_count()
        r += 1

        ttk.Label(f, text="Gemini model:").grid(row=r, column=0, sticky="e", **pad)
        md = tk.Frame(f, bg="#1e1e28")
        md.grid(row=r, column=1, columnspan=2, sticky="w", padx=14)
        self.gen_model_var = tk.StringVar(value=self.settings.get("gemini_model", "gemini-3.6-flash"))
        # Editable, not readonly: "List models" fills it from the API, but a model
        # the list has not seen yet can still be typed in without waiting for it.
        self.gen_model_box = ttk.Combobox(md, textvariable=self.gen_model_var, width=30)
        self.gen_model_box.pack(side="left")
        ttk.Button(md, text="List models", command=self.list_models).pack(side="left", padx=(8, 0))
        ttk.Label(md, text="fills this list from your key - nothing is spent",
                  style="Hint.TLabel").pack(side="left", padx=(10, 0))
        r += 1

        ttk.Label(f, text="Gemini API keys:").grid(row=r, column=0, sticky="ne", **pad)
        kd = tk.Frame(f, bg="#1e1e28")
        kd.grid(row=r, column=1, columnspan=2, sticky="w", padx=14)

        # A list rather than one field: the point is to hold several and let the
        # writer fall through to the next when one runs dry. Kept as a Listbox of
        # masked keys so the order is visible and editable - the order IS the
        # fallback order.
        self.gen_keys = list(self.settings.get("gemini_api_keys") or [])
        legacy = (self.settings.get("gemini_api_key") or "").strip()
        if legacy and legacy not in self.gen_keys:
            self.gen_keys.insert(0, legacy)

        self.gen_key_list = tk.Listbox(kd, height=3, width=34, activestyle="none",
                                       bg="#14141c", fg="#e6e6ee",
                                       selectbackground="#3a3a52", highlightthickness=0,
                                       exportselection=False)
        self.gen_key_list.pack(side="left")

        kb = tk.Frame(kd, bg="#1e1e28")
        kb.pack(side="left", padx=(8, 0), anchor="n")
        self.gen_key_entry = tk.StringVar()
        ttk.Entry(kb, textvariable=self.gen_key_entry, width=34, show="•").pack(anchor="w")
        e2 = tk.Frame(kb, bg="#1e1e28")
        e2.pack(anchor="w", pady=(4, 0))
        ttk.Button(e2, text="Add key", width=10,
                   command=self.add_api_key).pack(side="left")
        ttk.Button(e2, text="Remove", width=10,
                   command=self.remove_api_key).pack(side="left", padx=(6, 0))
        ttk.Button(e2, text="Test keys", width=10,
                   command=self.test_keys).pack(side="left", padx=(6, 0))
        ttk.Button(e2, text="↑", width=3,
                   command=lambda: self.move_api_key(-1)).pack(side="left", padx=(6, 0))
        ttk.Button(e2, text="↓", width=3,
                   command=lambda: self.move_api_key(1)).pack(side="left")

        self.gen_key_note = ttk.Label(kd, text="", style="Hint.TLabel", justify="left")
        self.gen_key_note.pack(side="left", padx=(10, 0), anchor="n")
        self.refresh_key_list()
        r += 1

        btns = tk.Frame(f, bg="#1e1e28")
        btns.grid(row=r, column=1, columnspan=2, sticky="w", padx=14, pady=(10, 4))
        ttk.Button(btns, text="📝  Write story", command=self.write_story, width=20).pack(side="left")
        ttk.Button(btns, text="Preview prompts (dry run)",
                   command=lambda: self.write_story(dry=True)).pack(side="left", padx=(10, 0))
        ttk.Button(btns, text="Open stories folder",
                   command=lambda: self._open_dir(STORIES_DIR)).pack(side="left", padx=(10, 0))
        r += 1

        ttk.Label(f, text=("Dry run prints the exact prompts and calls nothing - worth doing once to see\n"
                           "what the model will be told before you spend a single credit."),
                  style="Hint.TLabel", justify="left").grid(
            row=r, column=1, columnspan=2, sticky="w", padx=14, pady=(4, 10))

    def update_gen_count(self):
        """Show the clip count as the duration is edited, before anything runs."""
        try:
            d, s = int(self.gen_duration_var.get()), int(self.gen_seconds_var.get() or 8)
            n = max(1, round(d / s))
            self.gen_count.set(f"{d}s at {s}s per clip  ->  {n} clips  "
                               f"(narration ~{n * 20} words total)")
        except (tk.TclError, ZeroDivisionError, ValueError):
            self.gen_count.set("")

    # ── the api key ring ──────────────────────────────────────
    @staticmethod
    def mask_key(k):
        """Enough of a key to tell two apart in a log, never the whole thing."""
        k = str(k or "")
        return f"{k[:6]}…{k[-4:]}" if len(k) > 12 else "(short key)"

    def refresh_key_list(self):
        """Redraw the listbox from self.gen_keys and update the count note."""
        self.gen_key_list.delete(0, "end")
        for i, k in enumerate(self.gen_keys):
            self.gen_key_list.insert("end", f"{i + 1}.  {self.mask_key(k)}")
        n = len(self.gen_keys)
        if n == 0:
            note = "no key yet\n(needed to write a story)"
        elif n == 1:
            note = "1 key\nused for the whole run"
        else:
            note = (f"{n} keys\nused top to bottom.\n"
                    f"When one hits its quota the\nrun continues on the next.")
        self.gen_key_note.configure(text=note)

    def add_api_key(self):
        """Append whatever is in the entry box, ignoring a duplicate."""
        k = self.gen_key_entry.get().strip()
        if not k:
            return
        if k in self.gen_keys:
            messagebox.showinfo("Already added",
                                "That key is already in the list. "
                                "Duplicates would be retried needlessly.")
            return
        self.gen_keys.append(k)
        self.gen_key_entry.set("")   # do not leave the key on screen
        self.refresh_key_list()

    def remove_api_key(self):
        sel = self.gen_key_list.curselection()
        if not sel:
            messagebox.showinfo("Nothing selected", "Click a key in the list first.")
            return
        del self.gen_keys[sel[0]]
        self.refresh_key_list()

    def move_api_key(self, step):
        """Reorder - the list order is the fallback order."""
        sel = self.gen_key_list.curselection()
        if not sel:
            return
        i = sel[0]
        j = i + step
        if not (0 <= j < len(self.gen_keys)):
            return
        self.gen_keys[i], self.gen_keys[j] = self.gen_keys[j], self.gen_keys[i]
        self.refresh_key_list()
        self.gen_key_list.selection_set(j)

    def test_keys(self):
        """Ask each key to list models, to see which are alive.

        Listing costs nothing and, unlike a generate call, still works on a key
        with no quota left - so this answers "is this key valid and switched on",
        which is the question that matters when a run has just failed. It does
        not prove the key has quota; only a real call does that.
        """
        self.collect_inputs()
        keys = self.settings["gemini_api_keys"]
        if not keys:
            messagebox.showerror("No keys", "Add at least one key first.")
            return
        self.save_settings()
        self.output.delete("1.0", "end")
        self.output.insert("end", f"Testing {len(keys)} key(s)...\n\n")
        for i, k in enumerate(keys, 1):
            self.output.insert("end", f"  {i}. {self.mask_key(k)} ... ")
            self.output.update_idletasks()
            try:
                # --key-index, not --key: the key stays in the settings file where
                # it already lives, so it never appears in the process list.
                p = subprocess.run(["node", WRITER, "--list-models", "--key-index", str(i)],
                                   cwd=BASE_DIR, capture_output=True, text=True,
                                   encoding="utf-8", errors="replace", timeout=60,
                                   shell=False)
            except Exception as e:
                self.output.insert("end", f"could not run: {e}\n")
                continue
            if p.returncode == 0 and (p.stdout or "").strip():
                n = len([ln for ln in p.stdout.splitlines() if ln.strip()])
                self.output.insert("end", f"OK - {n} models\n")
            else:
                msg = (p.stderr or "no output").strip().splitlines()
                self.output.insert("end", f"FAILED - {msg[-1] if msg else '?'}\n")
        self.output.insert("end", "\nA key that lists models can still be out of quota.\n"
                                  "Only a real run proves quota.\n")

    def open_styles_help(self):
        messagebox.showinfo(
            "Style presets",
            "Presets live in styles.json and are listed by:\n\n"
            "    npm run styles\n\n"
            "Each carries the look, a cast template, a palette, a narrator voice,\n"
            "story shapes and a list of things to never include.\n\n"
            "The dropdown here is filled from that file every time the GUI starts.")

    # ── tab 1: ingredients (unchanged behaviour) ──────────────
    def build_ingredients_tab(self, f):
        pad = dict(padx=14, pady=6)
        f.columnconfigure(1, weight=1)

        ttk.Label(f, text="Story JSON:").grid(row=1, column=0, sticky="e", **pad)
        self.story_var = tk.StringVar(value=self.settings["story_json"])
        ttk.Entry(f, textvariable=self.story_var, width=58).grid(row=1, column=1, sticky="w", **pad)
        ttk.Button(f, text="Browse…", command=self.browse_story).grid(row=1, column=2, **pad)

        self.story_info = tk.StringVar(value="No story loaded")
        ttk.Label(f, textvariable=self.story_info, style="Hint.TLabel").grid(
            row=2, column=1, columnspan=2, sticky="w", padx=14)

        ttk.Label(f, text="Scene range:").grid(row=3, column=0, sticky="e", **pad)
        rng = tk.Frame(f, bg="#1e1e28")
        rng.grid(row=3, column=1, sticky="w", **pad)
        self.from_var = tk.IntVar(value=self.settings["from_scene"])
        self.to_var = tk.IntVar(value=self.settings["to_scene"])
        tk.Label(rng, text="From", bg="#1e1e28", fg="#e8e8f0").pack(side="left")
        ttk.Spinbox(rng, from_=1, to=99, textvariable=self.from_var, width=4).pack(side="left", padx=6)
        tk.Label(rng, text="To", bg="#1e1e28", fg="#e8e8f0").pack(side="left", padx=(14, 0))
        ttk.Spinbox(rng, from_=1, to=99, textvariable=self.to_var, width=4).pack(side="left", padx=6)

        ttk.Label(f, text="Project URL:").grid(row=4, column=0, sticky="e", **pad)
        self.url_var = tk.StringVar(value=self.settings["project_url"])
        ttk.Entry(f, textvariable=self.url_var, width=58).grid(row=4, column=1, columnspan=2, sticky="w", **pad)

        ttk.Label(f, text="Chrome CDP port:").grid(row=5, column=0, sticky="e", **pad)
        self.cdp_var = tk.IntVar(value=self.settings["cdp_port"])
        ttk.Spinbox(f, from_=1024, to=65535, textvariable=self.cdp_var, width=8).grid(
            row=5, column=1, sticky="w", **pad)
        ttk.Label(f, text="(your logged-in Chrome - Profile 3)", style="Hint.TLabel").grid(
            row=5, column=1, sticky="w", padx=(120, 14), pady=6)

        self.skip_refs_var = tk.BooleanVar(value=self.settings["skip_refs"])
        ttk.Checkbutton(f, text="Skip refs upload (refs already in project)",
                        variable=self.skip_refs_var).grid(row=6, column=1, sticky="w", **pad)

        ttk.Button(f, text="▶  RUN ENGINE", command=self.run_engine).grid(
            row=7, column=1, sticky="w", pady=(16, 4))
        ttk.Button(f, text="⬜  Kill engine", command=self.kill_engine).grid(
            row=7, column=1, sticky="w", padx=(170, 14), pady=(16, 4))

        ttk.Label(f, text="This path exports ONE continuous timeline and SPLITS it with ffmpeg.\n"
                          "It is kept for a future Ultra account where the extend models are available.",
                  style="Hint.TLabel", justify="left").grid(row=8, column=1, columnspan=2,
                                                            sticky="w", padx=14, pady=(10, 6))

    # ── tab 2: agent mode ─────────────────────────────────────
    def build_agent_tab(self, f):
        pad = dict(padx=14, pady=5)
        f.columnconfigure(1, weight=1)
        r = 0

        # ---- the manual steps, stated up front -------------------------------
        manual = tk.Frame(f, bg="#2a2333")
        manual.grid(row=r, column=0, columnspan=3, sticky="ew", padx=10, pady=(10, 8))
        tk.Label(manual, text="Do these by hand once per project", bg="#2a2333", fg="#ffb86c",
                 font=("Segoe UI", 10, "bold"), anchor="w").pack(fill="x", padx=10, pady=(8, 2))
        tk.Label(manual, justify="left", anchor="w", bg="#2a2333", fg="#d8d0e0", font=("Segoe UI", 9),
                 text=("0. Start the automation browser: double-click START_CHROME_CDP.bat, and check you are\n"
                       "   signed into Google Flow in the window that opens (it uses its own profile).\n"
                       "1. Create the Flow project, and upload each character reference sheet as a Character,\n"
                       "   named exactly as the @mention will be (Mia, Daniel - capital first letter).\n"
                       "2. Open Agent instructions (the ✨ spark icon) and paste the character + style blocks.\n"
                       "3. Leave the browser ON the project home page - not the scene editor.\n"
                       "These are manual because they are one-time and a wrong value here poisons every\n"
                       "later stage silently. Everything below them is automated.")
                 ).pack(fill="x", padx=10, pady=(0, 10))
        r += 1

        ttk.Label(f, text="Story JSON:").grid(row=r, column=0, sticky="e", **pad)
        self.agent_story_var = tk.StringVar(value=self.settings["story_json"])
        ttk.Entry(f, textvariable=self.agent_story_var, width=58).grid(row=r, column=1, sticky="w", **pad)
        ttk.Button(f, text="Browse…", command=self.browse_story).grid(row=r, column=2, padx=6)
        r += 1

        self.agent_story_info = tk.StringVar(value="No story loaded")
        ttk.Label(f, textvariable=self.agent_story_info, style="Hint.TLabel").grid(
            row=r, column=1, columnspan=2, sticky="w", padx=14)
        r += 1

        ttk.Label(f, text="Project URL:").grid(row=r, column=0, sticky="e", **pad)
        self.agent_url_var = tk.StringVar(value=self.settings["project_url"])
        ttk.Entry(f, textvariable=self.agent_url_var, width=58).grid(row=r, column=1, columnspan=2, sticky="w", **pad)
        r += 1

        ttk.Label(f, text="Model hint:").grid(row=r, column=0, sticky="e", **pad)
        self.model_var = tk.StringVar(value=self.settings["model_hint"])
        ttk.Entry(f, textvariable=self.model_var, width=34).grid(row=r, column=1, sticky="w", **pad)
        ttk.Label(f, text="plain English - Agent Mode has no model menu", style="Hint.TLabel").grid(
            row=r, column=1, sticky="w", padx=(290, 14))
        r += 1

        # Style presets. Read-only on purpose: each entry is an id that styles.js
        # looks up, so a typed-in near-miss would fail in a console the user is
        # not watching. styles.json is the menu; the button applies one.
        ttk.Label(f, text="Style preset:").grid(row=r, column=0, sticky="e", **pad)
        sty = tk.Frame(f, bg="#1e1e28")
        sty.grid(row=r, column=1, columnspan=2, sticky="w", padx=14)
        self._style_displays, self._style_ids, self._style_by_display = load_style_presets()
        self.style_var = tk.StringVar()
        self.style_box = ttk.Combobox(sty, textvariable=self.style_var, width=44,
                                      values=self._style_displays, state="readonly")
        self.style_box.pack(side="left")
        self.style_apply = ttk.Button(sty, text="Apply to story", command=self.apply_style)
        self.style_apply.pack(side="left", padx=(8, 0))
        if self._style_displays:
            want = self.settings.get("style_preset") or ""
            for disp, sid in self._style_ids.items():
                if sid == want:
                    self.style_var.set(disp)
                    break
        else:
            self.style_box.configure(values=["styles.json missing or empty"])
            self.style_var.set("styles.json missing or empty")
            self.style_apply.state(["disabled"])
        r += 1

        ttk.Label(f, text="rewrites the story's style field - the words the agent is told to render in",
                  style="Hint.TLabel").grid(row=r, column=1, columnspan=2, sticky="w", padx=14, pady=(0, 4))
        r += 1

        # The format is asked for in words because there is no panel to set it in.
        # Combobox left editable rather than readonly: the builder passes an
        # unrecognised ratio through as written, so a ratio Flow adds later can be
        # typed here without waiting for this list to learn about it.
        ttk.Label(f, text="Clip format:").grid(row=r, column=0, sticky="e", **pad)
        fmt = tk.Frame(f, bg="#1e1e28")
        fmt.grid(row=r, column=1, columnspan=2, sticky="w", padx=14)
        self.aspect_var = tk.StringVar(value=self.settings["aspect_ratio"])
        ttk.Combobox(fmt, textvariable=self.aspect_var, width=7,
                     values=["16:9", "9:16", "1:1"]).pack(side="left")
        ttk.Label(fmt, text="aspect", style="Hint.TLabel").pack(side="left", padx=(6, 18))
        self.seconds_var = tk.IntVar(value=self.settings["scene_seconds"])
        ttk.Spinbox(fmt, from_=1, to=8, textvariable=self.seconds_var, width=5).pack(side="left")
        ttk.Label(fmt, text="seconds per clip", style="Hint.TLabel").pack(side="left", padx=(6, 0))
        r += 1

        ttk.Label(f, text="stated in the prompt - a story JSON carrying its own values fills these in",
                  style="Hint.TLabel").grid(row=r, column=1, columnspan=2, sticky="w", padx=14, pady=(0, 4))
        r += 1

        ttk.Label(f, text="Chrome CDP port:").grid(row=r, column=0, sticky="e", **pad)
        self.agent_cdp_var = tk.IntVar(value=self.settings["cdp_port"])
        ttk.Spinbox(f, from_=1024, to=65535, textvariable=self.agent_cdp_var, width=8).grid(
            row=r, column=1, sticky="w", **pad)
        r += 1

        ttk.Label(f, text="Watch (seconds):").grid(row=r, column=0, sticky="e", **pad)
        self.watch_var = tk.IntVar(value=self.settings["watch_secs"])
        ttk.Spinbox(f, from_=30, to=3600, textvariable=self.watch_var, width=8).grid(
            row=r, column=1, sticky="w", **pad)
        ttk.Label(f, text="how long to record after submitting", style="Hint.TLabel").grid(
            row=r, column=1, sticky="w", padx=(120, 14))
        r += 1

        self.auto_approve_var = tk.BooleanVar(value=self.settings["auto_approve"])
        ttk.Checkbutton(f, text="Auto-approve the storyboard (⚠ SPENDS CREDITS)",
                        variable=self.auto_approve_var).grid(row=r, column=1, sticky="w", **pad)
        r += 1

        self.no_submit_var = tk.BooleanVar(value=self.settings["no_submit"])
        ttk.Checkbutton(f, text="Dry run - type the prompt but do NOT submit (safety default)",
                        variable=self.no_submit_var).grid(row=r, column=1, sticky="w", **pad)
        r += 1

        # ---- stages ----------------------------------------------------------
        ttk.Separator(f, orient="horizontal").grid(row=r, column=0, columnspan=3, sticky="ew", padx=10, pady=8)
        r += 1

        stages = tk.Frame(f, bg="#1e1e28")
        stages.grid(row=r, column=0, columnspan=3, sticky="w", padx=12, pady=2)
        r += 1

        def stage(parent, col, num, title, sub, cmd):
            box = tk.Frame(parent, bg="#1e1e28")
            box.grid(row=0, column=col, sticky="n", padx=(0, 14))
            ttk.Label(box, text=f"{num}. {title}", style="Step.TLabel").pack(anchor="w")
            ttk.Label(box, text=sub, style="Hint.TLabel", justify="left", wraplength=170).pack(anchor="w", pady=(0, 4))
            ttk.Button(box, text="Run", command=cmd, width=20).pack(anchor="w")

        stage(stages, 0, "1", "Build prompt", "story JSON →\nagent_prompt.txt", self.build_prompt)
        stage(stages, 1, "2", "Run agent", "type prompt, attach\nmentions, submit", self.run_agent)
        stage(stages, 2, "3", "Download clips", "pull clips out\nof Flow", self.download_clips)
        stage(stages, 3, "4", "Join clips", "ffmpeg concat →\none final mp4", self.join_clips)
        stage(stages, 4, "?", "Check order", "rebuild the contact\nsheet, no browser", self.check_order)

        r += 1
        ttk.Separator(f, orient="horizontal").grid(row=r, column=0, columnspan=3, sticky="ew", padx=10, pady=8)
        r += 1

        self.reverse_var = tk.BooleanVar(value=self.settings["reverse"])
        ttk.Checkbutton(f, text="Number clips oldest-first  (Flow's grid is newest-first — leave ON)",
                        variable=self.reverse_var).grid(
            row=r, column=0, columnspan=3, sticky="w", padx=14, pady=(0, 2))
        r += 1

        ttk.Label(f, text="Clips folder:").grid(row=r, column=0, sticky="e", **pad)
        self.clips_var = tk.StringVar(value=self.settings["clips_dir"])
        ttk.Entry(f, textvariable=self.clips_var, width=58).grid(row=r, column=1, sticky="w", **pad)
        ttk.Button(f, text="Browse…", command=self.browse_clips).grid(row=r, column=2, padx=6)
        r += 1

        btns = tk.Frame(f, bg="#1e1e28")
        btns.grid(row=r, column=1, columnspan=2, sticky="w", padx=14, pady=(2, 10))
        ttk.Button(btns, text="Open clips folder", command=self.open_clips).pack(side="left")
        ttk.Button(btns, text="⬜  Kill engine", command=self.kill_engine).pack(side="left", padx=10)
        ttk.Label(btns, text="stage 3 defaults to the story folder /clips",
                  style="Hint.TLabel").pack(side="left", padx=8)

    # ── actions ───────────────────────────────────────────────
    def browse_story(self):
        start = self.story_var.get() or STORIES_DIR
        p = filedialog.askopenfilename(initialdir=start, filetypes=[("Story JSON", "*.json")])
        if p:
            # Both tabs point at the same story; keeping them in sync avoids the
            # classic bug of building the prompt for one story and running another.
            self.story_var.set(p)
            self.agent_story_var.set(p)
            self.load_story_info()

    def browse_clips(self):
        p = filedialog.askdirectory(initialdir=self.clips_var.get() or BASE_DIR)
        if p:
            self.clips_var.set(p)

    def open_clips(self):
        d = self.clips_var.get().strip()
        if d and os.path.isdir(d):
            self._open_dir(d)
        else:
            messagebox.showinfo("No folder", "Pick a clips folder first.")

    def _open_dir(self, d):
        if d and os.path.isdir(d):
            os.startfile(d)
        else:
            messagebox.showinfo("No folder", f"Not found:\n{d}")

    def _story_path(self):
        """Prefer whichever tab is on screen, so RUN uses what the user sees.

        Compares the selected tab to the Agent frame rather than testing its
        index, which stopped being 1 the moment a tab was added in front of it.
        """
        if self.nb.select() == str(self.agent_tab):
            return self.agent_story_var.get().strip()
        return self.story_var.get().strip()

    def load_story_info(self):
        for p, var in ((self.story_var.get(), self.story_info),
                       (self.agent_story_var.get(), self.agent_story_info)):
            if not p or not os.path.exists(p):
                var.set("No story loaded")
                continue
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                n = len(data.get("scenes", []))
                # character_references is the ingredients shape; scenes[].characters
                # is what the Agent prompt derives its @mentions from. Show both,
                # because a story can have one and not the other.
                chars = ", ".join((data.get("character_references") or {}).keys())
                if not chars:
                    seen = []
                    for sc in data.get("scenes", []):
                        for c in (sc.get("characters") or []):
                            if c not in seen:
                                seen.append(c)
                    chars = ", ".join(seen)
                var.set(f"{n} scenes | characters: {chars or '-'}")
                if p == self.story_var.get():
                    self.to_var.set(n)
                if p == self.agent_story_var.get():
                    # A story JSON may carry its own clip format, and the builder
                    # prefers it. Load it into the controls so the fields show what
                    # the prompt will actually say - otherwise they read 16:9 while
                    # the prompt emits 9:16, and nothing on screen says so.
                    if data.get("aspect_ratio"):
                        self.aspect_var.set(str(data["aspect_ratio"]))
                    try:
                        if data.get("scene_seconds"):
                            self.seconds_var.set(int(data["scene_seconds"]))
                    except (TypeError, ValueError):
                        pass
                    # Show which preset the story currently carries, when it is
                    # one of ours. A story can hold hand-written style text that
                    # matches no preset; then the dropdown is simply left as-is
                    # rather than being blanked, since the field is not the
                    # story's only style - only the one this tool can name.
                    cur = str(data.get("style") or "")
                    if cur:
                        for disp, style in self._style_by_display.items():
                            if style and style == cur:
                                self.style_var.set(disp)
                                break
            except Exception as e:
                var.set(f"⚠️ Could not parse: {e}")

    def collect_inputs(self):
        self.settings.update({
            "story_json": self.story_var.get().strip(),
            "from_scene": self.read_int(self.from_var, 1),
            "to_scene": self.read_int(self.to_var, 5),
            "skip_refs": bool(self.skip_refs_var.get()),
            "project_url": self.url_var.get().strip(),
            "cdp_port": self.read_int(self.cdp_var, 9222),
            "model_hint": self.model_var.get().strip(),
            "auto_approve": bool(self.auto_approve_var.get()),
            "no_submit": bool(self.no_submit_var.get()),
            "watch_secs": self.read_int(self.watch_var, 300),
            "clips_dir": self.resolved_clips_dir(),
            "reverse": bool(self.reverse_var.get()),
            "aspect_ratio": self.aspect_var.get().strip() or "16:9",
            "scene_seconds": self.read_seconds(),
            "style_preset": self._style_ids.get(self.style_var.get(), ""),
            # script tab
            "gen_detail": self.gen_detail.get("1.0", "end").strip(),
            "gen_duration": self.read_int(self.gen_duration_var, 56),
            "gen_scene_seconds": self.read_int(self.gen_seconds_var, 8),
            "gen_aspect_ratio": self.gen_aspect_var.get().strip() or "16:9",
            "gen_preset": self._gen_ids.get(self.gen_preset_var.get(), ""),
            "gemini_model": self.gen_model_var.get().strip() or "gemini-3.6-flash",
            # Anything typed into the entry but not yet Added counts too, so a
            # key pasted and immediately used without pressing Add still works
            # rather than silently running with no key.
            "gemini_api_keys": self.effective_keys(),
            # Cleared: the list is now the only source. Leaving a stale single
            # key here would resurrect an old key the user had removed.
            "gemini_api_key": "",
        })

    def effective_keys(self):
        """The saved ring, plus a key sitting unadded in the entry box."""
        keys = [k for k in self.gen_keys if str(k).strip()]
        typed = self.gen_key_entry.get().strip()
        if typed and typed not in keys:
            keys.append(typed)
        return keys

    def read_int(self, var, default):
        """Read an IntVar, tolerating a half-typed or emptied spinbox.

        IntVar.get() raises TclError on an empty or non-numeric field, and
        collect_inputs() runs from save_settings() on every action and again on
        window close - so an unguarded read turns a moment of editing into a
        crash on exit. Falls back to the default silently, because collect_inputs
        is called from places where a dialog would be wrong.
        """
        try:
            return int(var.get())
        except (tk.TclError, ValueError):
            return default

    def read_seconds(self):
        """Seconds per clip. Same guard, plus the 1s floor."""
        return max(1, self.read_int(self.seconds_var, 8))

    def resolved_clips_dir(self):
        """The clips folder, with the story root redirected into a clips/ subfolder.

        Pointing this at the story folder itself scatters scene-*.mp4, manifest.json
        and _contact_sheet.jpg through the story directory, alongside the story JSON
        and character_refs - which is what happened on 2026-09-12. A story folder is
        identifiable because it holds the story JSON, so detect that rather than
        trusting the entry field.
        """
        d = self.clips_var.get().strip()
        story = self.agent_story_var.get().strip()
        if d and story:
            try:
                same = os.path.normcase(os.path.abspath(d)) == \
                       os.path.normcase(os.path.dirname(os.path.abspath(story)))
                if same:
                    return os.path.join(d, "clips")
            except Exception:
                pass
        return d

    # ── process launching ─────────────────────────────────────
    def _launch(self, cmd, what):
        """One place for the Popen dance - four stages share it."""
        if self.proc and self.proc.poll() is None:
            messagebox.showwarning("Busy", "A stage is already running. Wait, or kill it first.")
            return False
        self.output.delete("1.0", "end")
        self.output.insert("end", f"🚀 {what}\n\n")
        # chcp 65001 makes the new console render UTF-8 (emojis) correctly;
        # encoding="utf-8" fixes decoding of the engine's output into this panel.
        shell_cmd = "chcp 65001 >nul && " + subprocess.list2cmdline(cmd)
        try:
            self.proc = subprocess.Popen(
                shell_cmd, cwd=BASE_DIR,
                creationflags=subprocess.CREATE_NEW_CONSOLE,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                encoding="utf-8", bufsize=1, errors="replace", shell=True,
            )
        except Exception as e:
            messagebox.showerror("Failed to start", str(e))
            return False
        threading.Thread(target=self.stream_output, daemon=True).start()
        return True

    def run_engine(self):
        self.collect_inputs()
        story = self.settings["story_json"]
        if not story or not os.path.exists(story):
            messagebox.showerror("Missing story", "Pick a valid story JSON first.")
            return
        self.save_settings()
        cmd = ["node", ENGINE, story,
               "--from", str(self.settings["from_scene"]),
               "--to", str(self.settings["to_scene"]),
               "--cdp", str(self.settings["cdp_port"])]
        if self.settings["project_url"]:
            cmd += ["--project-url", self.settings["project_url"]]
        if self.settings["skip_refs"]:
            cmd += ["--skip-refs"]
        self._launch(cmd, "Starting the ingredients engine in a separate console...")

    # ── script tab actions ────────────────────────────────────
    def write_story(self, dry=False):
        """Generate a story package from the title, detail and preset.

        Nothing here touches Flow: it is text generation only, which is why it
        can be run freely. The images it asks for are still made by hand.
        """
        self.collect_inputs()
        title = self.gen_title_var.get().strip()
        if not title:
            messagebox.showerror("No title", "Give the video a title first.")
            return
        pid = self._gen_ids.get(self.gen_preset_var.get())
        if not pid:
            messagebox.showinfo("Pick a preset", "Choose a style preset from the list first.")
            return
        # Saved before launching: write_story.js resolves the API key from
        # gui_settings.json itself, so the key never goes on a command line
        # where the process list could show it.
        self.save_settings()

        cmd = ["node", WRITER, "--title", title,
               "--duration", str(self.settings["gen_duration"]),
               "--seconds", str(self.settings["gen_scene_seconds"]),
               "--aspect", self.settings["gen_aspect_ratio"],
               "--preset", pid,
               "--model", self.settings["gemini_model"]]

        # Free text, and Windows mangles long multi-line arguments through cmd.
        detail = self.gen_detail.get("1.0", "end").strip()
        if detail:
            staged = os.path.join(BASE_DIR, "logs", "_gen_detail.txt")
            try:
                os.makedirs(os.path.dirname(staged), exist_ok=True)
                with open(staged, "w", encoding="utf-8") as fh:
                    fh.write(detail)
                cmd += ["--detail-file", staged]
            except Exception as e:
                messagebox.showerror("Could not stage the detail text", str(e))
                return

        if dry:
            cmd += ["--dry-run"]
            self._launch(cmd, f"Building the prompts for '{title}' - nothing is sent...")
        else:
            if not self.settings["gemini_api_keys"]:
                messagebox.showerror("No API key",
                                     "Add at least one Gemini API key on this tab first.\n"
                                     "They are saved to gui_settings.json, which is gitignored.")
                return
            self._launch(cmd, f"Writing '{title}' with {self.settings['gemini_model']}...")

    def list_models(self):
        """Fill the model dropdown from what this key can actually use.

        Runs synchronously and captured, rather than through _launch: the point
        is the list, and it belongs in the dropdown next to the field, not in a
        console the user has to copy out of. Listing costs nothing.
        """
        self.collect_inputs()
        if not self.settings["gemini_api_keys"]:
            messagebox.showerror("No API key", "Add at least one Gemini API key on this tab first.")
            return
        self.save_settings()
        self.output.delete("1.0", "end")
        self.output.insert("end", "Asking Gemini which models this key can use...\n\n")
        try:
            p = subprocess.run(["node", WRITER, "--list-models"], cwd=BASE_DIR,
                               capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=60, shell=False)
        except Exception as e:
            self.output.insert("end", f"Could not run the lister: {e}\n")
            return
        models = [ln.strip() for ln in (p.stdout or "").splitlines() if ln.strip()]
        if not models:
            self.output.insert("end", (p.stderr or "(no output)") + "\n")
            messagebox.showerror("Could not list models",
                                 (p.stderr or "No models came back.").strip()[:400])
            return
        self.gen_model_box.configure(values=models)
        # Keep whatever is selected if it survived; otherwise move to the first
        # entry rather than leaving a dead name in the box for the next run.
        if self.gen_model_var.get() not in models:
            self.output.insert("end",
                               f"⚠️  '{self.gen_model_var.get()}' is not on this list - "
                               f"it would fail.\n\n")
            self.gen_model_var.set(models[0])
        self.output.insert("end", f"{len(models)} models available. Picked: "
                                  f"{self.gen_model_var.get()}\n\n")
        for m in models:
            self.output.insert("end", f"  {m}\n")
        self.output.insert("end", "\nChoose one in the dropdown above.\n")

    # ── agent stages ──────────────────────────────────────────
    def apply_style(self):
        """Rewrite the story's style field from the chosen preset.

        This edits a file on disk, so it asks first and names the file. The tool
        only touches `style` - the character descriptions are left alone, and if
        they describe a different look styles.js prints a warning to the panel
        below rather than changing them, because rewriting a cast's identity text
        automatically would be worse than the mismatch.
        """
        self.collect_inputs()
        story = self.agent_story_var.get().strip()
        if not story or not os.path.exists(story):
            messagebox.showerror("Missing story", "Pick a valid story JSON first.")
            return
        sid = self._style_ids.get(self.style_var.get())
        if not sid:
            messagebox.showinfo("Pick a preset", "Choose a style preset from the list first.")
            return
        if not messagebox.askyesno(
                "Apply style preset",
                f"Rewrite the style field in:\n{os.path.basename(story)}\n\n"
                f"Preset:  {sid}\n\n"
                "Only the story's style field changes. Rebuild the prompt (stage 1) "
                "afterwards so the new look reaches the agent."):
            return
        self.save_settings()
        self._launch(["node", STYLES_TOOL, "--apply", story, sid],
                     f"Applying the '{sid}' style preset to the story JSON...")

    def build_prompt(self):
        self.collect_inputs()
        story = self.agent_story_var.get().strip()
        if not story or not os.path.exists(story):
            messagebox.showerror("Missing story", "Pick a valid story JSON first.")
            return
        self.save_settings()
        self._launch(["node", PROMPT_BUILDER, story,
                      "--aspect", self.settings["aspect_ratio"],
                      "--seconds", str(self.settings["scene_seconds"])],
                     "Building agent_prompt.txt from the story JSON...")

    def run_agent(self):
        self.collect_inputs()
        story = self.agent_story_var.get().strip()
        if not story or not os.path.exists(story):
            messagebox.showerror("Missing story", "Pick a valid story JSON first.")
            return
        # Stage 1 is a prerequisite, not an optional extra: this file is what
        # agent_mode.js types, and an earlier run's copy may be stale or gone.
        # Refuse rather than submit last time's prompt.
        prompt_file = os.path.join(os.path.dirname(story), "agent_prompt.txt")
        if not os.path.exists(prompt_file):
            messagebox.showerror("No prompt file",
                                 f"{prompt_file} does not exist.\n\nRun stage 1 (Build prompt) first.")
            return
        self.save_settings()
        cmd = ["node", AGENT_ENGINE, "--file", prompt_file,
               "--cdp", str(self.settings["cdp_port"]),
               "--watch", str(self.settings["watch_secs"])]
        if self.settings["model_hint"]:
            cmd += ["--model", self.settings["model_hint"]]
        if self.settings["auto_approve"]:
            cmd += ["--auto-approve"]
        if self.settings["no_submit"]:
            cmd += ["--no-submit"]
        self._launch(cmd, "Running the Agent Mode driver (dry run is ON by default)...")

    def download_clips(self):
        self.collect_inputs()
        out = self.settings["clips_dir"]
        if not out:
            story = self.agent_story_var.get().strip()
            if story:
                out = os.path.join(os.path.dirname(story), "clips")
        if not out:
            messagebox.showerror("No output folder", "Pick a clips folder first.")
            return
        self.clips_var.set(out)
        self.save_settings()
        cmd = ["node", DOWNLOADER, "--out", out, "--cdp", str(self.settings["cdp_port"])]
        if self.settings.get("reverse", True):
            # Flow lists newest-first, so without this scene 7 is written as
            # scene-01.mp4 and the join runs the story backwards.
            cmd.append("--reverse")
        self._launch(cmd, f"Downloading clips from Flow into {out} ...")

    def join_clips(self):
        self.collect_inputs()
        d = self.settings["clips_dir"]
        if not d or not os.path.isdir(d):
            messagebox.showerror("No clips folder", "Pick the folder holding the downloaded clips.")
            return
        self.save_settings()
        # No --reencode: join_clips.js checks the stream signatures and only
        # re-encodes when the clips actually differ. Passing it here would force
        # a slow encode on every run, including the ones that need nothing.
        self._launch(["node", JOINER, d], "Joining the clips with ffmpeg...")

    def check_order(self):
        """Rebuild the contact sheet so the join order can be eyeballed.

        Reads manifest.json, so the sheet numbers the clips in the SAME order
        join_clips.js will use - which is the point. Needs no browser and no
        credits, so it is safe to run as often as you like.
        """
        self.collect_inputs()
        d = self.settings["clips_dir"]
        if not d or not os.path.isdir(d):
            messagebox.showerror("No clips folder", "Pick the folder holding the downloaded clips.")
            return
        self.save_settings()
        self._launch(["node", DOWNLOADER, "--sheet-only", d],
                     "Rebuilding the contact sheet from the clips on disk...")

    def stream_output(self):
        try:
            for line in self.proc.stdout:
                self.output.insert("end", line)
                self.output.see("end")
        except Exception:
            pass
        code = self.proc.wait()
        self.output.insert("end", f"\n[exited with code {code}]\n")
        self.output.see("end")

    def kill_engine(self):
        if self.proc and self.proc.poll() is None:
            self.proc.kill()
            self.output.insert("end", "\n🛑 Killed.\n")

    def on_close(self):
        self.save_settings()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = Veo3LauncherGUI(root)
    root.mainloop()
