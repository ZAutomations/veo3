"""Smoke test: the GUI builds, and the video-model boxes round-trip.

A typo in an attribute name (self.video_model_var vs self.video_models_var) is
invisible to every other test here - the file still compiles, the Node suites do
not touch it, and it only fails when a user opens the tab or saves settings. So
the window is built for real, withdrawn, and the fields are read back through the
same collect_inputs() the Save button uses.

A fresh window per test: collect_inputs() mutates the app's settings in place, so
a shared one would carry each test's edits into the next.

Skips (rather than fails) where there is no display to build a Tk window on.

Run: python test_gui_smoke.py
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import tkinter as tk
    _probe = tk.Tk()
    _probe.withdraw()
    _probe.destroy()
    _HAVE_TK = True
except Exception as e:                                   # no display, no Tk
    _HAVE_TK = False

import veo3_gui


@unittest.skipUnless(_HAVE_TK, "no display available for Tk")
class GuiSmoke(unittest.TestCase):
    def test_script_links_batch_uses_script_settings_without_generation(self):
        app = self.app
        app.script_source_var.set("Video links")
        app.script_links.delete("1.0", "end")
        app.script_links.insert("1.0", "https://www.youtube.com/shorts/one\nhttps://www.youtube.com/shorts/two")
        app.gen_preset_var.set(next(display for display, pid in app._gen_ids.items() if pid == "relationship-dialogue-real"))
        app.gen_aspect_var.set("9:16")
        app.gen_duration_var.set(64)
        args = app.script_batch_request()
        self.assertEqual(len(args["references"]), 2)
        self.assertEqual(args["preset"], "relationship-dialogue-real")
        self.assertEqual(args["aspect"], "9:16")
        self.assertEqual(args["duration"], 64)
        self.assertTrue(args["match_ref"])
        for flag in ("generate", "submit", "generate_refs", "new_project", "download", "join"):
            self.assertFalse(args[flag])
        self.assertTrue(app.script_links.grid_info())
        self.assertFalse(app.gen_detail.grid_info())
        app.collect_inputs()
        self.assertEqual(app.settings["script_source"], "Video links")

    def test_script_multiline_stories_share_agent_parser_and_dispatch(self):
        from unittest.mock import patch
        app = self.app
        app.script_source_var.set("Multiple stories")
        app.gen_preset_var.set(next(iter(app._gen_ids)))
        text = "STORY 1\nTITLE: First\nMale: Hello.\nFemale: Hi.\n\nSTORY 2\nTITLE: Second\nA separate brief."
        app.script_ideas.insert("1.0", text)
        args = app.script_batch_request()
        self.assertEqual([idea["title"] for idea in args["ideas"]], ["First", "Second"])
        self.assertEqual(args["ideas"][0]["detail"], "Male: Hello.\nFemale: Hi.")
        self.assertNotIn("references", args)
        self.assertFalse(args["match_ref"])
        with patch.object(app, "write_script_batch", return_value="batch") as run:
            self.assertEqual(app.write_story(dry=True), "batch")
            run.assert_called_once_with(True)
        app.script_ideas.delete("1.0", "end")
        app.script_ideas.insert("1.0", "TITLE: One story\nFirst detail line\nSecond detail line")
        self.assertEqual(len(app.script_batch_request()["ideas"]), 1)
        app.script_source_var.set("Title & details")
        self.assertTrue(app.gen_detail.grid_info())
        self.assertFalse(app.script_ideas.grid_info())

    def test_saved_ingredients_mode_locks_and_restores_reference_options(self):
        app = self.app
        app.ingredients_saved_couple_var.set(False)
        for var, value in zip((app.skip_refs_var, app.gen_refs_var, app.refs_on_clip1_var), (True, False, False)):
            var.set(value)
        app.ingredients_saved_couple_var.set(True)
        self.assertEqual((app.skip_refs_var.get(), app.gen_refs_var.get(), app.refs_on_clip1_var.get()), (False, True, True))
        for widget in (app.skip_refs_check, app.gen_refs_check, app.refs_on_clip1_check):
            self.assertTrue(widget.instate(["disabled"]))
        app.skip_refs_var.set(True)
        app.gen_refs_var.set(False)
        app.refs_on_clip1_var.set(False)
        app.collect_inputs()
        self.assertEqual((app.settings["skip_refs"], app.settings["gen_refs"], app.settings["refs_on_clip1"]), (False, True, True))
        app.ingredients_saved_couple_var.set(False)
        self.assertEqual((app.skip_refs_var.get(), app.gen_refs_var.get(), app.refs_on_clip1_var.get()), (True, False, False))
        for widget in (app.skip_refs_check, app.gen_refs_check, app.refs_on_clip1_check):
            self.assertFalse(widget.instate(["disabled"]))

    def test_saved_couple_controls_round_trip(self):
        self.app.agent_saved_couple_var.set(True)
        self.app.ingredients_saved_couple_var.set(False)
        self.app.couple_sarah_file_var.set("D:/references/sarah.png")
        self.app.couple_george_file_var.set("D:/references/george.jpg")
        self.app.collect_inputs()
        self.assertTrue(self.app.settings["agent_saved_couple"])
        self.assertFalse(self.app.settings["ing_saved_couple"])
        self.assertEqual(self.app.settings["couple_sarah_file"], "D:/references/sarah.png")
        self.assertEqual(self.app.settings["couple_george_file"], "D:/references/george.jpg")

    def setUp(self):
        self._tmpdirs = []
        self._real_settings_file = veo3_gui.SETTINGS_FILE
        # save_settings() writes to the module-level SETTINGS_FILE, which is the
        # user's real gui_settings.json - it holds their Flow project URLs and
        # Gemini API keys. Tests redirect it to a temp path, and this snapshot
        # proves they did: if the redirect ever stops working, the test that
        # saves would quietly overwrite real credentials instead of failing.
        self._real_settings = None
        if os.path.exists(self._real_settings_file):
            with open(self._real_settings_file, "rb") as f:
                self._real_settings = f.read()

        # Point the app at a settings file that does not exist, so it loads
        # DEFAULTS. Without this every assertion below would depend on whatever
        # the user last saved, and a real preference for a model - a perfectly
        # good thing for them to have - would fail "defaults to Flow".
        self.settings_path = self.temp_settings()
        veo3_gui.SETTINGS_FILE = self.settings_path

        self.root = tk.Tk()
        self.root.withdraw()
        self.app = veo3_gui.Veo3LauncherGUI(self.root)

    def tearDown(self):
        try:
            self.root.destroy()
        except Exception:
            pass
        veo3_gui.SETTINGS_FILE = self._real_settings_file
        for d in self._tmpdirs:
            shutil.rmtree(d, ignore_errors=True)
        if self._real_settings is not None:
            with open(self._real_settings_file, "rb") as f:
                now = f.read()
            if now != self._real_settings:
                with open(self._real_settings_file, "wb") as f:
                    f.write(self._real_settings)
                self.fail("gui_settings.json was modified by a test - restored it, "
                          "but the SETTINGS_FILE redirect has stopped working")

    def temp_settings(self):
        """A throwaway gui_settings.json path; cleaned up in tearDown."""
        d = tempfile.mkdtemp(prefix="veo3_gui_smoke_")
        self._tmpdirs.append(d)
        return os.path.join(d, "gui_settings.json")

    # collect_inputs() updates self.settings and returns None - read it back.
    def saved(self, key):
        self.app.collect_inputs()
        return self.app.settings[key]

    def test_the_window_builds(self):
        self.assertIsNotNone(self.app)

    def test_both_model_boxes_exist(self):
        self.assertTrue(hasattr(self.app, "video_model_var"), "Agent tab video model box")
        self.assertTrue(hasattr(self.app, "mcp_video_model_var"), "MCP tab video model box")

    def test_both_boxes_default_to_Flow(self):
        self.assertEqual(self.app.video_model_var.get(), "Flow")
        self.assertEqual(self.app.mcp_video_model_var.get(), "Flow")

    def test_Flow_is_offered_in_the_list(self):
        # "Flow" is the sentinel meaning "leave the project alone"; without it the
        # box could not express the value it starts on.
        self.assertIn("Flow", veo3_gui.VIDEO_MODELS)

    def test_the_real_model_names_are_offered(self):
        for name in ("Veo 3.1 - Fast", "Veo 3.1 - Quality",
                     "Veo 3.1 - Lite [Lower Priority]", "Omni 1.1 Flash"):
            self.assertIn(name, veo3_gui.VIDEO_MODELS)

    def test_the_list_matches_the_live_Flow_menu(self):
        # The exact five names probe_models.js read off a real Flow menu on
        # 2026-09-22, plus the "Flow" sentinel. Pinned because the inspect data
        # this was first built from listed only four - it missed plain
        # "Veo 3.1 - Lite", which sits right next to the bracketed one.
        self.assertEqual(veo3_gui.VIDEO_MODELS, [
            "Flow",
            "Omni 1.1 Flash",
            "Veo 3.1 - Lite",
            "Veo 3.1 - Fast",
            "Veo 3.1 - Quality",
            "Veo 3.1 - Lite [Lower Priority]",
        ])

    def test_the_two_lite_models_are_not_confused_for_each_other(self):
        # They differ only by a bracketed suffix, so the picker's loose-key
        # match has to tell them apart - a prefix match would not.
        import re
        key = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
        self.assertNotEqual(key("Veo 3.1 - Lite"), key("Veo 3.1 - Lite [Lower Priority]"))
        self.assertTrue(key("Veo 3.1 - Lite [Lower Priority]").startswith(key("Veo 3.1 - Lite")),
                        "the exact-first rule in setSectionModel is load-bearing")

    def test_every_offered_model_is_in_the_live_menu(self):
        # "Flow" is the sentinel, not a model Flow lists - everything else must
        # be a name the menu actually carries, or picking it would fail.
        live = {"Omni 1.1 Flash", "Veo 3.1 - Lite", "Veo 3.1 - Fast",
                "Veo 3.1 - Quality", "Veo 3.1 - Lite [Lower Priority]"}
        self.assertEqual(set(veo3_gui.VIDEO_MODELS) - {"Flow"}, live)

    def test_the_agent_box_reaches_the_saved_settings(self):
        self.app.video_model_var.set("Veo 3.1 - Fast")
        self.assertEqual(self.saved("video_model"), "Veo 3.1 - Fast")

    def test_the_mcp_box_reaches_the_saved_settings(self):
        self.app.mcp_video_model_var.set("Omni 1.1 Flash")
        self.assertEqual(self.saved("mcp_video_model"), "Omni 1.1 Flash")

    def test_an_empty_agent_box_falls_back_to_Flow(self):
        # Empty would reach the CLI as --video-model "" and be treated as unset,
        # which is right by accident; the sentinel makes it right on purpose.
        self.app.video_model_var.set("   ")
        self.assertEqual(self.saved("video_model"), "Flow")

    def test_an_empty_mcp_box_falls_back_to_Flow(self):
        self.app.mcp_video_model_var.set("")
        self.assertEqual(self.saved("mcp_video_model"), "Flow")

    def test_workflow_and_manual_tools_share_one_value(self):
        # Manual and automatic stages now intentionally use one workflow model.
        self.app.video_model_var.set("Veo 3.1 - Fast")
        self.app.mcp_video_model_var.set("Omni 1.1 Flash")
        self.app.collect_inputs()
        self.assertEqual(self.app.settings["video_model"], "Omni 1.1 Flash")
        self.assertEqual(self.app.settings["mcp_video_model"], "Omni 1.1 Flash")

    def test_a_model_typed_by_hand_is_kept(self):
        # The box is editable on purpose, so a model Flow ships later works
        # without waiting for VIDEO_MODELS to learn about it.
        self.app.video_model_var.set("Veo 4 - Whatever")
        self.assertEqual(self.saved("video_model"), "Veo 4 - Whatever")

    def test_the_model_survives_a_save_and_relaunch(self):
        # Write to a real settings file, then build a second window from it - what
        # a relaunch does. A field that is saved but never read back looks fine
        # until the next launch silently resets it to Flow.
        #
        # Both boxes are built from self.settings at construction, so this
        # exercises the whole loop: box -> collect_inputs -> json -> box.
        tmp = self.temp_settings()
        real = veo3_gui.SETTINGS_FILE
        veo3_gui.SETTINGS_FILE = tmp
        try:
            self.app.video_model_var.set("Omni 1.1 Flash")
            self.app.mcp_video_model_var.set("Veo 3.1 - Lite [Lower Priority]")
            self.app.save_settings()
            self.assertTrue(os.path.exists(tmp), "save_settings wrote nothing")

            root2 = tk.Tk()
            root2.withdraw()
            try:
                app2 = veo3_gui.Veo3LauncherGUI(root2)
                self.assertEqual(app2.video_model_var.get(), "Veo 3.1 - Lite [Lower Priority]")
                self.assertEqual(app2.mcp_video_model_var.get(),
                                 "Veo 3.1 - Lite [Lower Priority]")
            finally:
                root2.destroy()
        finally:
            veo3_gui.SETTINGS_FILE = real

    def test_a_saved_preference_is_loaded_and_shown(self):
        # The other half of the default test: a model the user picked must come
        # back in the box, not be overwritten by the default. This is what the
        # app really did when it failed the "defaults to Flow" assertion - the
        # saved value was right and the test was reading the user's own file.
        tmp = self.temp_settings()
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"video_model": "Veo 3.1 - Lite [Lower Priority]",
                       "mcp_video_model": "Omni 1.1 Flash"}, f)
        veo3_gui.SETTINGS_FILE = tmp
        root2 = tk.Tk()
        root2.withdraw()
        try:
            app2 = veo3_gui.Veo3LauncherGUI(root2)
            self.assertEqual(app2.video_model_var.get(), "Omni 1.1 Flash")
            self.assertEqual(app2.mcp_video_model_var.get(), "Omni 1.1 Flash")
        finally:
            root2.destroy()

    def test_a_settings_file_without_the_key_still_gets_the_default(self):
        # Every gui_settings.json in the wild predates this feature, so the load
        # path has to fill the gap rather than KeyError or leave the box blank.
        tmp = self.temp_settings()
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"project_url": "https://labs.google/fx/tools/flow/project/abc"}, f)

        real = veo3_gui.SETTINGS_FILE
        veo3_gui.SETTINGS_FILE = tmp
        try:
            root2 = tk.Tk()
            root2.withdraw()
            try:
                app2 = veo3_gui.Veo3LauncherGUI(root2)
                self.assertEqual(app2.video_model_var.get(), "Flow")
                self.assertEqual(app2.mcp_video_model_var.get(), "Flow")
            finally:
                root2.destroy()
        finally:
            veo3_gui.SETTINGS_FILE = real


if __name__ == "__main__":
    unittest.main(verbosity=2)
