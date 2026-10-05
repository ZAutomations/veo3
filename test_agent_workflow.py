"""Tab reorganization and manual routing, using temporary settings and local MCP."""
import json
import os
import tempfile
import tkinter as tk
from unittest.mock import patch
import veo3_gui as gui

with tempfile.TemporaryDirectory(prefix="veo-agent-tabs-") as tmp:
    gui.SETTINGS_FILE = os.path.join(tmp, "settings.json")
    with open(gui.SETTINGS_FILE, "w") as f:
        json.dump({"video_model": "OLD", "mcp_video_model": "Veo 3.1 - Fast",
                   "mcp_aspect": "1:1", "mcp_transport": "web", "mcp_from": 3}, f)
    root = tk.Tk()
    root.withdraw()
    try:
        app = gui.Veo3LauncherGUI(root)
        assert [app.nb.tab(t, "text") for t in app.nb.tabs()] == ["Script", "Accounts", "Ingredients (extend)", "Agent Mode", "MCP"]
        assert str(app.mcp_links).startswith(str(app.agent_tab) + ".")
        assert str(app.manual_story_box).startswith(str(app.agent_tab) + ".")
        assert str(app.integration_tools).startswith(str(app.mcp_tab) + ".")
        assert app.video_model_var is app.mcp_video_model_var
        assert app.aspect_var is app.mcp_aspect_var
        assert app.video_model_var.get() == "Veo 3.1 - Fast"
        assert app.mcp_transport_var.get() == "web" and app.mcp_from_var.get() == 3
        story = os.path.join(tmp, "example_story.json")
        with open(story, "w") as f:
            json.dump({"title": "Example", "scenes": []}, f)
        with open(os.path.join(tmp, "agent_prompt.txt"), "w") as f:
            f.write("fixture")
        app.mcp_stories.insert("1.0", story)
        app.refresh_manual_stories()
        assert app.agent_story_var.get() == story
        app.agent_cdp_var.set(9333)
        app.agent_url_var.set("https://flow.google.com/project/example")
        app.agent_start_phase_var.set("clips")
        assert str(app.agent_refs_check.cget("state")) == "disabled"
        with patch.object(app, "_launch", return_value=True) as launch, \
                patch.object(app, "_ensure_active_browser", return_value=True) as browser, \
                patch.object(app, "_refresh_prompt", return_value=True), \
                patch.object(gui.messagebox, "showerror") as error:
            app.manual_action(app.run_agent)
            cmd = launch.call_args.args[0]
            assert os.path.basename(cmd[1]) == "agent_mode.js"
            assert "--no-upload-refs" in cmd and "--project-url" in cmd and "--no-submit" in cmd
            assert cmd[cmd.index("--aspect") + 1] == "1:1"
            browser.assert_called_with(9333)
            app.manual_action(app.download_clips)
            cmd = launch.call_args.args[0]
            assert os.path.basename(cmd[1]) == "agent_download.js" and "--project-url" in cmd
            os.makedirs(os.path.join(tmp, "clips"), exist_ok=True)
            app.manual_action(app.join_clips)
            assert os.path.basename(launch.call_args.args[0][1]) == "join_clips.js"
            app.manual_action(app.resolve_clip_order)
            assert os.path.basename(launch.call_args.args[0][1]) == "order_clips_by_dialogue.js"
            app.mcp_generate_var.set(True)
            app.copy_agent_instruction()
            text = root.clipboard_get()
            payload = json.loads(text.split("arguments:\n", 1)[1].split("\nUse existing", 1)[0])
            assert payload == app.workflow_request(True)
            assert payload["project_url"].endswith("/example") and payload["no_upload_refs"]
            assert not payload["new_project"] and payload["transport"] == "web"
            assert "from" not in payload
            app.agent_url_var.set("https://example.com/")
            app.copy_agent_instruction()
            error.assert_called_once()
        with patch.object(app, "_ui", side_effect=lambda fn: fn()):
            with patch.object(gui.threading, "Thread") as thread:
                app.test_mcp_connection()
                target = thread.call_args.kwargs["target"]
            target()
            assert app.integration_tools.size() == 14
            assert app.integration_status.get().startswith("Connected")
            with patch.object(gui.threading, "Thread") as thread:
                app.inspect_mcp_story()
                target = thread.call_args.kwargs["target"]
            target()
            assert "Example" in app.integration_output.get("1.0", "end")
        app._workflow_running = True
        with patch.object(gui.messagebox, "showwarning") as warning, patch.object(app, "_launch") as launch:
            app.manual_action(app.run_agent)
            launch.assert_not_called()
            warning.assert_called_once()
        app._workflow_running = False
        app.save_settings()
        with open(gui.SETTINGS_FILE) as f:
            saved = json.load(f)
        assert saved["video_model"] == saved["mcp_video_model"] == "Veo 3.1 - Fast"
        assert saved["mcp_transport"] == "web" and saved["mcp_from"] == 3
        print("Tab checks passed: layout, saved settings, shared controls, manual stages, copied request, real MCP diagnostics, busy guard.")
    finally:
        root.destroy()
