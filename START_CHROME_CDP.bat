@echo off
title VEO3 Automation Browser (dedicated profile + CDP)
REM Same dedicated browser the engine launches: system Chrome binary + the
REM persistent cloned profile (Flow login included) at %LOCALAPPDATA%\flow-mcp-profile.
REM Keep the --user-data-dir in sync with buildDedicatedProfile() in
REM veo3_flow_new_ui.js - a different dir means a different browser with no login.
REM A custom --user-data-dir is REQUIRED: modern Chrome ignores the debug port on the default profile.
REM
REM You normally do NOT need this script - the engine starts this browser itself
REM when nothing is listening on the CDP port. Use it only to pre-warm the browser
REM or to log into Flow by hand.

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\flow-mcp-profile" --profile-directory="Profile 3" --no-first-run --no-default-browser-check --disable-blink-features=AutomationControlled --window-size=1920,1080
echo Automation browser started with CDP on port 9222.
