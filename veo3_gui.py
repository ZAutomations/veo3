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
import time
import urllib.request
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(BASE_DIR, "veo3_flow_new_ui.js")
AGENT_ENGINE = os.path.join(BASE_DIR, "agent_mode.js")

# The video models Flow offers under Settings > Video generation default. This
# list only fills the dropdown - whatever is in the box is passed through as
# typed, so a model Flow ships later can be entered by hand without waiting for
# this list to learn about it. "Flow" means leave the project's own setting alone.
#
# Read off a live Flow menu by probe_models.js on 2026-09-22. Note "Veo 3.1 -
# Lite" and "Veo 3.1 - Lite [Lower Priority]" are two separate entries that
# differ only by the bracket, which is why the picker matches on the full loose
# name rather than a prefix.
VIDEO_MODELS = [
    "Flow",
    "Omni 1.1 Flash",
    "Veo 3.1 - Lite",
    "Veo 3.1 - Fast",
    "Veo 3.1 - Quality",
    "Veo 3.1 - Lite [Lower Priority]",
]
PROMPT_BUILDER = os.path.join(BASE_DIR, "story_to_agent_prompt.js")
STYLES_TOOL = os.path.join(BASE_DIR, "styles.js")
STYLES_FILE = os.path.join(BASE_DIR, "styles.json")
# The second preset list, toggled between with the "List:" dropdown next to every
# preset picker. Classic is styles.json; GENAI Presets is genai_styles.json.
GENAI_STYLES_FILE = os.path.join(BASE_DIR, "genai_styles.json")
PRESET_GROUPS = ["Classic", "GENAI Presets"]
WRITER = os.path.join(BASE_DIR, "write_story.js")
DOWNLOADER = os.path.join(BASE_DIR, "agent_download.js")
JOINER = os.path.join(BASE_DIR, "join_clips.js")
SETTINGS_FILE = os.path.join(BASE_DIR, "gui_settings.json")
ACCOUNT_MGR = os.path.join(BASE_DIR, "account_manager.js")
ACCOUNTS_FILE = os.path.join(BASE_DIR, "accounts.json")
STORIES_DIR = os.path.join(BASE_DIR, "stories")
MCP_SERVER = os.path.join(BASE_DIR, "mcp_server.js")


def read_xlsx_rows(path):
    """Read the first worksheet of an .xlsx with no third-party package.

    An .xlsx is a zip of XML: shared strings, then one sheet whose cells
    reference them. That is all a batch-import needs, so the GUI stays
    dependency-free rather than pulling in openpyxl just to read two columns.
    Returns a list of rows, each a list of cell strings.
    """
    import zipfile
    import re as _re
    import xml.etree.ElementTree as ET

    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        shared = []
        if "xl/sharedStrings.xml" in names:
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{ns}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{ns}t")))
        sheets = sorted(n for n in names
                        if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
        if not sheets:
            return []
        root = ET.fromstring(z.read(sheets[0]))
        rows = []
        for row in root.iter(f"{ns}row"):
            cells = {}
            for c in row.findall(f"{ns}c"):
                col = _re.match(r"[A-Z]+", c.get("r") or "") or None
                col = col.group(0) if col else "A"
                t = c.get("t")
                v = c.find(f"{ns}v")
                inline = c.find(f"{ns}is")
                if t == "s" and v is not None and v.text is not None:
                    idx = int(v.text)
                    val = shared[idx] if 0 <= idx < len(shared) else ""
                elif t == "inlineStr" and inline is not None:
                    val = "".join(x.text or "" for x in inline.iter(f"{ns}t"))
                elif v is not None:
                    val = v.text or ""
                else:
                    val = ""
                cells[col] = str(val).strip()
            if cells:
                ordered = sorted(cells.keys(), key=lambda k: (len(k), k))
                rows.append([cells[k] for k in ordered])
        return rows

# ── palette ─────────────────────────────────────────────────────
# Every colour the GUI paints with, in one place, so the scheme can be
# retuned without touching layout code. Studio-dark: a near-black base,
# panels one step lighter, recessed input fields darker still, one green
# accent for the action each panel exists for, amber only for warnings.
BG        = "#14141c"   # the window behind everything
SURFACE   = "#1b1b26"   # tab panels and frames
CARD      = "#222230"   # callout boxes (the manual-steps cards)
INPUT     = "#101018"   # recessed fields: entries, text boxes, the console
BORDER    = "#2e2e3e"   # hairlines and card edges
TEXT      = "#e8e8f2"
TEXT_DIM  = "#9a9ab2"
ACCENT    = "#7ee787"
ACCENT_DK = "#5ecf70"   # accent pressed/hover
ACCENT_BG = "#22352b"   # accent-tinted selection backgrounds
WARN      = "#ffb86c"
CONSOLE_FG = "#c7f0c7"  # terminal-green engine output
PRESET_BG = "#c0392b"   # the style-preset dropdowns: red field, white text

DEFAULTS = {
    "story_json": "",
    "from_scene": 1,
    "to_scene": 5,
    "skip_refs": False,
    "project_url": "",
    "cdp_port": 9222,
    # Credit pool: continue a story on the next Google account when the
    # active one runs out of monthly Veo credits.
    "auto_rotate": True,
    # Agent Mode
    "model_hint": "veo3.1 low priority",
    "auto_approve": False,
    "no_submit": True,
    "watch_secs": 300,
    "clips_dir": "",
    # ---- MCP tab ----
    "mcp_links": "",
    "mcp_ideas": "",
    "mcp_preset": "",
    "mcp_seconds": 8,
    "mcp_clips": 8,
    # ON: a pasted video link decides the length - the film is written to the
    # reference's own duration and "clips (min)" is ignored. OFF: the clips box
    # is a hard limit for every preset.
    "mcp_match_ref": True,
    "mcp_aspect": "9:16",
    # Its own copy of the video model, not shared with the Agent tab: a batch
    # builds its own projects and can want a different model from a one-off agent
    # run, and sharing the two would silently rewrite the other tab's choice.
    "mcp_video_model": "Flow",
    "mcp_generate": False,
    "mcp_download": True,
    "mcp_join": True,
    "mcp_new_project": True,
    "mcp_generate_refs": True,
    "mcp_auto_approve": True,
    "mcp_verbose": True,
    "mcp_from": 1,
    "mcp_to": 0,
    "mcp_last_dir": "",
    # Console pane width in px, remembered between runs. 0 = never dragged
    # (use the default 20% share).
    "console_width": 0,
    # Clip format. The aspect ratio is set in Flow's own Settings menu (the tune
    # icon beside the prompt box), not by the prompt, so the default is "Flow":
    # the tool says nothing about the ratio and you pick it in Flow. A real ratio
    # can still be chosen here and it is written into the prompt.
    "aspect_ratio": "Flow",
    # The video model every project in this batch generates with. Flow stores this
    # per project and remembers the last model used, so a project opened for a new
    # film silently keeps whatever was picked last time - which is how a run ends
    # up on the wrong model with nothing on screen saying so. "Flow" means leave
    # the project's own setting alone, which is what every run did before.
    "video_model": "Flow",
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
    "gen_aspect_ratio": "Flow",
    "gen_scene_seconds": 8,
    "gen_preset": "relationship-dialogue",
    # Which preset list the pickers show: "Classic" (styles.json) or
    # "GENAI Presets" (genai_styles.json).
    "preset_group": "Classic",
    # Pinned, not "gemini-flash-latest": an alias changes the model under you
    # between runs with nothing on screen to say why. Google retired the previous
    # default within hours of this being written, so press "List models" and pick
    # from what your key can actually use - that list is the only source of truth.
    "gemini_model": "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash",
    # Lands in gui_settings.json, which is gitignored. Never logged or echoed.
    #
    # A list, not a single key. write_story.js walks it in order and moves to the
    # next one when a key reports itself out of quota, so one exhausted key does
    # not fail a story half-written. "gemini_api_key" is still read as a fallback
    # for settings files written before this existed.
    "gemini_api_keys": [],
}


def preset_file(group):
    """Which file a preset group reads from."""
    return GENAI_STYLES_FILE if str(group or "").lower().startswith("genai") else STYLES_FILE


def load_style_presets(group="Classic"):
    """Read a preset list into the dropdown data.

    Returns (displays, id_by_display, style_by_display, length_by_display). A
    preset is offered as "Label  [id]" - the label is what a person picks by,
    the id is what styles.js resolves. All of them come back empty if the file
    is missing or malformed, so the tab starts with a disabled button and a
    line saying why, instead of a menu of ids that every apply would reject.

    length_by_display only holds presets that declare `default_duration`. A
    genre with a specified running length (an animal kindness film is 60-90s)
    carries it here, so picking the preset fills the duration box rather than
    leaving the number in a README nobody reads.
    """
    try:
        with open(preset_file(group), "r", encoding="utf-8") as f:
            styles = json.load(f).get("styles") or []
    except Exception:
        return [], {}, {}, {}
    displays, id_by_display, style_by_display, length_by_display = [], {}, {}, {}
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
        want = s.get("default_duration")
        if isinstance(want, int) and want > 0:
            length_by_display[disp] = want
    return displays, id_by_display, style_by_display, length_by_display


class Veo3LauncherGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("VEO3 Flow Launcher")
        self.root.configure(bg=BG)

        self.settings = self.load_settings()
        self.build_style()
        self.build_ui()

        # Fit the default height to the screen: a fixed 760px window extends
        # past the taskbar on a small display and cuts off the output panel.
        # The tabs scroll anyway, but the first impression should be "it all
        # fits", not "where is the rest".
        h = min(760, self.root.winfo_screenheight() - 120)
        self.root.geometry(f"900x{h}")
        # Wide enough that the 20% console, the side-by-side option lines in
        # the Agent tab and the tab controls all stay usable; tabs scroll
        # vertically below this height.
        self.root.minsize(820, 440)

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
        """The whole look, in one method.

        Every colour comes from the palette constants at the top of the file.
        Studio-dark: near-black base, recessed input fields with a focus
        highlight, flat buttons, tabs that read as connected to their panel,
        one green accent reserved for the action a panel exists for.
        """
        style = ttk.Style()
        style.theme_use("clam")

        style.configure("TFrame", background=SURFACE)
        style.configure("TLabel", background=SURFACE, foreground=TEXT,
                        font=("Segoe UI", 10))
        style.configure("Hint.TLabel", foreground=TEXT_DIM, font=("Segoe UI", 9))
        style.configure("Warn.TLabel", foreground=WARN, font=("Segoe UI", 9))
        style.configure("Step.TLabel", foreground=TEXT, font=("Segoe UI", 10, "bold"))
        style.configure("Console.TLabel", foreground=TEXT_DIM,
                        font=("Segoe UI", 8, "bold"))

        # Progress for the running generation. clam draws a trough plus a bar
        # with a border, so both colours have to be set or it renders as the
        # default blue-grey slab against the dark panel.
        style.configure("Engine.Horizontal.TProgressbar",
                        troughcolor=INPUT, background=ACCENT,
                        bordercolor=BORDER, lightcolor=ACCENT, darkcolor=ACCENT_DK,
                        borderwidth=0, thickness=8)

        # Tabs sit on the window background; the selected one adopts the
        # panel colour so it reads as part of the content below it.
        style.configure("TNotebook", background=BG, borderwidth=0,
                        tabmargins=(10, 8, 10, 0))
        style.configure("TNotebook.Tab", background=BG, foreground=TEXT_DIM,
                        padding=(18, 9), font=("Segoe UI", 10, "bold"), borderwidth=0)
        # The selected tab must sit BIGGER than its neighbours, not smaller.
        # clam's own style map swaps the configured padding for its tiny
        # default ("6 4 6 2") the moment a tab is selected, which collapsed
        # the open tab - the padding map here is not cosmetic, it overrides
        # that and makes the selected tab sit taller.
        style.map("TNotebook.Tab",
                  padding=[("selected", (18, 12))],
                  background=[("selected", SURFACE)],
                  foreground=[("selected", ACCENT), ("active", TEXT)])

        # Flat secondary buttons: quiet surface colour, lighten on hover,
        # accent focus ring only when keyboard-navigating.
        style.configure("TButton", font=("Segoe UI", 10, "bold"), padding=(10, 6),
                        background=CARD, foreground=TEXT, borderwidth=0,
                        lightcolor=CARD, darkcolor=CARD, bordercolor=CARD,
                        focusthickness=1, focuscolor=CARD)
        style.map("TButton",
                  background=[("pressed", BORDER), ("active", "#2b2b3b")],
                  focuscolor=[("active", ACCENT)])
        # The accent fill marks a Run button: Write story, Run engine, and the
        # five stage buttons in Agent Mode. Everything secondary stays flat.
        style.configure("Accent.TButton", background=ACCENT, foreground="#0d1a12",
                        borderwidth=0, lightcolor=ACCENT, darkcolor=ACCENT,
                        bordercolor=ACCENT, padding=(12, 6))
        style.map("Accent.TButton",
                  background=[("pressed", ACCENT_DK), ("active", ACCENT_DK)],
                  lightcolor=[("pressed", ACCENT_DK), ("active", ACCENT_DK)],
                  darkcolor=[("pressed", ACCENT_DK), ("active", ACCENT_DK)])

        style.configure("TCheckbutton", background=SURFACE, foreground=TEXT,
                        font=("Segoe UI", 10), focuscolor=SURFACE,
                        indicatorcolor=BORDER)
        style.map("TCheckbutton",
                  background=[("active", SURFACE)],
                  indicatorcolor=[("selected", ACCENT)])

        # Recessed fields: darker than their panel, with a border that picks
        # up the accent when focused - the standard cue for "type here".
        for w in ("TEntry", "TCombobox", "TSpinbox"):
            style.configure(w, fieldbackground=INPUT, foreground=TEXT,
                            insertcolor=TEXT, bordercolor=BORDER,
                            lightcolor=BORDER, darkcolor=BORDER, padding=4)
            style.map(w, bordercolor=[("focus", ACCENT)])
        style.configure("TCombobox", arrowcolor=TEXT_DIM, arrowsize=11)
        style.configure("TSpinbox", arrowcolor=TEXT_DIM, arrowsize=11)
        # The combobox dropdown is a plain tk Listbox: it ignores ttk styles
        # and reads the option database instead.
        self.root.option_add("*TCombobox*Listbox.background", INPUT)
        self.root.option_add("*TCombobox*Listbox.foreground", TEXT)
        self.root.option_add("*TCombobox*Listbox.selectBackground", ACCENT_BG)
        self.root.option_add("*TCombobox*Listbox.selectForeground", TEXT)

        # The style-preset dropdowns get their own look: a red field with
        # white text, so they read at a glance even when empty. clam's
        # default style map paints a readonly combobox field white, which
        # is why these cannot just take the shared field styling.
        style.configure("Preset.TCombobox", fieldbackground=PRESET_BG,
                        foreground="#ffffff", bordercolor=BORDER,
                        lightcolor=BORDER, darkcolor=BORDER, padding=4,
                        arrowcolor="#ffffff")
        style.map("Preset.TCombobox",
                  fieldbackground=[("readonly", PRESET_BG), ("active", PRESET_BG)],
                  foreground=[("readonly", "#ffffff")],
                  bordercolor=[("focus", ACCENT)])

        style.configure("TSeparator", background=BORDER)
        style.configure("Vertical.TScrollbar", background=SURFACE, troughcolor=BG,
                        borderwidth=0, arrowsize=12, lightcolor=SURFACE,
                        darkcolor=SURFACE)
        style.map("Vertical.TScrollbar", background=[("active", CARD)])

    # ── ui ────────────────────────────────────────────────────
    def build_ui(self):
        # Title row: the app name in the accent colour, a one-line purpose in
        # dim text, over a hairline - everything below is working surface.
        head = tk.Frame(self.root, bg=BG)
        head.grid(row=0, column=0, columnspan=2, sticky="ew", padx=16, pady=(12, 0))
        tk.Label(head, text="VEO3 Flow Launcher", bg=BG, fg=ACCENT,
                 font=("Segoe UI", 15, "bold")).pack(side="left")
        tk.Label(head, text="script · ingredients · agent mode", bg=BG, fg=TEXT_DIM,
                 font=("Segoe UI", 10)).pack(side="left", padx=(12, 0), pady=(7, 0))
        ttk.Separator(self.root, orient="horizontal").grid(
            row=1, column=0, columnspan=2, sticky="ew", padx=14, pady=(10, 0))

        # Left column: the tabs - they take whatever the console leaves.
        self.nb = ttk.Notebook(self.root)
        self.nb.grid(row=2, column=0, sticky="nsew", padx=(14, 0), pady=(8, 10))

        # The splitter between tabs and console: drag it to widen or narrow
        # the console, double-click it to snap back to a 20% share. A thin
        # bar with a resize cursor that lights up while it is being dragged.
        sash = tk.Frame(self.root, width=6, bg=BORDER, cursor="sb_h_double_arrow")
        sash.grid(row=2, column=1, sticky="ns", padx=5, pady=(8, 10))

        # Right column: the shared output console, sized by the sash. Both
        # modes stream into one panel so a run is never half-visible in a
        # tab you are not looking at.
        outwrap = tk.Frame(self.root, bg=SURFACE)
        outwrap.grid(row=2, column=2, sticky="nsew", padx=(0, 14), pady=(8, 10))
        ttk.Label(outwrap, text="ENGINE OUTPUT", style="Console.TLabel").pack(
            anchor="w", pady=(0, 4))
        # Progress for the running generation, above the console rather than
        # in a tab so it is visible whichever tab you happen to be on. Flow
        # only sometimes exposes a real percentage, so this is the engine's
        # best number, real when available and an estimate when not.
        progwrap = tk.Frame(outwrap, bg=SURFACE)
        progwrap.pack(fill="x", pady=(0, 6))
        self.progress = ttk.Progressbar(progwrap, orient="horizontal",
                                        mode="determinate", maximum=100,
                                        style="Engine.Horizontal.TProgressbar")
        self.progress.pack(fill="x")
        self.progress_label = tk.Label(progwrap, text="idle", bg=SURFACE,
                                       fg=TEXT_DIM, font=("Segoe UI", 9), anchor="w")
        self.progress_label.pack(fill="x", pady=(3, 0))
        # width=1 keeps the Text's natural request tiny so the column's
        # minsize (set by the sash) is what actually decides the pane width.
        self.output = tk.Text(outwrap, width=1, bg=INPUT, fg=CONSOLE_FG,
                              insertbackground=TEXT, font=("Consolas", 9), wrap="word")
        sb = ttk.Scrollbar(outwrap, orient="vertical", command=self.output.yview)
        self.output.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.output.pack(side="left", fill="both", expand=True)
        self.output.insert("end", "Waiting to start...\n")

        # ---- dragging the console wider / narrower -------------------------
        MIN_CONSOLE, MAX_SHARE = 150, 0.75   # px floor, share-of-window ceiling

        def set_console_width(px):
            win = self.root.winfo_width()
            if win > 50:                    # not yet mapped - skip the ceiling
                px = min(px, int(win * MAX_SHARE))
            px = max(MIN_CONSOLE, px)
            self.root.columnconfigure(2, minsize=px)
            self.console_width = px
            return px

        def on_sash_press(e):
            sash.configure(bg=ACCENT)
            sash.grab_set()                 # keep the drag even past the bar

        def on_sash_drag(e):
            # The console's right edge sits 14px inside the window, so its
            # width is simply the pointer's distance from that edge.
            set_console_width(self.root.winfo_width()
                              - (e.x_root - self.root.winfo_rootx()) - 14)

        def on_sash_release(e):
            sash.configure(bg=BORDER)
            sash.grab_release()
            # remembered for the next run; save_settings writes it on close
            self.settings["console_width"] = self.console_width

        def on_sash_double(e):
            set_console_width(self.root.winfo_width() // 5)   # back to 20%

        sash.bind("<Button-1>", on_sash_press)
        sash.bind("<B1-Motion>", on_sash_drag)
        sash.bind("<ButtonRelease-1>", on_sash_release)
        sash.bind("<Double-Button-1>", on_sash_double)
        self.console_width = 180
        # start from the width the user left it at last time, else ~20%
        saved = int(self.settings.get("console_width") or 0)
        set_console_width(saved if saved >= MIN_CONSOLE else 180)

        # Each tab scrolls. The Script and Agent tabs hold more rows than a
        # small screen shows at once, and a cut-off options panel is unusable.
        # Which preset list every picker shows: Classic or GENAI Presets. One
        # shared variable, so switching it on any tab switches it everywhere.
        self.preset_group_var = tk.StringVar(value=self.settings.get("preset_group", "Classic"))
        if self.preset_group_var.get() not in PRESET_GROUPS:
            self.preset_group_var.set(PRESET_GROUPS[0])
        self.preset_group_var.trace_add("write", lambda *a: self.on_preset_group_change())
        self._tab_canvases = []
        scr_tab, scr = self.make_scrollable_tab()
        ing_tab, ing = self.make_scrollable_tab()
        agt_tab, agt = self.make_scrollable_tab()
        # Script first: it is where a video now starts. The ingredients path is
        # unchanged and still second.
        self.nb.add(scr_tab, text="Script")
        self.nb.add(ing_tab, text="Ingredients (extend)")
        self.nb.add(agt_tab, text="Agent Mode")
        self.agent_tab = agt_tab
        acc_tab, acc = self.make_scrollable_tab()
        self.nb.add(acc_tab, text="Accounts")
        mcp_tab, mcp = self.make_scrollable_tab()
        self.nb.add(mcp_tab, text="MCP")

        self.build_script_tab(scr)
        self.build_ingredients_tab(ing)
        self.build_agent_tab(agt)
        self.build_accounts_tab(acc)
        self.build_mcp_tab(mcp)
        # One binding for all three tabs - see _on_tab_wheel for why it is a
        # single bind_all rather than one binding per canvas.
        self.root.bind_all("<MouseWheel>", self._on_tab_wheel)

        # The tab column stretches with the window; the console column is
        # pinned by the sash (minsize), so dragging the sash resizes the
        # panes, and the console keeps its width when the window resizes.
        self.root.columnconfigure(0, weight=1)
        self.root.columnconfigure(1, weight=0)
        self.root.columnconfigure(2, weight=0)
        self.root.rowconfigure(2, weight=1)

        self.proc = None
        # Progress line state. The engine prints "[PROGRESS] pct=NN scene=N"
        # while a clip generates; stream_output runs on a reader thread, so the
        # value is stashed here and a single scheduled callback applies it on
        # the Tk thread. Without the pending flag a burst of progress lines
        # would queue one callback each and the UI would lag behind the run.
        self._pending_progress = None
        self._progress_scheduled = False
        # credit-pool state: which account's browser we last started,
        # how far the story got before a drain, and the continuation ctx.
        self._browser_account = None
        self._credits_scene = 0
        self._rotate_ctx = None
        self.load_story_info()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    # ── scrollable tabs ───────────────────────────────────────
    def make_scrollable_tab(self):
        """A notebook tab whose content scrolls vertically when it overflows.

        The tab is a canvas plus a scrollbar; the real content lives in a frame
        stretched to the canvas's width, so rows still expand with the window.
        Returns (tab, content): add `tab` to the notebook, build into `content`.
        """
        tab = ttk.Frame(self.nb)
        canvas = tk.Canvas(tab, bg=SURFACE, highlightthickness=0, borderwidth=0)
        sb = ttk.Scrollbar(tab, orient="vertical", command=canvas.yview)
        content = ttk.Frame(canvas)
        win = canvas.create_window((0, 0), window=content, anchor="nw")
        canvas.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)
        self._tab_canvases.append(canvas)

        # The scrollregion must follow the content's height, and the content
        # must follow the canvas's width - without the second bind, a widened
        # window leaves every row at its natural width with dead space beside.
        content.bind("<Configure>",
                     lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>",
                    lambda e: canvas.itemconfigure(win, width=canvas.winfo_width()))
        return tab, content

    def _on_tab_wheel(self, e):
        """Send the mouse wheel to the tab canvas under the pointer.

        Bound once with bind_all rather than once per canvas (bind_all on the
        same sequence replaces, so three of them would clobber each other). It
        fires wherever the pointer is, so it must stay out of the way of
        widgets that scroll themselves: the output panel and the detail box are
        Text, the key ring is a Listbox, and the comboboxes and spinboxes use
        the wheel to change their value.
        """
        if isinstance(e.widget, (tk.Text, tk.Listbox, ttk.Combobox,
                                 ttk.Spinbox, tk.Spinbox)):
            return
        x, y = e.x_root, e.y_root
        for canvas in self._tab_canvases:
            if not canvas.winfo_ismapped():
                continue
            if not (canvas.winfo_rootx() <= x < canvas.winfo_rootx() + canvas.winfo_width()
                    and canvas.winfo_rooty() <= y < canvas.winfo_rooty() + canvas.winfo_height()):
                continue
            # Content fits - nothing to scroll, and the window must not eat
            # the wheel event for nothing.
            if canvas.yview() == (0.0, 1.0):
                return
            lines = max(1, abs(e.delta) // 120)
            canvas.yview_scroll(-lines if e.delta > 0 else lines, "units")
            return

    # ── tab 0: script ─────────────────────────────────────────
    def build_accounts_tab(self, f):
        """Credit pool: one Chrome profile (and one Flow login) per Google
        account. The engine spends the active account until Flow refuses,
        then the story continues on the next account in a fresh project."""
        pad = {"padx": (14, 4), "pady": 4, "sticky": "w"}
        r = 0
        ttk.Label(f, text="Google accounts (Veo 3 credit pool)", style="Step.TLabel").grid(row=r, column=0, **pad); r += 1
        ttk.Label(f, style="Hint.TLabel", justify="left", text=(
            "Each account is its own Chrome profile with its own Flow login and its own\n"
            "monthly Veo credits. The tool spends one account at a time and, when it runs\n"
            "out, continues the story on the next account in a fresh Flow project - clips\n"
            "are exported per scene, so the final video still joins up.\n\n"
            "Add an account, press 'Sign in browser', and log that Google account into\n"
            "Flow once in the window that opens. It is remembered after that.")).grid(row=r, column=0, **pad); r += 1

        ttk.Label(f, text="Accounts", style="Step.TLabel").grid(row=r, column=0, **pad); r += 1
        style = ttk.Style(self.root)
        style.configure("Treeview", rowheight=24, background=INPUT,
                        fieldbackground=INPUT, foreground=TEXT, bordercolor=BORDER)
        style.configure("Treeview.Heading", background=SURFACE, foreground=TEXT_DIM,
                        bordercolor=BORDER, relief="flat")
        cols = ("label", "email", "clips", "status")
        self.acc_tree = ttk.Treeview(f, columns=cols, show="headings", height=9)
        for c, w, t in (("label", 150, "Account"), ("email", 190, "Email"),
                        ("clips", 100, "Clips/month"), ("status", 170, "Status")):
            self.acc_tree.heading(c, text=t)
            self.acc_tree.column(c, width=w, anchor="w")
        self.acc_tree.grid(row=r, column=0, padx=14, pady=4, sticky="we")
        f.columnconfigure(0, weight=1)
        r += 1

        row = ttk.Frame(f)
        row.grid(row=r, column=0, padx=14, pady=6, sticky="w"); r += 1
        ttk.Button(row, text="\u2795  Add", command=self.acc_add).pack(side="left")
        ttk.Button(row, text="\U0001F511  Sign in browser", command=self.acc_sign_in).pack(side="left", padx=(8, 0))
        ttk.Button(row, text="\u25B6  Set active", command=self.acc_set_active).pack(side="left", padx=(8, 0))
        ttk.Button(row, text="\u21BA  Reset counter", command=self.acc_reset).pack(side="left", padx=(8, 0))
        ttk.Button(row, text="\u23F8  Pause / Resume", command=self.acc_pause_toggle).pack(side="left", padx=(8, 0))
        ttk.Button(row, text="\U0001F5D1  Remove", command=self.acc_remove).pack(side="left", padx=(8, 0))

        self.auto_rotate_var = tk.BooleanVar(value=bool(self.settings.get("auto_rotate", True)))
        ttk.Checkbutton(f, variable=self.auto_rotate_var, text=(
            "Rotate automatically - when an account runs out of credits, the story\n"
            "continues on the next account (fresh Flow project) without asking")).grid(row=r, column=0, **pad); r += 1
        ttk.Label(f, text="Counters reset by themselves at the start of each month.",
                  style="Hint.TLabel").grid(row=r, column=0, **pad)
        self._refresh_accounts_list()

    # ── preset list toggle ────────────────────────────────────
    def on_preset_group_change(self, *_):
        """The List: dropdown was switched - repopulate every preset picker."""
        self.settings["preset_group"] = self.preset_group_var.get()
        self.refresh_preset_lists()

    def refresh_preset_lists(self):
        """Reload the Script, Agent and MCP preset pickers from the chosen list.

        A selection made in the other list no longer exists, so it falls back to
        the first entry rather than staying as a dead name the next run rejects.
        """
        group = self.preset_group_var.get()
        d, ids, _, lengths = load_style_presets(group)
        self._gen_displays, self._gen_ids, self._gen_lengths = d, ids, lengths
        self.gen_preset_box.configure(values=d or ["styles.json missing or empty"])
        if self.gen_preset_var.get() not in d:
            self.gen_preset_var.set(d[0] if d else "styles.json missing or empty")

        d2, ids2, bydisp2, _ = load_style_presets(group)
        self._style_displays, self._style_ids, self._style_by_display = d2, ids2, bydisp2
        self.style_box.configure(values=d2 or ["styles.json missing or empty"])
        if self.style_var.get() not in d2:
            self.style_var.set(d2[0] if d2 else "styles.json missing or empty")

        d3, ids3, bydisp3, _ = load_style_presets(group)
        self._mcp_displays, self._mcp_ids, self._mcp_by_display = d3, ids3, bydisp3
        self.mcp_preset_box.configure(values=d3 or ["styles.json missing or empty"])
        if self.mcp_preset_var.get() not in d3:
            self.mcp_preset_var.set(d3[0] if d3 else "styles.json missing or empty")

        try:
            self._console(f"Preset list: {group} - {len(d)} preset(s).")
        except Exception:
            pass

    def build_script_tab(self, f):
        pad = dict(padx=14, pady=5)
        f.columnconfigure(1, weight=1)
        r = 0

        tk.Label(f, justify="left", anchor="w", bg=CARD, fg=TEXT,
                 font=("Segoe UI", 9), highlightthickness=1, highlightbackground=BORDER,
                 text=("Write a whole story package from a title and a preset. Produces the story\n"
                       "JSON, a style bible, and paste-ready character-sheet prompts, in its own\n"
                       "folder under stories/. It writes NO video and spends NO Flow credits -\n"
                       "the images are still made by hand, then run through the Agent Mode stages.")
                 ).grid(row=r, column=0, columnspan=3, sticky="ew", padx=10, pady=(10, 8), ipady=6)
        r += 1

        ttk.Label(f, text="Video title:").grid(row=r, column=0, sticky="e", **pad)
        self.gen_title_var = tk.StringVar()
        ttk.Entry(f, textvariable=self.gen_title_var, width=58).grid(
            row=r, column=1, columnspan=2, sticky="ew", **pad)
        r += 1

        ttk.Label(f, text="Detail:").grid(row=r, column=0, sticky="ne", **pad)
        self.gen_detail = tk.Text(f, height=4, width=58, bg=INPUT, fg=TEXT,
                                  insertbackground=TEXT, wrap="word", font=("Segoe UI", 9))
        self.gen_detail.grid(row=r, column=1, columnspan=2, sticky="ew", **pad)
        self.gen_detail.insert("1.0", self.settings.get("gen_detail") or "")
        r += 1

        ttk.Label(f, text="a sentence or two - who, where, what changes. The model fills the rest",
                  style="Hint.TLabel").grid(row=r, column=1, columnspan=2, sticky="w", padx=14, pady=(0, 4))
        r += 1

        # Style preset - the same list the Agent tab applies after the fact. Here
        # it is an input: the story is written in this look from the first word,
        # rather than having the look bolted on once the text already disagrees.
        ttk.Label(f, text="Style preset:").grid(row=r, column=0, sticky="e", **pad)
        sty = tk.Frame(f, bg=SURFACE)
        sty.grid(row=r, column=1, columnspan=2, sticky="ew", padx=14)
        self._gen_displays, self._gen_ids, _, self._gen_lengths = load_style_presets()
        self.gen_preset_var = tk.StringVar()
        self.gen_preset_box = ttk.Combobox(sty, textvariable=self.gen_preset_var, width=44,
                                           values=self._gen_displays, state="readonly",
                                           style="Preset.TCombobox")
        self.gen_preset_box.pack(side="left")
        ttk.Button(sty, text="Manage…", command=self.open_styles_help).pack(side="left", padx=(8, 0))
        ttk.Label(sty, text="List:").pack(side="left", padx=(10, 4))
        self.gen_group_box = ttk.Combobox(sty, textvariable=self.preset_group_var, width=13,
                                          values=PRESET_GROUPS, state="readonly")
        self.gen_group_box.pack(side="left")
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
        fmt = tk.Frame(f, bg=SURFACE)
        fmt.grid(row=r, column=1, columnspan=2, sticky="ew", padx=14)
        self.gen_duration_var = tk.IntVar(value=self.settings.get("gen_duration", 56))
        ttk.Spinbox(fmt, from_=8, to=1200, increment=8, textvariable=self.gen_duration_var,
                    width=6).pack(side="left")
        ttk.Label(fmt, text="seconds total", style="Hint.TLabel").pack(side="left", padx=(6, 18))
        self.gen_seconds_var = tk.IntVar(value=self.settings.get("gen_scene_seconds", 8))
        ttk.Spinbox(fmt, from_=1, to=8, textvariable=self.gen_seconds_var,
                    width=4).pack(side="left")
        ttk.Label(fmt, text="sec per clip", style="Hint.TLabel").pack(side="left", padx=(6, 18))
        self.gen_aspect_var = tk.StringVar(value=self.settings.get("gen_aspect_ratio", "Flow"))
        ttk.Combobox(fmt, textvariable=self.gen_aspect_var, width=6,
                     values=["Flow", "16:9", "9:16", "1:1"]).pack(side="left")
        ttk.Label(fmt, text="aspect", style="Hint.TLabel").pack(side="left", padx=(6, 0))
        r += 1

        self.gen_count = tk.StringVar()
        ttk.Label(f, textvariable=self.gen_count, style="Hint.TLabel").grid(
            row=r, column=1, columnspan=2, sticky="w", padx=14, pady=(0, 4))
        for v in (self.gen_duration_var, self.gen_seconds_var):
            v.trace_add("write", lambda *a: self.update_gen_count())
        self.update_gen_count()
        # Bound here, after the saved duration was restored above. Binding it
        # earlier would fire while the preset box was being filled in and
        # overwrite the length you last chose every time the GUI opened.
        self.gen_preset_var.trace_add("write", self.follow_preset_length)
        r += 1

        ttk.Label(f, text="Gemini model:").grid(row=r, column=0, sticky="e", **pad)
        md = tk.Frame(f, bg=SURFACE)
        md.grid(row=r, column=1, columnspan=2, sticky="ew", padx=14)
        self.gen_model_var = tk.StringVar(value=self.settings.get("gemini_model", "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash"))
        # Editable, not readonly: "List models" fills it from the API, and the box
        # also accepts a CHAIN - "a,b,c" - which the writer walks newest-first when
        # a model is busy (503) or not on this key (404).
        self.gen_model_box = ttk.Combobox(md, textvariable=self.gen_model_var, width=46)
        self.gen_model_box.pack(side="left")
        ttk.Button(md, text="List models", command=self.list_models).pack(side="left", padx=(8, 0))
        ttk.Button(md, text="Flash chain", command=self.use_flash_chain).pack(side="left", padx=(6, 0))
        ttk.Label(md, text="one model, or a chain a,b,c - tried in order",
                  style="Hint.TLabel").pack(side="left", padx=(10, 0))
        r += 1

        ttk.Label(f, text="Gemini API keys:").grid(row=r, column=0, sticky="ne", **pad)
        kd = tk.Frame(f, bg=SURFACE)
        kd.grid(row=r, column=1, columnspan=2, sticky="ew", padx=14)

        # A list rather than one field: the point is to hold several and let the
        # writer fall through to the next when one runs dry. Kept as a Listbox of
        # masked keys so the order is visible and editable - the order IS the
        # fallback order.
        self.gen_keys = list(self.settings.get("gemini_api_keys") or [])
        legacy = (self.settings.get("gemini_api_key") or "").strip()
        if legacy and legacy not in self.gen_keys:
            self.gen_keys.insert(0, legacy)

        self.gen_key_list = tk.Listbox(kd, height=3, width=34, activestyle="none",
                                       bg=INPUT, fg=TEXT,
                                       selectbackground=ACCENT_BG, selectforeground=TEXT,
                                       highlightthickness=0, exportselection=False)
        self.gen_key_list.pack(side="left")

        kb = tk.Frame(kd, bg=SURFACE)
        kb.pack(side="left", padx=(8, 0), anchor="n")
        self.gen_key_entry = tk.StringVar()
        ttk.Entry(kb, textvariable=self.gen_key_entry, width=34, show="•").pack(anchor="w")
        e2 = tk.Frame(kb, bg=SURFACE)
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

        btns = tk.Frame(f, bg=SURFACE)
        btns.grid(row=r, column=1, columnspan=2, sticky="w", padx=14, pady=(10, 4))
        ttk.Button(btns, text="Write story", command=self.write_story, width=20,
                   style="Accent.TButton").pack(side="left")
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

    def follow_preset_length(self, *_):
        """Fill the duration box from the preset's own running length.

        Only presets that declare `default_duration` move it - a genre with a
        specified length (an animal kindness film runs 60-90s) carries that
        number, and every other preset leaves your duration exactly as it was.
        You can still edit the box afterwards; this only sets a starting point
        when you switch preset.
        """
        try:
            want = self._gen_lengths.get(self.gen_preset_var.get())
        except AttributeError:
            return
        if want:
            self.gen_duration_var.set(want)

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
        ttk.Entry(f, textvariable=self.story_var, width=58).grid(row=1, column=1, sticky="ew", **pad)
        ttk.Button(f, text="Browse…", command=self.browse_story).grid(row=1, column=2, **pad)

        self.story_info = tk.StringVar(value="No story loaded")
        ttk.Label(f, textvariable=self.story_info, style="Hint.TLabel").grid(
            row=2, column=1, columnspan=2, sticky="w", padx=14)

        ttk.Label(f, text="Scene range:").grid(row=3, column=0, sticky="e", **pad)
        rng = tk.Frame(f, bg=SURFACE)
        rng.grid(row=3, column=1, sticky="w", **pad)
        self.from_var = tk.IntVar(value=self.settings["from_scene"])
        self.to_var = tk.IntVar(value=self.settings["to_scene"])
        tk.Label(rng, text="From", bg=SURFACE, fg=TEXT).pack(side="left")
        ttk.Spinbox(rng, from_=1, to=99, textvariable=self.from_var, width=4).pack(side="left", padx=6)
        tk.Label(rng, text="To", bg=SURFACE, fg=TEXT).pack(side="left", padx=(14, 0))
        ttk.Spinbox(rng, from_=1, to=99, textvariable=self.to_var, width=4).pack(side="left", padx=6)

        ttk.Label(f, text="Project URL:").grid(row=4, column=0, sticky="e", **pad)
        self.url_var = tk.StringVar(value=self.settings["project_url"])
        ttk.Entry(f, textvariable=self.url_var, width=58).grid(row=4, column=1, columnspan=2, sticky="ew", **pad)

        ttk.Label(f, text="Chrome CDP port:").grid(row=5, column=0, sticky="e", **pad)
        self.cdp_var = tk.IntVar(value=self.settings["cdp_port"])
        ttk.Spinbox(f, from_=1024, to=65535, textvariable=self.cdp_var, width=8).grid(
            row=5, column=1, sticky="w", **pad)
        ttk.Label(f, text="(your logged-in Chrome - Profile 3)", style="Hint.TLabel").grid(
            row=5, column=1, sticky="w", padx=(120, 14), pady=6)

        self.skip_refs_var = tk.BooleanVar(value=self.settings["skip_refs"])
        ttk.Checkbutton(f, text="Skip refs upload (refs already in project)",
                        variable=self.skip_refs_var).grid(row=6, column=1, sticky="w", **pad)

        ttk.Button(f, text="▶  Run engine", command=self.run_engine,
                   style="Accent.TButton").grid(row=7, column=1, sticky="w", pady=(16, 4))
        ttk.Button(f, text="Stop engine", command=self.kill_engine).grid(
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
        manual = tk.Frame(f, bg=CARD, highlightthickness=1, highlightbackground=BORDER)
        manual.grid(row=r, column=0, columnspan=3, sticky="ew", padx=10, pady=(10, 8))
        tk.Label(manual, text="Do these by hand once per project", bg=CARD, fg=WARN,
                 font=("Segoe UI", 10, "bold"), anchor="w").pack(fill="x", padx=10, pady=(8, 2))
        tk.Label(manual, justify="left", anchor="w", bg=CARD, fg=TEXT, font=("Segoe UI", 9),
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
        ttk.Entry(f, textvariable=self.agent_story_var, width=58).grid(row=r, column=1, sticky="ew", **pad)
        ttk.Button(f, text="Browse…", command=self.browse_story).grid(row=r, column=2, padx=6)
        r += 1

        self.agent_story_info = tk.StringVar(value="No story loaded")
        ttk.Label(f, textvariable=self.agent_story_info, style="Hint.TLabel").grid(
            row=r, column=1, columnspan=2, sticky="w", padx=14)
        r += 1

        ttk.Label(f, text="Project URL:").grid(row=r, column=0, sticky="e", **pad)
        self.agent_url_var = tk.StringVar(value=self.settings["project_url"])
        ttk.Entry(f, textvariable=self.agent_url_var, width=58).grid(row=r, column=1, columnspan=2, sticky="ew", **pad)
        r += 1

        # Model hint and Style preset share one line - the tab is long enough
        # already. Same widgets as before, packed side by side.
        line1 = tk.Frame(f, bg=SURFACE)
        line1.grid(row=r, column=0, columnspan=3, sticky="ew", padx=14, pady=5)
        ttk.Label(line1, text="Model hint:").pack(side="left")
        self.model_var = tk.StringVar(value=self.settings["model_hint"])
        ttk.Entry(line1, textvariable=self.model_var, width=22).pack(side="left", padx=(6, 20))
        ttk.Label(line1, text="Style preset:").pack(side="left")
        # Style presets. Read-only on purpose: each entry is an id that styles.js
        # looks up, so a typed-in near-miss would fail in a console the user is
        # not watching. styles.json is the menu; the button applies one.
        self._style_displays, self._style_ids, self._style_by_display, _ = load_style_presets()
        self.style_var = tk.StringVar()
        self.style_box = ttk.Combobox(line1, textvariable=self.style_var, width=28,
                                      values=self._style_displays, state="readonly",
                                      style="Preset.TCombobox")
        self.style_box.pack(side="left")
        self.style_apply = ttk.Button(line1, text="Apply to story", command=self.apply_style)
        self.style_apply.pack(side="left", padx=(8, 0))
        ttk.Label(line1, text="List:").pack(side="left", padx=(10, 4))
        self.agent_group_box = ttk.Combobox(line1, textvariable=self.preset_group_var, width=13,
                                            values=PRESET_GROUPS, state="readonly")
        self.agent_group_box.pack(side="left")
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
        ttk.Label(f, text="model hint: plain English - Agent Mode has no model menu    ·    "
                          "preset: rewrites the story's style field - the words the agent renders in",
                  style="Hint.TLabel").grid(row=r, column=0, columnspan=3, sticky="w", padx=14, pady=(0, 4))
        r += 1

        # Clip format, Watch and the CDP port share one line - three small
        # controls that never needed a row each.
        line2 = tk.Frame(f, bg=SURFACE)
        line2.grid(row=r, column=0, columnspan=3, sticky="ew", padx=14, pady=5)
        ttk.Label(line2, text="Clip format:").pack(side="left")
        # The format is asked for in words because there is no panel to set it
        # in. Combobox left editable rather than readonly: the builder passes
        # an unrecognised ratio through as written, so a ratio Flow adds later
        # can be typed here without waiting for this list to learn about it.
        self.aspect_var = tk.StringVar(value=self.settings["aspect_ratio"])
        ttk.Combobox(line2, textvariable=self.aspect_var, width=7,
                     values=["Flow", "16:9", "9:16", "1:1"]).pack(side="left", padx=(6, 4))
        ttk.Label(line2, text="aspect", style="Hint.TLabel").pack(side="left", padx=(0, 14))
        self.seconds_var = tk.IntVar(value=self.settings["scene_seconds"])
        ttk.Spinbox(line2, from_=1, to=8, textvariable=self.seconds_var,
                    width=4).pack(side="left", padx=(0, 4))
        ttk.Label(line2, text="sec/clip", style="Hint.TLabel").pack(side="left", padx=(0, 16))
        ttk.Label(line2, text="Watch:").pack(side="left")
        self.watch_var = tk.IntVar(value=self.settings["watch_secs"])
        ttk.Spinbox(line2, from_=30, to=3600, textvariable=self.watch_var,
                    width=7).pack(side="left", padx=(6, 4))
        ttk.Label(line2, text="sec after submit", style="Hint.TLabel").pack(side="left", padx=(0, 16))
        ttk.Label(line2, text="CDP port:").pack(side="left")
        self.agent_cdp_var = tk.IntVar(value=self.settings["cdp_port"])
        ttk.Spinbox(line2, from_=1024, to=65535, textvariable=self.agent_cdp_var,
                    width=8).pack(side="left", padx=(6, 0))
        r += 1
        # The video model is a property of the Flow PROJECT, not something the
        # prompt can ask for, so it is picked here and written into the project by
        # the agent just before it presses Generate. Flow remembers the last model
        # used per project, which is how a new film quietly inherits an old one's
        # model - so this is set explicitly on every run rather than left to luck.
        model_line = tk.Frame(f, bg=SURFACE)
        model_line.grid(row=r, column=0, columnspan=3, sticky="ew", padx=14, pady=(0, 5))
        ttk.Label(model_line, text="Video model:").pack(side="left")
        self.video_model_var = tk.StringVar(value=self.settings.get("video_model", "Flow"))
        ttk.Combobox(model_line, textvariable=self.video_model_var, width=30,
                     values=VIDEO_MODELS).pack(side="left", padx=(6, 4))
        ttk.Label(model_line, text='"Flow" leaves each project on its own setting',
                  style="Hint.TLabel").pack(side="left", padx=(6, 0))
        r += 1
        ttk.Label(f, text="clip format is stated in the prompt - a story JSON carrying its own values fills these in",
                  style="Hint.TLabel").grid(row=r, column=0, columnspan=3, sticky="w", padx=14, pady=(0, 4))
        r += 1

        # The two safety switches, side by side.
        line3 = tk.Frame(f, bg=SURFACE)
        line3.grid(row=r, column=0, columnspan=3, sticky="ew", padx=14, pady=5)
        self.auto_approve_var = tk.BooleanVar(value=self.settings["auto_approve"])
        ttk.Checkbutton(line3, text="Auto-approve storyboard (⚠ spends credits)",
                        variable=self.auto_approve_var).pack(side="left")
        self.no_submit_var = tk.BooleanVar(value=self.settings["no_submit"])
        ttk.Checkbutton(line3, text="Dry run - type but don't submit (safety default)",
                        variable=self.no_submit_var).pack(side="left", padx=(24, 0))
        r += 1

        # ---- stages ----------------------------------------------------------
        ttk.Separator(f, orient="horizontal").grid(row=r, column=0, columnspan=3, sticky="ew", padx=10, pady=8)
        r += 1

        stages = tk.Frame(f, bg=SURFACE)
        stages.grid(row=r, column=0, columnspan=3, sticky="w", padx=12, pady=2)
        r += 1

        def stage(parent, col, num, title, sub, cmd):
            box = tk.Frame(parent, bg=SURFACE)
            box.grid(row=0, column=col, sticky="n", padx=(0, 14))
            ttk.Label(box, text=f"{num}. {title}", style="Step.TLabel").pack(anchor="w")
            ttk.Label(box, text=sub, style="Hint.TLabel", justify="left", wraplength=170).pack(anchor="w", pady=(0, 4))
            # The same accent fill as "Run engine" and "Write story", so a Run
            # button is the green one on every tab rather than only two of them.
            ttk.Button(box, text="Run", command=cmd, width=20,
                       style="Accent.TButton").pack(anchor="w")

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
        ttk.Entry(f, textvariable=self.clips_var, width=58).grid(row=r, column=1, sticky="ew", **pad)
        ttk.Button(f, text="Browse…", command=self.browse_clips).grid(row=r, column=2, padx=6)
        r += 1
        # Wired here rather than at the story field, because clips_var has to
        # exist first. A stored folder for a story that is no longer loaded is
        # corrected on startup as well as on every later change of story.
        self.agent_story_var.trace_add("write", self.follow_story_clips)
        self.follow_story_clips()

        btns = tk.Frame(f, bg=SURFACE)
        btns.grid(row=r, column=1, columnspan=2, sticky="w", padx=14, pady=(2, 10))
        ttk.Button(btns, text="Open clips folder", command=self.open_clips).pack(side="left")
        ttk.Button(btns, text="Stop engine", command=self.kill_engine).pack(side="left", padx=10)
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
                    # The aspect control is NOT overwritten from the story. It is
                    # the authority now: Build prompt and Run agent pass it to the
                    # builder as --aspect, which beats the story's own value.
                    # Syncing it from the story used to snap a "Flow" or a
                    # landscape choice back to the story's 9:16 the moment the
                    # story was (re)loaded - the exact lock this fixes.
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
            "aspect_ratio": self.aspect_var.get().strip() or "Flow",
            "video_model": self.video_model_var.get().strip() or "Flow",
            "scene_seconds": self.read_seconds(),
            "style_preset": self._style_ids.get(self.style_var.get(), ""),
            "auto_rotate": bool(self.auto_rotate_var.get()) if hasattr(self, "auto_rotate_var")
                           else bool(self.settings.get("auto_rotate", True)),
            # script tab
            "gen_detail": self.gen_detail.get("1.0", "end").strip(),
            "gen_duration": self.read_int(self.gen_duration_var, 56),
            "gen_scene_seconds": self.read_int(self.gen_seconds_var, 8),
            "gen_aspect_ratio": self.gen_aspect_var.get().strip() or "Flow",
            "gen_preset": self._gen_ids.get(self.gen_preset_var.get(), ""),
            "preset_group": self.preset_group_var.get() if hasattr(self, "preset_group_var") else self.settings.get("preset_group", "Classic"),
            "gemini_model": self.gen_model_var.get().strip() or "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash",
            # Anything typed into the entry but not yet Added counts too, so a
            # key pasted and immediately used without pressing Add still works
            # rather than silently running with no key.
            "gemini_api_keys": self.effective_keys(),
            # Cleared: the list is now the only source. Leaving a stale single
            # key here would resurrect an old key the user had removed.
            "gemini_api_key": "",
            # mcp tab - guarded so a settings save never depends on the tab
            # having been built yet.
            "mcp_links": self._mcp_text(self.mcp_links) if hasattr(self, "mcp_links") else self.settings.get("mcp_links", ""),
            "mcp_ideas": self._mcp_text(self.mcp_ideas) if hasattr(self, "mcp_ideas") else self.settings.get("mcp_ideas", ""),
            "mcp_preset": self._mcp_preset_id() if hasattr(self, "mcp_preset_var") else self.settings.get("mcp_preset", ""),
            "mcp_seconds": self.read_int(self.mcp_seconds_var, 8) if hasattr(self, "mcp_seconds_var") else self.settings.get("mcp_seconds", 8),
            "mcp_clips": self.read_int(self.mcp_clips_var, 0) if hasattr(self, "mcp_clips_var") else self.settings.get("mcp_clips", 0),
            "mcp_match_ref": bool(self.mcp_match_ref_var.get()) if hasattr(self, "mcp_match_ref_var") else self.settings.get("mcp_match_ref", True),
            "mcp_aspect": (self.mcp_aspect_var.get().strip() or "Flow") if hasattr(self, "mcp_aspect_var") else self.settings.get("mcp_aspect", "Flow"),
            "mcp_video_model": (self.mcp_video_model_var.get().strip() or "Flow") if hasattr(self, "mcp_video_model_var") else self.settings.get("mcp_video_model", "Flow"),
            "mcp_generate": bool(self.mcp_generate_var.get()) if hasattr(self, "mcp_generate_var") else self.settings.get("mcp_generate", False),
            "mcp_download": bool(self.mcp_download_var.get()) if hasattr(self, "mcp_download_var") else self.settings.get("mcp_download", True),
            "mcp_join": bool(self.mcp_join_var.get()) if hasattr(self, "mcp_join_var") else self.settings.get("mcp_join", True),
            "mcp_new_project": bool(self.mcp_new_project_var.get()) if hasattr(self, "mcp_new_project_var") else self.settings.get("mcp_new_project", True),
            "mcp_generate_refs": bool(self.mcp_generate_refs_var.get()) if hasattr(self, "mcp_generate_refs_var") else self.settings.get("mcp_generate_refs", True),
            "mcp_auto_approve": bool(self.mcp_auto_approve_var.get()) if hasattr(self, "mcp_auto_approve_var") else self.settings.get("mcp_auto_approve", True),
            "mcp_verbose": bool(self.mcp_verbose_var.get()) if hasattr(self, "mcp_verbose_var") else self.settings.get("mcp_verbose", True),
            "mcp_from": self.read_int(self.mcp_from_var, 1) if hasattr(self, "mcp_from_var") else self.settings.get("mcp_from", 1),
            "mcp_to": self.read_int(self.mcp_to_var, 0) if hasattr(self, "mcp_to_var") else self.settings.get("mcp_to", 0),
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

    @staticmethod
    def story_dir(story_path):
        """The folder a story JSON lives in, or '' when the path is not usable."""
        p = str(story_path or "").strip()
        return os.path.dirname(os.path.abspath(p)) if p else ""

    def follow_story_clips(self, *_):
        """Keep the clips folder inside whichever story is loaded.

        The stored clips_dir is a trap: it was saved for whatever story happened
        to be open at the time, so picking a *new* story still downloaded into
        the *previous* one's folder. That is not hypothetical - on 2026-09-12 a
        run for one story wrote its clips into the_bridge_of_trust/clips,
        because a stale saved folder outvoted the story on screen.

        Deriving the folder from the story makes the two impossible to disagree.
        A deliberate custom folder can still be typed in afterwards; it will be
        re-derived the next time the story path changes.
        """
        d = self.story_dir(self.agent_story_var.get())
        if not d:
            return
        want = os.path.join(d, "clips")
        if os.path.normcase(self.clips_var.get().strip()) != os.path.normcase(want):
            self.clips_var.set(want)

    def story_folder_of(self, folder):
        """The story folder `folder` sits inside, or '' when it is in none.

        A story folder is identifiable because it directly holds a *_story.json -
        the same marker resolved_clips_dir relies on. Walking up to find that
        marker is what keeps other_story_of honest now that the finished stories
        live under stories/old/: every one of them shares that first path
        segment, so a test that only compared first segments saw them all as the
        same story and the wrong-folder guard below could never fire again.
        """
        try:
            nroot = os.path.normcase(os.path.abspath(STORIES_DIR))
            cur = os.path.abspath(folder)
            while os.path.normcase(cur).startswith(nroot + os.sep):
                try:
                    if any(n.lower().endswith("_story.json")
                           for n in os.listdir(cur)):
                        return cur
                except OSError:
                    pass
                parent = os.path.dirname(cur)
                if parent == cur:
                    break
                cur = parent
            return ""
        except Exception:
            return ""

    def other_story_of(self, folder, story_path):
        """The story folder `folder` belongs to, if it is not the loaded one.

        Returns '' when the folder is fine: either it is inside the loaded
        story, or it is somewhere outside stories/ entirely (a custom output
        folder is the user's business, not ours). The case worth catching is a
        folder inside a *different* story - downloading there mixes two
        productions, and the join then reads a manifest that does not match the
        story being built.
        """
        mine = self.story_folder_of(self.story_dir(story_path))
        if not mine:
            return ""
        theirs = self.story_folder_of(folder)
        if not theirs or os.path.normcase(theirs) == os.path.normcase(mine):
            return ""
        return theirs

    def correct_clips_dir(self, what="download"):
        """Refuse to work in another story's folder, and say so.

        Called before downloading and before joining, because both would
        silently produce the wrong result rather than failing.

        Reads the entry field rather than the settings dict: the field is what
        the user is looking at, and settings only catches up when
        collect_inputs() runs.
        """
        out = self.clips_var.get().strip()
        story = self.agent_story_var.get().strip()
        if not out or not story:
            return out
        other = self.other_story_of(out, story)
        if not other:
            return out
        right = os.path.join(self.story_dir(story), "clips")
        messagebox.showwarning(
            "Wrong story folder",
            f"The clips folder points at a different story:\n\n"
            f"    clips folder :  {os.path.abspath(out)}\n"
            f"    belongs to   :  {os.path.basename(other)}\n"
            f"    story loaded :  {os.path.basename(self.story_dir(story))}\n\n"
            f"{'Downloading' if what == 'download' else 'Joining'} there would mix two "
            f"stories together.\n\nSwitching to:\n{right}")
        self.clips_var.set(right)
        self.settings["clips_dir"] = right
        return right

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

    # ---------- credit pool (accounts.json via account_manager.js) ----------
    def _account_store(self):
        try:
            with open(ACCOUNTS_FILE, encoding="utf-8") as fh:
                s = json.load(fh)
            if isinstance(s, dict) and isinstance(s.get("accounts"), list) and s["accounts"]:
                return s
        except Exception:
            pass
        return None

    def _cdp_alive(self, port):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2) as r:
                return r.status == 200
        except Exception:
            return False

    def _acc_cli(self, *args, timeout=200):
        """Run account_manager.js synchronously. Returns (ok, output)."""
        try:
            p = subprocess.run(["node", ACCOUNT_MGR, *args], cwd=BASE_DIR,
                               capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=timeout)
            return p.returncode == 0, ((p.stdout or "") + (p.stderr or "")).strip()
        except Exception as e:
            return False, str(e)

    def _acc_report(self, ok, out):
        if out:
            self.output.insert("end", ("" if ok else "\u26A0  ") + out + "\n")
            self.output.see("end")

    def _ensure_active_browser(self):
        """The automation browser on the CDP port must be the ACTIVE
        account's profile before a run starts. No accounts configured =
        nothing to do (the engine uses the single shared profile)."""
        store = self._account_store()
        if not store:
            return True
        acc = store["accounts"][store.get("current", 0)]
        label = acc.get("label", "")
        if store.get("browser") == label and self._cdp_alive(self.settings["cdp_port"]):
            return True
        return self._switch_to_account(label)

    def _switch_to_account(self, label):
        port = self.settings["cdp_port"]
        self.output.insert("end", f"\nSwitching the automation browser to '{label}' (the old one closes)...\n")
        self.output.see("end")
        self.root.update_idletasks()
        ok, out = self._acc_cli("use", "--label", label, "--cdp", str(port))
        for ln in out.splitlines():
            self.output.insert("end", ln + "\n")
        self.output.see("end")
        if not ok:
            messagebox.showerror("Could not switch account",
                                 f"The browser for '{label}' did not come up on CDP port {port}.\n\n{out[-300:]}")
            return False
        self._browser_account = label
        self._refresh_accounts_list()
        return True

    def _sel_account(self):
        sel = self.acc_tree.selection()
        store = self._account_store()
        if not sel or not store:
            messagebox.showinfo("Pick an account", "Select an account in the list first.")
            return None
        try:
            return store["accounts"][int(sel[0])]["label"]
        except Exception:
            return None

    def acc_add(self):
        label = simpledialog.askstring("Add account", "Name for this account (e.g. 'acc 1'):", parent=self.root)
        if not label or not label.strip():
            return
        email = simpledialog.askstring("Add account", "Email (optional - just so you can tell them apart):", parent=self.root) or ""
        mx = simpledialog.askstring("Add account", "Clips this account can make per month:",
                                    initialvalue="100", parent=self.root)
        try:
            n = int(mx)
        except (TypeError, ValueError):
            n = 100
        ok, out = self._acc_cli("add", "--label", label.strip(), "--email", email, "--max-clips", str(n))
        self._acc_report(ok, out)
        if not ok:
            return
        self._refresh_accounts_list()
        if messagebox.askyesno("Sign in now",
                               f"Sign '{label.strip()}' into Flow now?\n\n"
                               "A Chrome window opens - log that Google account in once and it is remembered."):
            self._switch_to_account(label.strip())

    def acc_sign_in(self):
        label = self._sel_account()
        if label:
            self._switch_to_account(label)

    def acc_set_active(self):
        label = self._sel_account()
        if not label:
            return
        ok, out = self._acc_cli("set-current", "--label", label)
        self._acc_report(ok, out)
        if ok:
            self._refresh_accounts_list()

    def acc_reset(self):
        label = self._sel_account()
        if not label:
            return
        ok, out = self._acc_cli("reset", "--label", label)
        self._acc_report(ok, out)
        if ok:
            self._refresh_accounts_list()

    def acc_pause_toggle(self):
        label = self._sel_account()
        if not label:
            return
        store = self._account_store()
        paused = next((a.get("paused", False) for a in store["accounts"] if a.get("label") == label), None)
        if paused is None:
            return
        ok, out = self._acc_cli("resume" if paused else "pause", "--label", label)
        self._acc_report(ok, out)
        if ok:
            self._refresh_accounts_list()

    def acc_remove(self):
        label = self._sel_account()
        if not label:
            return
        if not messagebox.askyesno("Remove account",
                                   f"Remove '{label}' from the pool?\n(The Chrome profile folder on disk is kept.)"):
            return
        ok, out = self._acc_cli("remove", "--label", label)
        self._acc_report(ok, out)
        if ok:
            self._refresh_accounts_list()

    def _refresh_accounts_list(self):
        tv = getattr(self, "acc_tree", None)
        if tv is None:
            return
        tv.delete(*tv.get_children())
        store = self._account_store()
        if not store:
            tv.insert("", "end", values=("(no accounts yet)", "", "", "Add one below"))
            return
        now = time.strftime("%Y-%m")
        for i, a in enumerate(store["accounts"]):
            used = a.get("clips_used", 0)
            if a.get("clips_month") != now:
                used = 0
            mx = a.get("max_clips", 100)
            state = "paused" if a.get("paused") else ("empty this month" if used >= mx else "ok")
            if i == store.get("current", 0):
                state = "ACTIVE - " + state
            tv.insert("", "end", iid=str(i),
                      values=(a.get("label", ""), a.get("email", ""), f"{used}/{mx}", state))

    def _handle_proc_exit(self, code):
        """Engine finished. Code 3 = the account's Veo credits are spent."""
        self._refresh_accounts_list()
        self._reset_progress("idle")
        ctx = getattr(self, "_rotate_ctx", None)
        if code != 3 or not ctx:
            return
        if not self.settings.get("auto_rotate", True):
            self.output.insert("end",
                               "\nThis account is out of Veo credits. Rotation is off - pick the next\n"
                               "account on the Accounts tab and press Run again.\n")
            self.output.see("end")
            return
        ok, out = self._acc_cli("next")
        label = out.strip().splitlines()[-1].strip() if ok and out.strip() else ""
        if not label or label.startswith("("):
            self.output.insert("end", "\nEvery account in the pool is out of credits (or paused) this month.\n")
            self.output.see("end")
            messagebox.showinfo("Pool empty",
                                "Every account is out of Veo credits this month.\n\n"
                                "Counters reset automatically next month.")
            return
        nxt = self._credits_scene + 1
        if nxt > ctx["to_scene"]:
            self.output.insert("end", "\nThe story was already complete - nothing to rotate to.\n")
            self.output.see("end")
            return
        self.output.insert("end",
                           f"\nRotating to '{label}': continuing from scene {nxt} in a fresh project...\n")
        self.output.see("end")
        if not self._switch_to_account(label):
            return
        cmd = ["node", ENGINE, ctx["story"],
               "--from", str(nxt), "--to", str(ctx["to_scene"]),
               "--cdp", str(ctx["cdp"]),
               "--account", label, "--fresh-project"]
        if self._launch(cmd, f"Continuing on '{label}' from scene {nxt} (fresh project)..."):
            # keep the ctx alive in case THIS account drains too
            self._rotate_ctx = ctx

    # ── process launching ─────────────────────────────────────────────
    def _launch(self, cmd, what):
        """One place for the Popen dance - four stages share it."""
        self._rotate_ctx = None
        if self.proc and self.proc.poll() is None:
            messagebox.showwarning("Busy", "A stage is already running. Wait, or kill it first.")
            return False
        self.output.delete("1.0", "end")
        self.output.insert("end", f"🚀 {what}\n\n")
        self._reset_progress("starting...")
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
        # Credit pool: run on the ACTIVE account's browser and tell the
        # engine whose monthly counter to charge.
        if not self._ensure_active_browser():
            return
        store = self._account_store()
        if store:
            cmd += ["--account", store["accounts"][store.get("current", 0)]["label"]]
        if not self._launch(cmd, "Starting the ingredients engine in a separate console..."):
            return
        # If this account drains mid-story the engine exits with code 3;
        # _handle_proc_exit then continues on the next account.
        self._rotate_ctx = {
            "story": story,
            "to_scene": self.settings["to_scene"],
            "cdp": self.settings["cdp_port"],
        }

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

    def use_flash_chain(self):
        """Put the default flash chain back: newest first, then the next two."""
        self.gen_model_var.set("gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash")

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
        current = self.gen_model_var.get().strip()
        if "," in current:
            # A chain is a deliberate choice; leave it alone.
            self.output.insert("end", f"Chain kept: {current}\n\n")
        elif current not in models:
            self.output.insert("end",
                               f"⚠️  '{current}' is not on this list - "
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

    def _refresh_prompt(self, story):
        """Rebuild agent_prompt.txt from the current controls, synchronously.

        Run agent types whatever agent_prompt.txt holds, and that file is only as
        fresh as the last Build prompt click. So a ratio or clip length changed
        afterwards never reached Flow - which is why choosing landscape still
        produced portrait clips, from a prompt still saying 9:16. Rebuilding here
        makes stage 1 and stage 2 one action.
        """
        cmd = ["node", PROMPT_BUILDER, story,
               "--aspect", self.settings["aspect_ratio"],
               "--seconds", str(self.settings["scene_seconds"])]
        shell_cmd = "chcp 65001 >nul && " + subprocess.list2cmdline(cmd)
        try:
            r = subprocess.run(shell_cmd, cwd=BASE_DIR, capture_output=True,
                               text=True, encoding="utf-8", errors="replace",
                               shell=True, timeout=180)
        except Exception as e:
            messagebox.showerror("Build prompt failed", str(e))
            return False
        if r.returncode != 0:
            messagebox.showerror(
                "Build prompt failed",
                ((r.stdout or "") + (r.stderr or "")).strip()[-1200:])
            return False
        return True

    def run_agent(self):
        self.collect_inputs()
        story = self.agent_story_var.get().strip()
        if not story or not os.path.exists(story):
            messagebox.showerror("Missing story", "Pick a valid story JSON first.")
            return
        self.save_settings()
        # Rebuild the prompt from the controls right now, so a ratio or clip
        # length changed since the last Build prompt actually reaches Flow.
        if not self._refresh_prompt(story):
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
        # The agent driver types into whatever browser owns the CDP port -
        # make sure that is the ACTIVE account's before it starts.
        if not self._ensure_active_browser():
            return
        # --refs is what keeps the cast stable. The "@" picker offers each
        # character as either a raw Image or a saved Flow Character, and only
        # the Image holds the face across clips - the Character is re-derived
        # per clip and drifts. Passing the story JSON uploads the sheets (once;
        # they are skipped on later runs) so an Image tile exists to pick.
        cmd = ["node", AGENT_ENGINE, "--file", prompt_file,
               "--refs", story,
               "--cdp", str(self.settings["cdp_port"]),
               "--watch", str(self.settings["watch_secs"])]
        if self.settings["model_hint"]:
            cmd += ["--model", self.settings["model_hint"]]
        # "Flow" is the sentinel for "leave the project alone" - passing it as a
        # model name would look for a model called Flow and fail the run.
        video_model = self.settings.get("video_model", "Flow")
        if video_model and video_model.lower() != "flow":
            cmd += ["--video-model", video_model]
        if self.settings["auto_approve"]:
            cmd += ["--auto-approve"]
        if self.settings["no_submit"]:
            cmd += ["--no-submit"]
        self._launch(cmd, "Running the Agent Mode driver (dry run is ON by default)...")

    def download_clips(self):
        self.collect_inputs()
        out = self.correct_clips_dir("download")
        if not out:
            messagebox.showerror("No output folder", "Pick a clips folder first.")
            return
        self.clips_var.set(out)
        self.save_settings()
        # Clips download from the ACTIVE account's Flow project.
        if not self._ensure_active_browser():
            return
        cmd = ["node", DOWNLOADER, "--out", out, "--cdp", str(self.settings["cdp_port"])]
        if self.settings.get("reverse", True):
            # Flow lists newest-first, so without this scene 7 is written as
            # scene-01.mp4 and the join runs the story backwards.
            cmd.append("--reverse")
        self._launch(cmd, f"Downloading clips from Flow into {out} ...")

    def join_clips(self):
        self.collect_inputs()
        d = self.correct_clips_dir("join")
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
        self._credits_scene = 0
        try:
            for line in self.proc.stdout:
                self.output.insert("end", line)
                self.output.see("end")
                # The engine's drain sentinel: how far the story got
                # before this account's credits ran out.
                if "CREDITS_EXHAUSTED after_scene=" in line:
                    try:
                        self._credits_scene = int(line.split("after_scene=")[1].split()[0])
                    except Exception:
                        pass
                elif "[PROGRESS] pct=" in line:
                    self._on_progress(line)
        except Exception:
            pass
        code = self.proc.wait()
        self.output.insert("end", f"\n[exited with code {code}]\n")
        self.output.see("end")
        try:
            # reader thread -> hop to the Tk thread before touching widgets
            self.root.after(0, lambda: self._handle_proc_exit(code))
        except Exception:
            pass

    # ── progress line ─────────────────────────────────────────
    def _on_progress(self, line):
        """Parse an engine "[PROGRESS] pct=NN scene=N" line.

        Called from the reader thread, so it only stashes the value; the
        widget update happens on the Tk thread via a single scheduled call.
        """
        pct, scene = None, ""
        try:
            for part in line.split("[PROGRESS]")[1].split():
                if part.startswith("pct="):
                    pct = int(float(part[4:]))
                elif part.startswith("scene="):
                    scene = part[6:]
        except Exception:
            return
        if pct is None:
            return
        self._pending_progress = (pct, scene)
        if not self._progress_scheduled:
            self._progress_scheduled = True
            try:
                self.root.after(0, self._apply_progress)
            except Exception:
                self._progress_scheduled = False

    def _apply_progress(self):
        self._progress_scheduled = False
        pending = self._pending_progress
        if not pending:
            return
        pct, scene = pending
        try:
            self.progress["value"] = max(0, min(100, pct))
            where = f"scene {scene} - " if scene else ""
            self.progress_label.config(text=f"{where}{pct}%  generating")
        except Exception:
            pass

    def _reset_progress(self, text="idle"):
        self._pending_progress = None
        try:
            self.progress["value"] = 0
            self.progress_label.config(text=text)
        except Exception:
            pass

    # ── MCP tab ───────────────────────────────────────────────
    # A batch builder that drives mcp_server.js directly (the GUI acts as an MCP
    # client). Same tool layer the agents see, so there is one batch
    # implementation, not two - and because it runs here, it can use the account
    # pool before a generating batch.
    def build_mcp_tab(self, f):
        pad = dict(padx=14, pady=5)
        f.columnconfigure(1, weight=1)
        r = 0

        intro = tk.Frame(f, bg=CARD, highlightthickness=1, highlightbackground=BORDER)
        intro.grid(row=r, column=0, columnspan=3, sticky="ew", padx=10, pady=(10, 8))
        tk.Label(intro, text="Batch builder - feeds the MCP server", bg=CARD, fg=ACCENT,
                 font=("Segoe UI", 10, "bold"), anchor="w").pack(fill="x", padx=10, pady=(8, 2))
        tk.Label(intro, justify="left", anchor="w", bg=CARD, fg=TEXT, font=("Segoe UI", 9),
                 text=("Video links (one per line) are analysed and made into films. Ideas are written\n"
                       "from scratch:   Title | preset | detail   (preset and detail optional).\n"
                       "Import a .txt / .csv / .xlsx too: a row with a link is a reference; a row with a\n"
                       "title in column A and the details in column B is an idea. Films are made ONE BY ONE.")
                 ).pack(fill="x", padx=10, pady=(0, 10))
        r += 1

        tk.Label(f, text="Video links:").grid(row=r, column=0, sticky="ne", **pad)
        self.mcp_links = tk.Text(f, height=5, bg=INPUT, fg=TEXT, insertbackground=TEXT,
                                 font=("Consolas", 9), wrap="none")
        self.mcp_links.grid(row=r, column=1, columnspan=2, sticky="ew", **pad)
        self._mcp_set_text(self.mcp_links, self.settings.get("mcp_links", ""))
        r += 1

        tk.Label(f, text="Ideas:").grid(row=r, column=0, sticky="ne", **pad)
        self.mcp_ideas = tk.Text(f, height=7, bg=INPUT, fg=TEXT, insertbackground=TEXT,
                                 font=("Consolas", 9), wrap="none")
        self.mcp_ideas.grid(row=r, column=1, columnspan=2, sticky="ew", **pad)
        self._mcp_set_text(self.mcp_ideas, self.settings.get("mcp_ideas", ""))
        r += 1

        imp = tk.Frame(f, bg=SURFACE)
        imp.grid(row=r, column=0, columnspan=3, sticky="w", padx=14, pady=5)
        ttk.Button(imp, text="Import file…", command=self.mcp_import_file).pack(side="left")
        ttk.Label(imp, text=".txt / .csv / .xlsx   (links, or Title in col A + details in col B)",
                  style="Hint.TLabel").pack(side="left", padx=8)
        r += 1

        line1 = tk.Frame(f, bg=SURFACE)
        line1.grid(row=r, column=0, columnspan=3, sticky="w", padx=14, pady=5)
        ttk.Label(line1, text="Preset:").pack(side="left")
        self._mcp_displays, self._mcp_ids, self._mcp_by_display, _ = load_style_presets()
        self.mcp_preset_var = tk.StringVar()
        self.mcp_preset_box = ttk.Combobox(line1, textvariable=self.mcp_preset_var, width=24,
                                           values=self._mcp_displays, state="readonly")
        self.mcp_preset_box.pack(side="left", padx=(6, 16))
        ttk.Label(line1, text="List:").pack(side="left")
        self.mcp_group_box = ttk.Combobox(line1, textvariable=self.preset_group_var, width=13,
                                          values=PRESET_GROUPS, state="readonly")
        self.mcp_group_box.pack(side="left", padx=(6, 16))
        for disp, sid in self._mcp_ids.items():
            if sid == (self.settings.get("mcp_preset") or ""):
                self.mcp_preset_var.set(disp)
                break
        ttk.Label(line1, text="sec/clip:").pack(side="left")
        self.mcp_seconds_var = tk.IntVar(value=int(self.settings.get("mcp_seconds", 8)))
        ttk.Spinbox(line1, from_=4, to=10, textvariable=self.mcp_seconds_var, width=4).pack(side="left", padx=(6, 16))
        ttk.Label(line1, text="clips (min):").pack(side="left")
        self.mcp_clips_var = tk.IntVar(value=int(self.settings.get("mcp_clips", 8)))
        ttk.Spinbox(line1, from_=0, to=60, textvariable=self.mcp_clips_var, width=4).pack(side="left", padx=(6, 16))
        ttk.Label(line1, text="ratio:").pack(side="left")
        self.mcp_aspect_var = tk.StringVar(value=self.settings.get("mcp_aspect", "9:16"))
        ttk.Combobox(line1, textvariable=self.mcp_aspect_var, width=6,
                     values=["9:16", "16:9", "1:1", "Flow"]).pack(side="left", padx=(6, 0))
        r += 1
        # The model each film in the batch generates with. Flow keeps this per
        # project and remembers the last one used, so a batch that does not set it
        # inherits whatever each project happened to be left on. "Flow" leaves them
        # all as they are.
        line1c = tk.Frame(f, bg=SURFACE)
        line1c.grid(row=r, column=0, columnspan=3, sticky="w", padx=14, pady=5)
        ttk.Label(line1c, text="Video model:").pack(side="left")
        self.mcp_video_model_var = tk.StringVar(value=self.settings.get("mcp_video_model", "Flow"))
        ttk.Combobox(line1c, textvariable=self.mcp_video_model_var, width=30,
                     values=VIDEO_MODELS).pack(side="left", padx=(6, 4))
        ttk.Label(line1c, text='"Flow" leaves every project on its own setting',
                  style="Hint.TLabel").pack(side="left", padx=(6, 0))
        r += 1

        line1b = tk.Frame(f, bg=SURFACE)
        line1b.grid(row=r, column=0, columnspan=3, sticky="w", padx=14, pady=5)
        self.mcp_match_ref_var = tk.BooleanVar(value=bool(self.settings.get("mcp_match_ref", True)))
        ttk.Checkbutton(line1b, text="Match the video link's own length",
                        variable=self.mcp_match_ref_var).pack(side="left")
        ttk.Label(line1b,
                  text="ON: scenes are built to the linked video's duration - the clips box above is ignored.\n"
                       "OFF: the clips box is the limit (a 2-minute link is still cut to that many clips).",
                  style="Hint.TLabel").pack(side="left", padx=8)
        r += 1

        line2 = tk.Frame(f, bg=SURFACE)
        line2.grid(row=r, column=0, columnspan=3, sticky="w", padx=14, pady=5)
        self.mcp_generate_var = tk.BooleanVar(value=bool(self.settings.get("mcp_generate", False)))
        ttk.Checkbutton(line2, text="Generate (spends credits)",
                        variable=self.mcp_generate_var).pack(side="left")
        self.mcp_download_var = tk.BooleanVar(value=bool(self.settings.get("mcp_download", True)))
        ttk.Checkbutton(line2, text="Download", variable=self.mcp_download_var).pack(side="left", padx=(12, 0))
        self.mcp_join_var = tk.BooleanVar(value=bool(self.settings.get("mcp_join", True)))
        ttk.Checkbutton(line2, text="Join", variable=self.mcp_join_var).pack(side="left", padx=(12, 0))
        self.mcp_new_project_var = tk.BooleanVar(value=bool(self.settings.get("mcp_new_project", True)))
        ttk.Checkbutton(line2, text="New project per film",
                        variable=self.mcp_new_project_var).pack(side="left", padx=(12, 0))
        self.mcp_generate_refs_var = tk.BooleanVar(value=bool(self.settings.get("mcp_generate_refs", True)))
        ttk.Checkbutton(line2, text="Refs in Flow",
                        variable=self.mcp_generate_refs_var).pack(side="left", padx=(12, 0))
        self.mcp_auto_approve_var = tk.BooleanVar(value=bool(self.settings.get("mcp_auto_approve", True)))
        ttk.Checkbutton(line2, text="Auto-approve", variable=self.mcp_auto_approve_var).pack(side="left", padx=(12, 0))
        self.mcp_verbose_var = tk.BooleanVar(value=bool(self.settings.get("mcp_verbose", True)))
        ttk.Checkbutton(line2, text="Show title + detail in summary",
                        variable=self.mcp_verbose_var).pack(side="left", padx=(12, 0))
        r += 1

        line3 = tk.Frame(f, bg=SURFACE)
        line3.grid(row=r, column=0, columnspan=3, sticky="w", padx=14, pady=5)
        ttk.Label(line3, text="From:").pack(side="left")
        self.mcp_from_var = tk.IntVar(value=int(self.settings.get("mcp_from", 1)))
        ttk.Spinbox(line3, from_=1, to=999, textvariable=self.mcp_from_var, width=5).pack(side="left", padx=(6, 16))
        ttk.Label(line3, text="To (0 = end):").pack(side="left")
        self.mcp_to_var = tk.IntVar(value=int(self.settings.get("mcp_to", 0)))
        ttk.Spinbox(line3, from_=0, to=999, textvariable=self.mcp_to_var, width=5).pack(side="left", padx=(6, 16))
        ttk.Label(line3, text="Flow runs strictly one film at a time.", style="Hint.TLabel").pack(side="left")
        r += 1

        acts = tk.Frame(f, bg=SURFACE)
        acts.grid(row=r, column=0, columnspan=3, sticky="w", padx=14, pady=(8, 4))
        ttk.Button(acts, text="Write stories only",
                   command=lambda: self.run_mcp_batch(False)).pack(side="left")
        ttk.Button(acts, text="Generate batch",
                   command=lambda: self.run_mcp_batch(True)).pack(side="left", padx=8)
        ttk.Button(acts, text="Stop", command=self.stop_mcp).pack(side="left")
        r += 1

        ag = tk.Frame(f, bg=SURFACE)
        ag.grid(row=r, column=0, columnspan=3, sticky="w", padx=14, pady=(4, 10))
        ttk.Button(ag, text="Copy MCP config", command=self.copy_mcp_config).pack(side="left")
        ttk.Button(ag, text="Copy agent instruction",
                   command=self.copy_agent_instruction).pack(side="left", padx=8)
        ttk.Label(ag, text="paste into opencode / Claude Code / Cursor",
                  style="Hint.TLabel").pack(side="left", padx=4)
        r += 1

    @staticmethod
    def _mcp_text(widget):
        return widget.get("1.0", "end").strip()

    @staticmethod
    def _mcp_set_text(widget, text):
        if text:
            widget.insert("1.0", text)

    def _mcp_preset_id(self):
        return self._mcp_ids.get(self.mcp_preset_var.get(), "")

    def _ui(self, fn):
        """Run fn on the Tk thread (workers call this)."""
        try:
            self.root.after(0, fn)
        except Exception:
            pass

    def _console(self, line):
        try:
            self.output.insert("end", line if line.endswith("\n") else line + "\n")
            self.output.see("end")
        except Exception:
            pass

    def mcp_import_file(self):
        p = filedialog.askopenfilename(
            title="Import video links or ideas",
            initialdir=self.settings.get("mcp_last_dir") or BASE_DIR,
            filetypes=[("Links or ideas", "*.txt *.csv *.xlsx"), ("All files", "*.*")])
        if not p:
            return
        self.settings["mcp_last_dir"] = os.path.dirname(p)
        try:
            refs, ideas = self._read_items_file(p)
        except Exception as e:
            messagebox.showerror("Could not read the file", str(e))
            return
        if refs:
            old = self._mcp_text(self.mcp_links)
            self.mcp_links.delete("1.0", "end")
            self.mcp_links.insert("1.0", (old + "\n" if old else "") + "\n".join(refs))
        if ideas:
            old = self._mcp_text(self.mcp_ideas)
            self.mcp_ideas.delete("1.0", "end")
            self.mcp_ideas.insert("1.0", (old + "\n" if old else "") +
                                  "\n".join(self._idea_line(i) for i in ideas))
        self._console(f"Imported {len(refs)} link(s) and {len(ideas)} idea(s) from {os.path.basename(p)}")

    @staticmethod
    def _idea_line(idea):
        title = idea.get("title", "")
        preset = idea.get("preset", "")
        detail = idea.get("detail", "")
        if preset:
            return f"{title} | {preset} | {detail}"
        return f"{title} | {detail}" if detail else title

    def _read_items_file(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in (".txt", ".md"):
            # Text has no columns, so a "Title | preset | detail" line is split
            # on the pipe here - the same separator the Ideas box uses.
            with open(path, encoding="utf-8", errors="replace") as fh:
                rows = [[c.strip() for c in ln.split("|")]
                        for ln in fh
                        if ln.strip() and not ln.lstrip().startswith("#")]
        elif ext == ".csv":
            import csv
            with open(path, newline="", encoding="utf-8", errors="replace") as fh:
                rows = [[(c or "").strip() for c in row] for row in csv.reader(fh)]
        elif ext == ".xlsx":
            rows = read_xlsx_rows(path)
        elif ext == ".xls":
            raise ValueError("Old .xls is not supported - open it and Save As .xlsx or CSV.")
        else:
            raise ValueError(f"Unsupported file type: {ext or '(none)'}")
        return self._rows_to_items(rows)

    @staticmethod
    def _rows_to_items(rows):
        refs, ideas = [], []
        for idx, row in enumerate(rows):
            cells = [(c or "").strip() for c in row]
            url = next((c for c in cells if c.lower().startswith("http")), "")
            if url:
                refs.append(url)
                continue
            nonempty = [c for c in cells if c]
            if not nonempty:
                continue
            # Drop an obvious header row so a spreadsheet with column names does
            # not become a film titled "Title".
            if idx == 0 and nonempty[0].lower() in ("title", "video title", "name", "topic"):
                continue
            title = nonempty[0]
            detail = nonempty[1] if len(nonempty) > 1 else ""
            ideas.append({"title": title, "detail": detail})
        return refs, ideas

    def _parse_idea_lines(self):
        ideas = []
        for ln in self.mcp_ideas.get("1.0", "end").splitlines():
            ln = ln.strip()
            if not ln or ln.startswith("#"):
                continue
            parts = [p.strip() for p in ln.split("|")]
            title = parts[0] if parts else ""
            if not title:
                continue
            if len(parts) >= 3:
                ideas.append({"title": title, "preset": parts[1], "detail": " | ".join(parts[2:])})
            elif len(parts) == 2:
                ideas.append({"title": title, "detail": parts[1]})
            else:
                ideas.append({"title": title})
        return ideas

    def run_mcp_batch(self, generate):
        self.collect_inputs()
        self.save_settings()
        links = [l.strip() for l in self.mcp_links.get("1.0", "end").splitlines()
                 if l.strip().lower().startswith("http")]
        ideas = self._parse_idea_lines()
        if not links and not ideas:
            messagebox.showinfo("Nothing to do", "Add video links and/or ideas first, or import a file.")
            return
        total = len(links) + len(ideas)
        if generate and not messagebox.askyesno(
                "Generate batch",
                f"Generate {total} film(s) now?\n\nThis drives Flow one film at a time and SPENDS "
                f"credits. It can take a long time. You can Stop, then Resume with From/To."):
            return
        if generate and not self._ensure_active_browser():
            return
        if not os.path.exists(MCP_SERVER):
            messagebox.showerror("MCP server missing", f"Not found:\n{MCP_SERVER}")
            return

        args = {
            "aspect": self.mcp_aspect_var.get().strip() or "Flow",
            "video_model": self.mcp_video_model_var.get().strip() or "Flow",
            "seconds": self.read_int(self.mcp_seconds_var, 8),
            "generate": bool(generate),
            "submit": bool(generate),
            "download": bool(self.mcp_download_var.get()),
            "join": bool(self.mcp_join_var.get()),
            "auto_approve": bool(self.mcp_auto_approve_var.get()),
            "new_project": bool(self.mcp_new_project_var.get()),
            "generate_refs": bool(self.mcp_generate_refs_var.get()),
            "model": self.settings.get("gemini_model") or "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash",
            "veo_model": self.settings.get("model_hint") or "",
            "verbose": bool(self.mcp_verbose_var.get()),
            "cdp": self.read_int(self.cdp_var, 9222),
            "watch": self.read_int(self.watch_var, 300),
        }
        preset = self._mcp_preset_id()
        if preset:
            args["preset"] = preset
        clips = self.read_int(self.mcp_clips_var, 0)
        if clips > 0:
            args["clips"] = clips
        # The batch decides: match_ref true = the link's own duration wins and
        # clips is ignored; false = clips is a hard limit for every preset.
        args["match_ref"] = bool(self.mcp_match_ref_var.get())
        frm = self.read_int(self.mcp_from_var, 1)
        to = self.read_int(self.mcp_to_var, 0)
        if frm > 1:
            args["from"] = frm
        if to > 0:
            args["to"] = to
        if links:
            args["references"] = links
        if ideas:
            args["ideas"] = ideas

        self.stop_mcp()
        self.output.delete("1.0", "end")
        self.output.insert("end", f"🚀 MCP batch: {len(links)} link(s), {len(ideas)} idea(s)   "
                                 f"{'GENERATING' if generate else 'stories only'}\n\n")
        self.output.see("end")
        self._reset_progress("mcp batch")

        def worker():
            try:
                from mcp_client import MCPClient
            except Exception as e:
                self._ui(lambda: messagebox.showerror("MCP client missing",
                                                      f"mcp_client.py could not load:\n{e}"))
                return
            client = MCPClient(MCP_SERVER, cwd=BASE_DIR,
                               log=lambda ln: self._ui(lambda l=ln: self._console(l)))
            self._mcp_client = client
            try:
                client.start()
                res = client.call_tool("batch_pipeline", args)
                if res["text"]:
                    self._ui(lambda: self._console("\n" + res["text"]))
                tail = "\n✅ batch finished" + (" (with errors)" if res["isError"] else "")
                self._ui(lambda: self._console(tail))
            except Exception as e:
                self._ui(lambda: self._console(f"\n❌ MCP error: {e}"))
            finally:
                client.stop()
                self._mcp_client = None
                self._ui(lambda: self._reset_progress("idle"))
                self._ui(self.load_story_info)

        threading.Thread(target=worker, daemon=True).start()

    def stop_mcp(self):
        c = getattr(self, "_mcp_client", None)
        if c:
            try:
                c.stop()
            except Exception:
                pass
            self._mcp_client = None
            self._console("\n🛑 Stopped the MCP batch.")

    def copy_mcp_config(self):
        cfg = json.dumps({"mcpServers": {"veo3-flow": {
            "command": "node", "args": [MCP_SERVER.replace("\\", "/")]}}}, indent=2)
        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(cfg)
        except Exception:
            pass
        messagebox.showinfo("MCP config copied",
                            "Paste into Cursor / Claude Desktop / opencode:\n\n" + cfg +
                            "\n\n(opencode uses the same server under its `mcp` key.)")

    def copy_agent_instruction(self):
        links = [l.strip() for l in self.mcp_links.get("1.0", "end").splitlines()
                 if l.strip().lower().startswith("http")]
        ideas = self._parse_idea_lines()
        preset = self._mcp_preset_id()
        clips = self.read_int(self.mcp_clips_var, 0)
        match_ref = bool(self.mcp_match_ref_var.get())
        L = ["Using the veo3-flow MCP, call batch_pipeline with:"]
        if links:
            L.append("  references: " + json.dumps(links))
        if ideas:
            L.append("  ideas: " + json.dumps(ideas))
        if preset:
            L.append(f'  preset: "{preset}"')
        if clips > 0:
            L.append(f"  clips: {clips}" + ("" if not match_ref else "   # ignored while match_ref is true"))
        L.append(f"  match_ref: {str(match_ref).lower()}   # "
                 + ("true = build each link to its own duration; the clips number above is ignored"
                    if match_ref else "false = the clips number above is the limit"))
        L.append(f"  seconds: {self.read_int(self.mcp_seconds_var, 8)}")
        L.append(f'  aspect: "{self.mcp_aspect_var.get().strip() or "Flow"}"')
        L.append(f'  video_model: "{self.mcp_video_model_var.get().strip() or "Flow"}"')
        L.append("  generate: false   # write the stories first, then review before spending credits")
        text = "\n".join(L)
        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(text)
        except Exception:
            pass
        messagebox.showinfo("Agent instruction copied", text)

    def kill_engine(self):
        if self.proc and self.proc.poll() is None:
            self.proc.kill()
            self.output.insert("end", "\n🛑 Killed.\n")

    def on_close(self):
        self.save_settings()
        self.root.destroy()


if __name__ == "__main__":
    # Crisp text on scaled displays: without this, Windows renders Tk at
    # 96dpi and stretches it, which is most of what made the UI look dated.
    try:
        from ctypes import windll
        windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    root = tk.Tk()
    app = Veo3LauncherGUI(root)
    root.mainloop()
