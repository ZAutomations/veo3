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
    # Flow's project grid is newest-first, so DOM order is the reverse of scene
    # order and numbering clips by on-screen order names scene 7 as scene-01.mp4.
    # Both stories run so far have been newest-first, hence the default.
    "reverse": True,
}


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

        ing = ttk.Frame(self.nb)
        agt = ttk.Frame(self.nb)
        self.nb.add(ing, text="Ingredients (extend)")
        self.nb.add(agt, text="Agent Mode")

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
            os.startfile(d)
        else:
            messagebox.showinfo("No folder", "Pick a clips folder first.")

    def _story_path(self):
        """Prefer whichever tab is on screen, so RUN uses what the user sees."""
        if self.nb.index(self.nb.select()) == 1:
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
            except Exception as e:
                var.set(f"⚠️ Could not parse: {e}")

    def collect_inputs(self):
        self.settings.update({
            "story_json": self.story_var.get().strip(),
            "from_scene": int(self.from_var.get() or 1),
            "to_scene": int(self.to_var.get() or 5),
            "skip_refs": bool(self.skip_refs_var.get()),
            "project_url": self.url_var.get().strip(),
            "cdp_port": int(self.cdp_var.get() or 9222),
            "model_hint": self.model_var.get().strip(),
            "auto_approve": bool(self.auto_approve_var.get()),
            "no_submit": bool(self.no_submit_var.get()),
            "watch_secs": int(self.watch_var.get() or 300),
            "clips_dir": self.resolved_clips_dir(),
            "reverse": bool(self.reverse_var.get()),
        })

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

    # ── agent stages ──────────────────────────────────────────
    def build_prompt(self):
        self.collect_inputs()
        story = self.agent_story_var.get().strip()
        if not story or not os.path.exists(story):
            messagebox.showerror("Missing story", "Pick a valid story JSON first.")
            return
        self.save_settings()
        self._launch(["node", PROMPT_BUILDER, story],
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
