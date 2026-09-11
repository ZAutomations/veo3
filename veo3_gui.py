#!/usr/bin/env python3
"""
VEO3 FLOW NEW-UI LAUNCHER GUI
=============================
Slim tkinter GUI that provides the basic starting data and launches the
Node engine (veo3_flow_new_ui.js) in its own terminal window.

Fields:
  - Story JSON picker (stories/ folder)
  - Scene range (From / To)
  - Skip refs upload (refs already in project)
  - Project URL (optional - engine asks if empty)
  - CDP port (your Chrome debug port, default 9222)
"""

import json
import os
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(BASE_DIR, "veo3_flow_new_ui.js")
SETTINGS_FILE = os.path.join(BASE_DIR, "gui_settings.json")
STORIES_DIR = os.path.join(BASE_DIR, "stories")

DEFAULTS = {
    "story_json": "",
    "from_scene": 1,
    "to_scene": 5,
    "skip_refs": False,
    "project_url": "",
    "cdp_port": 9222,
}


class Veo3LauncherGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("VEO3 Flow New-UI Launcher")
        self.root.geometry("760x520")
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
        style.configure("TButton", font=("Segoe UI", 10, "bold"), padding=6)
        style.configure("TCheckbutton", background="#1e1e28", foreground="#e8e8f0")
        style.configure("TEntry", fieldbackground="#2a2a38", foreground="#e8e8f0")
        style.configure("TSpinbox", fieldbackground="#2a2a38", foreground="#e8e8f0")

    # ── ui ────────────────────────────────────────────────────
    def build_ui(self):
        pad = dict(padx=14, pady=6)

        ttk.Label(self.root, text="🎬 VEO3 Flow New-UI Launcher", style="Header.TLabel").grid(
            row=0, column=0, columnspan=3, sticky="w", padx=14, pady=(14, 4))

        # Story JSON
        ttk.Label(self.root, text="Story JSON:").grid(row=1, column=0, sticky="e", **pad)
        self.story_var = tk.StringVar(value=self.settings["story_json"])
        ttk.Entry(self.root, textvariable=self.story_var, width=58).grid(row=1, column=1, **pad)
        ttk.Button(self.root, text="Browse…", command=self.browse_story).grid(row=1, column=2, **pad)

        # Story info (scenes count / characters)
        self.story_info = tk.StringVar(value="No story loaded")
        ttk.Label(self.root, textvariable=self.story_info, style="Hint.TLabel").grid(
            row=2, column=1, columnspan=2, sticky="w")

        # Scene range
        ttk.Label(self.root, text="Scene range:").grid(row=3, column=0, sticky="e", **pad)
        rng = tk.Frame(self.root, bg="#1e1e28")
        rng.grid(row=3, column=1, sticky="w", **pad)
        self.from_var = tk.IntVar(value=self.settings["from_scene"])
        self.to_var = tk.IntVar(value=self.settings["to_scene"])
        tk.Label(rng, text="From", bg="#1e1e28", fg="#e8e8f0").pack(side="left")
        ttk.Spinbox(rng, from_=1, to=99, textvariable=self.from_var, width=4).pack(side="left", padx=6)
        tk.Label(rng, text="To", bg="#1e1e28", fg="#e8e8f0").pack(side="left", padx=(14, 0))
        ttk.Spinbox(rng, from_=1, to=99, textvariable=self.to_var, width=4).pack(side="left", padx=6)

        # Project URL
        ttk.Label(self.root, text="Project URL:").grid(row=4, column=0, sticky="e", **pad)
        self.url_var = tk.StringVar(value=self.settings["project_url"])
        ttk.Entry(self.root, textvariable=self.url_var, width=58).grid(row=4, column=1, columnspan=2, sticky="w", **pad)

        # CDP port
        ttk.Label(self.root, text="Chrome CDP port:").grid(row=5, column=0, sticky="e", **pad)
        self.cdp_var = tk.IntVar(value=self.settings["cdp_port"])
        ttk.Spinbox(self.root, from_=1024, to=65535, textvariable=self.cdp_var, width=8).grid(
            row=5, column=1, sticky="w", **pad)
        ttk.Label(self.root, text="(your logged-in Chrome - Profile 3)", style="Hint.TLabel").grid(
            row=5, column=1, sticky="w", padx=(120, 14), pady=6)

        # Options
        self.skip_refs_var = tk.BooleanVar(value=self.settings["skip_refs"])
        ttk.Checkbutton(self.root, text="Skip refs upload (refs already in project)",
                        variable=self.skip_refs_var).grid(row=6, column=1, sticky="w", **pad)

        # Run
        ttk.Button(self.root, text="▶  RUN ENGINE", command=self.run_engine).grid(
            row=7, column=1, sticky="w", pady=(16, 4))
        ttk.Button(self.root, text="⬜  Kill engine", command=self.kill_engine).grid(
            row=7, column=1, sticky="w", padx=(170, 14), pady=(16, 4))

        # Live output
        ttk.Label(self.root, text="Engine output:").grid(row=8, column=0, sticky="ne", **pad)
        self.output = tk.Text(self.root, height=14, bg="#14141c", fg="#c7f0c7",
                              insertbackground="#fff", font=("Consolas", 9))
        self.output.grid(row=8, column=1, columnspan=2, sticky="nsew", **pad)
        self.output.insert("end", "Waiting to start...\n")

        self.root.columnconfigure(1, weight=1)
        self.root.rowconfigure(8, weight=1)

        self.proc = None
        self.load_story_info()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    # ── actions ───────────────────────────────────────────────
    def browse_story(self):
        start = self.story_var.get() or STORIES_DIR
        p = filedialog.askopenfilename(initialdir=start, filetypes=[("Story JSON", "*.json")])
        if p:
            self.story_var.set(p)
            self.load_story_info()

    def load_story_info(self):
        p = self.story_var.get()
        if not p or not os.path.exists(p):
            self.story_info.set("No story loaded")
            return
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            n = len(data.get("scenes", []))
            chars = ", ".join((data.get("character_references") or {}).keys())
            has_url = "yes" if data.get("project_url") else "no"
            self.story_info.set(f"{n} scenes | characters: {chars or '-'} | project_url in json: {has_url}")
            self.to_var.set(n)
        except Exception as e:
            self.story_info.set(f"⚠️ Could not parse: {e}")

    def collect_inputs(self):
        self.settings.update({
            "story_json": self.story_var.get().strip(),
            "from_scene": int(self.from_var.get() or 1),
            "to_scene": int(self.to_var.get() or 5),
            "skip_refs": bool(self.skip_refs_var.get()),
            "project_url": self.url_var.get().strip(),
            "cdp_port": int(self.cdp_var.get() or 9222),
        })

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

        self.output.delete("1.0", "end")
        self.output.insert("end", "🚀 Starting engine in a separate console...\n\n")
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
            return
        threading.Thread(target=self.stream_output, daemon=True).start()

    def stream_output(self):
        try:
            for line in self.proc.stdout:
                self.output.insert("end", line)
                self.output.see("end")
        except Exception:
            pass
        code = self.proc.wait()
        self.output.insert("end", f"\n[engine exited with code {code}]\n")
        self.output.see("end")

    def kill_engine(self):
        if self.proc and self.proc.poll() is None:
            self.proc.kill()
            self.output.insert("end", "\n🛑 Engine killed.\n")

    def on_close(self):
        self.save_settings()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = Veo3LauncherGUI(root)
    root.mainloop()
