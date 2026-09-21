"""Tests for the MCP tab: file import (.txt/.csv/.xlsx), idea parsing, and the
Python MCP client talking to the real mcp_server.js.

Run: python test_mcp_gui.py
Uses a withdrawn Tk root and a throwaway settings file, so the real
gui_settings.json is never touched. The client test spawns the actual node
server and calls list_presets - local only, no network.
"""
import json
import os
import sys
import tempfile
import tkinter as tk
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

TMP = tempfile.mkdtemp(prefix="veo3_mcp_")
SETTINGS = os.path.join(TMP, "gui_settings.json")
with open(SETTINGS, "w", encoding="utf-8") as f:
    json.dump({"mcp_clips": 6, "mcp_preset": "3d-map"}, f)

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


def make_xlsx(path):
    """A minimal .xlsx with just the two parts the reader needs."""
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    shared = ["https://youtube.com/shorts/AAA",
              "Borders You Can Never Cross",
              "a geography short about sealed borders"]
    ss = (f'<?xml version="1.0"?><sst xmlns="{ns}" count="{len(shared)}" '
          f'uniqueCount="{len(shared)}">' +
          "".join(f"<si><t>{s}</t></si>" for s in shared) + "</sst>")
    sheet = (f'<?xml version="1.0"?><worksheet xmlns="{ns}"><sheetData>'
             '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
             '<row r="2"><c r="A2" t="s"><v>1</v></c>'
             '<c r="B2" t="s"><v>2</v></c></row>'
             "</sheetData></worksheet>")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/sharedStrings.xml", ss)
        z.writestr("xl/worksheets/sheet1.xml", sheet)


print("\n--- .xlsx reading (no third-party package) ---")
xlsx = os.path.join(TMP, "items.xlsx")
make_xlsx(xlsx)
rows = veo3_gui.read_xlsx_rows(xlsx)
ok("reads two rows", len(rows) == 2, str(rows))
ok("row 1 holds the link", rows[0] == ["https://youtube.com/shorts/AAA"], str(rows[0]))
ok("row 2 holds the title and details",
   rows[1] == ["Borders You Can Never Cross", "a geography short about sealed borders"], str(rows[1]))

print("\n--- rows become references and ideas ---")
refs, ideas = veo3_gui.Veo3LauncherGUI._rows_to_items(rows)
ok("the link row is a reference", refs == ["https://youtube.com/shorts/AAA"], str(refs))
ok("the title row is an idea", ideas == [{
    "title": "Borders You Can Never Cross",
    "detail": "a geography short about sealed borders"}], str(ideas))
refs2, ideas2 = veo3_gui.Veo3LauncherGUI._rows_to_items(
    [["Title", "Details"], ["What If...", "a 3D explainer"], ["", ""]])
ok("a header row is skipped", len(ideas2) == 1 and ideas2[0]["title"] == "What If...", str(ideas2))
ok("blank rows are skipped", refs2 == [])

print("\n--- a title with no details is still an idea ---")
_, ideas3 = veo3_gui.Veo3LauncherGUI._rows_to_items([["A Lone Title"]])
ok("kept, with an empty detail", ideas3 == [{"title": "A Lone Title", "detail": ""}], str(ideas3))

print("\n--- idea line format ---")
ok("title | preset | detail",
   veo3_gui.Veo3LauncherGUI._idea_line({"title": "T", "preset": "3d-map", "detail": "D"}) == "T | 3d-map | D")
ok("title | detail",
   veo3_gui.Veo3LauncherGUI._idea_line({"title": "T", "detail": "D"}) == "T | D")
ok("title alone", veo3_gui.Veo3LauncherGUI._idea_line({"title": "T"}) == "T")

print("\n--- .txt and .csv import ---")
txt = os.path.join(TMP, "links.txt")
with open(txt, "w", encoding="utf-8") as f:
    f.write("# comment\nhttps://youtube.com/shorts/BBB\n\nMy Idea | some details\n")
csv = os.path.join(TMP, "ideas.csv")
with open(csv, "w", encoding="utf-8") as f:
    f.write("Title,Details\nDark Border Facts,a map short\n")

root = tk.Tk()
root.withdraw()
app = veo3_gui.Veo3LauncherGUI(root)

r1, i1 = app._read_items_file(txt)
ok("txt: the link is a reference", r1 == ["https://youtube.com/shorts/BBB"], str(r1))
ok("txt: the other line is an idea", i1 == [{"title": "My Idea", "detail": "some details"}], str(i1))
r2, i2 = app._read_items_file(csv)
ok("csv: the header is skipped", i2 == [{"title": "Dark Border Facts", "detail": "a map short"}], str(i2))

print("\n--- the MCP tab exists and parses ideas ---")
ok("the tab built its widgets", hasattr(app, "mcp_links") and hasattr(app, "mcp_ideas"))
ok("it has the option vars", all(hasattr(app, v) for v in (
    "mcp_preset_var", "mcp_seconds_var", "mcp_clips_var", "mcp_aspect_var",
    "mcp_generate_var", "mcp_download_var", "mcp_join_var", "mcp_auto_approve_var",
    "mcp_new_project_var")))
ok("the saved clips floor loaded", int(app.mcp_clips_var.get()) == 6, str(app.mcp_clips_var.get()))
ok("the saved preset loaded", app._mcp_preset_id() == "3d-map", app._mcp_preset_id())

app.mcp_ideas.delete("1.0", "end")
app.mcp_ideas.insert("1.0", "# a comment\nTitle One | 3d-map | details one\nTitle Two | just details\nTitle Three\n")
parsed = app._parse_idea_lines()
ok("three ideas parsed", len(parsed) == 3, str(parsed))
ok("title | preset | detail", parsed[0] == {"title": "Title One", "preset": "3d-map", "detail": "details one"}, str(parsed[0]))
ok("title | detail", parsed[1] == {"title": "Title Two", "detail": "just details"}, str(parsed[1]))
ok("title alone", parsed[2] == {"title": "Title Three"}, str(parsed[2]))

print("\n--- the preset list toggle (Classic / GENAI Presets) ---")
ok("there is a group variable", hasattr(app, "preset_group_var"))
ok("it defaults to Classic", app.preset_group_var.get() == "Classic", app.preset_group_var.get())
gd, gids, _, _ = veo3_gui.load_style_presets("GENAI Presets")
ok("GENAI Presets is a real list", len(gids) >= 4, str(len(gids)))
ok("it holds the genai presets", any(str(i).startswith("genai-") for i in gids.values()),
   str(list(gids.values())[:3]))
app.preset_group_var.set("GENAI Presets")
try:
    app.root.update_idletasks()
except Exception:
    pass
ok("switching the group repopulates the MCP picker",
   any("genai-" in str(v) for v in app.mcp_preset_box.cget("values")),
   str(app.mcp_preset_box.cget("values"))[:140])
ok("and the Script picker", any("genai-" in str(v) for v in app.gen_preset_box.cget("values")))

print("\n--- the Python MCP client drives the real server ---")
try:
    from mcp_client import MCPClient
    logs = []
    client = MCPClient(veo3_gui.MCP_SERVER, cwd=HERE, log=logs.append)
    client.start()
    res = client.call_tool("list_presets", {})
    presets = json.loads(res["text"])
    ids = [p["id"] for p in presets]
    ok("list_presets came back", not res["isError"] and len(presets) > 5, str(len(presets)))
    ok("it includes relationship-dialogue", "relationship-dialogue" in ids)
    ok("and the new map/3d presets", "3d-map" in ids and "geography-map" in ids and "3d-explainer" in ids)
    st = client.call_tool("batch_pipeline", {})
    ok("an empty batch reports isError", st["isError"] is True, st["text"][:80])
    client.stop()
    ok("the server logged to stderr", any("ready on stdio" in l for l in logs), str(logs[:2]))
except Exception as e:
    ok("MCP client ran", False, str(e))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
