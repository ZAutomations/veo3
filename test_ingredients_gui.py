"""Ingredients controls and phase handoff, no browser or real settings writes."""
import json
import os
import tempfile
import tkinter as tk
from unittest.mock import Mock, patch
import veo3_gui as gui

with tempfile.TemporaryDirectory(prefix="veo-ingredients-") as tmp:
    gui.SETTINGS_FILE = os.path.join(tmp, "settings.json")
    root = tk.Tk()
    root.withdraw()
    try:
        app = gui.Veo3LauncherGUI(root)
        story = os.path.join(tmp, "test_story.json")
        with open(story, "w") as f:
            json.dump({"title": "Test", "scenes": []}, f)
        app.story_var.set(story)
        app.ing_video_model_var.set("Veo 3.1 - Fast")
        app.ing_aspect_var.set("16:9")
        app.ing_new_project_var.set(True)
        app.ing_download_var.set(False)
        app.ing_join_var.set(False)
        original_agent_ratio = app.aspect_var.get()
        with patch.object(app, "_ensure_active_browser", return_value=True), \
                patch.object(app, "_account_store", return_value=None), \
                patch.object(app, "_launch", return_value=True) as launch:
            app.run_engine(refs_only=True)
            cmd = launch.call_args.args[0]
            assert "--refs-only" in cmd and "--new-project" in cmd
            assert "--join" not in cmd and app._rotate_ctx is None
            app.run_engine()
            cmd = launch.call_args.args[0]
            assert cmd[cmd.index("--video-model") + 1] == "Veo 3.1 - Fast"
            assert cmd[cmd.index("--aspect") + 1] == "16:9" and "--no-download" in cmd
            assert app.aspect_var.get() == original_agent_ratio
            app.run_engine(export_only=True)
            cmd = launch.call_args.args[0]
            assert "--export-only" in cmd
            assert not any(flag in cmd for flag in ["--gen-refs", "--new-project", "--no-download"])
        process = Mock()
        process.poll.return_value = 0
        with patch.object(gui.subprocess, "Popen", return_value=process), patch.object(gui.threading, "Thread"):
            app._launch(["node", gui.ENGINE, story, "--refs-only"], "fixture")
            assert app._ingredients_job["refs_only"]
        app._ingredients_job["project"] = "https://flow.google.com/project/example"
        with patch.object(app, "_refresh_accounts_list"):
            app._handle_proc_exit(0)
        assert not app.ing_new_project_var.get() and not app.gen_refs_var.get()
        assert app.url_var.get().endswith("/example")
        with patch.object(app, "_ensure_active_browser", return_value=True), \
                patch.object(app, "_account_store", return_value=None), \
                patch.object(app, "_launch", return_value=True) as launch:
            app.run_engine()
            assert "--no-upload-refs" in launch.call_args.args[0]
            assert "--new-project" not in launch.call_args.args[0]
            # A scene-range resume must override stale phase-1 checkboxes. This
            # is the real failure: From 2 used to create a new project and make
            # scene 2 as that project's first clip.
            app.from_var.set(2)
            app.to_var.set(4)
            app.ing_new_project_var.set(True)
            app.gen_refs_var.set(True)
            app.run_engine()
            cmd = launch.call_args.args[0]
            assert cmd[cmd.index("--from") + 1] == "2"
            assert "--project-url" in cmd
            assert "--new-project" not in cmd and "--gen-refs" not in cmd
            assert not app.ing_new_project_var.get() and not app.gen_refs_var.get()
            assert "Resuming the current Ingredients project from scene 2" in launch.call_args.args[1]
            app.from_var.set(1)
            app.ingredients_saved_couple_var.set(True)
            app.skip_refs_var.set(True)  # stale state cannot override saved mode
            app.run_engine()
            cmd = launch.call_args.args[0]
            assert "--skip-refs" not in cmd
            assert "--gen-refs" in cmd and "--refs-on-clip1" in cmd
            app.from_var.set(2)
            app.run_engine()
            cmd = launch.call_args.args[0]
            assert "--gen-refs" not in cmd and "--new-project" not in cmd
            app.ingredients_saved_couple_var.set(False)
        app.add_ingredients_stories([story, story])
        assert app._mcp_text(app.ing_stories).splitlines() == [story]
        app.ing_batch_from_var.set(1)
        app.ing_batch_to_var.set(0)
        with patch.object(app, "_ensure_active_browser", return_value=True), \
                patch.object(app, "_account_store", return_value=None), \
                patch.object(gui.messagebox, "askyesno", return_value=True), \
                patch.object(gui, "BASE_DIR", tmp), \
                patch.object(app, "_launch", return_value=True) as launch:
            app.run_ingredients_batch()
            cmd = launch.call_args.args[0]
            assert cmd[1].endswith("ingredients_batch.js")
            with open(cmd[2], encoding="utf-8") as stream:
                payload = json.load(stream)
            assert payload["stories"] == [story]
            assert payload["from"] == 1 and payload["to"] == 0
            assert payload["options"]["aspect"] == "16:9"
            assert payload["options"]["video_model"] == "Veo 3.1 - Fast"
            assert payload["options"]["download"] is False
            assert "project_url" not in payload["options"]
            app.run_ingredients_batch(refs_only=True)
            with open(launch.call_args.args[0][2], encoding="utf-8") as stream:
                assert json.load(stream)["options"]["refs_only"] is True
        print("Ingredients GUI passed: independent settings, phase-only flags, export-only, launch tracking, project reuse, batch request.")
    finally:
        root.destroy()
