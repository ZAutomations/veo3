"""Local Tk and mocked client tests; no browser or account changes."""
import json
import os
import tempfile
import tkinter as tk
from unittest.mock import Mock, patch
import veo3_gui as gui

with tempfile.TemporaryDirectory(prefix="veo-phase-") as tmp:
    gui.SETTINGS_FILE = os.path.join(tmp, "settings.json")
    root = tk.Tk()
    root.withdraw()
    try:
        app = gui.Veo3LauncherGUI(root)
        assert app.mcp_start_phase_var.get() == "start"
        assert not app.mcp_resume_frame.winfo_manager()
        app.mcp_new_project_var.set(True)
        app.mcp_generate_refs_var.set(True)
        app.mcp_from_var.set(7)
        app.mcp_aspect_var.set("1:1")
        app.mcp_start_phase_var.set("clips")
        assert app.mcp_resume_frame.winfo_manager() == "grid"
        assert str(app.mcp_new_project_check.cget("state")) == "disabled"
        assert str(app.mcp_refs_check.cget("state")) == "disabled"
        assert str(app.mcp_write_button.cget("state")) == "disabled"
        story = os.path.join(tmp, "story.json")
        with open(story, "w") as f:
            json.dump({"title": "Example", "scenes": []}, f)
        app.mcp_stories.insert("1.0", story)
        app.mcp_resume_url_var.set("https://labs.google/fx/tools/flow/project/test-id")
        client = Mock()
        client.call_tool.return_value = {"text": "Done", "isError": False}
        with patch.object(app, "_ensure_active_browser", return_value=True) as browser, \
                patch.object(app, "_ui", side_effect=lambda fn: fn()), \
                patch.object(gui.messagebox, "askyesno", return_value=True), \
                patch.object(gui.messagebox, "showerror") as error, \
                patch("mcp_client.MCPClient", return_value=client), \
                patch.object(gui.threading, "Thread") as thread:
            app.run_mcp_batch(True)
            thread.call_args.kwargs["target"]()
            args = client.call_tool.call_args.args[1]
            assert args["start_phase"] == "clips"
            assert args["aspect"] == "1:1"
            assert args["project_url"] == "https://flow.google.com/project/test-id"
            assert not args["new_project"] and not args["generate_refs"]
            assert args["no_upload_refs"] and "from" not in args
            browser.reset_mock()
            app.mcp_resume_url_var.set("https://example.com/project/test")
            app.run_mcp_batch(True)
            error.assert_called_once()
            browser.assert_not_called()
        app.mcp_start_phase_var.set("start")
        assert not app.mcp_resume_frame.winfo_manager()
        assert str(app.mcp_refs_check.cget("state")) == "normal"
        assert app.mcp_new_project_var.get() and app.mcp_generate_refs_var.get()
        assert app.mcp_from_var.get() == 7
        print("MCP start-phase GUI checks passed: controls, payload, URL validation, preserved defaults.")
    finally:
        root.destroy()
