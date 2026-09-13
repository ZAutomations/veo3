@echo off
setlocal EnableExtensions
title VEO3 Portable - Setup

REM ─────────────────────────────────────────────────────────────────────────
REM  One-time setup for a fresh Windows PC.
REM
REM  Checks the four things this tool needs and installs whatever is
REM  missing, then installs the Node dependencies.
REM
REM    1. Node.js 18 or newer   - runs the automation (puppeteer)
REM    2. Python 3 with tkinter  - runs the desktop GUI
REM    3. Google Chrome          - the automation drives it over CDP
REM    4. npm packages           - puppeteer itself (npm install)
REM
REM  Safe to run more than once. Nothing is downloaded twice.
REM ─────────────────────────────────────────────────────────────────────────

cd /d "%~dp0"

echo ============================================================
echo    VEO3 Flow Automation  -  Portable Setup
echo ============================================================
echo.
echo  This PC will be checked for the four things the tool needs.
echo  Anything missing gets installed for you.
echo.
echo  It may ask for permission, and the downloads take a few
echo  minutes on a fresh machine. Let it run to the end.
echo.
pause
echo.

set "INSTALLED=0"

REM ═══════════════════════════════════ 1. Node.js
echo [1/4] Node.js ...
set "NODEVER="
for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODEVER=%%v"
if defined NODEVER (
    echo       OK - found Node %NODEVER%
    goto :node_done
)
echo       Not installed. Installing Node.js LTS ...
where winget >nul 2>&1
if errorlevel 1 goto :node_manual
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
echo.
echo       Install finished. Node.js becomes usable in a NEW window.
set "INSTALLED=1"
goto :node_done

:node_manual
echo.
echo       *** Could not install it automatically - winget is missing. ***
echo       Download Node.js LTS from  https://nodejs.org/en/download
echo       Run that installer, then run SETUP.bat again.
set "INSTALLED=1"

:node_done
echo.

REM ═══════════════════════════════════ 2. Python
echo [2/4] Python 3 ...
set "PYCMD="
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PYCMD=py -3"
if not defined PYCMD (
    python -c "import sys" >nul 2>&1
    if not errorlevel 1 set "PYCMD=python"
)
if defined PYCMD goto :python_found
echo       Not installed. Installing Python 3.12 ...
where winget >nul 2>&1
if errorlevel 1 goto :python_manual
winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
echo.
echo       Install finished. Python becomes usable in a NEW window.
set "INSTALLED=1"
goto :python_done

:python_manual
echo.
echo       *** Could not install it automatically - winget is missing. ***
echo       Download Python 3 from  https://www.python.org/downloads/
echo       IMPORTANT: tick "Add python.exe to PATH" in the installer.
echo       Then run SETUP.bat again.
set "INSTALLED=1"
goto :python_done

:python_found
for /f "tokens=*" %%v in ('%PYCMD% --version 2^>^&1') do set "PYVER=%%v"
echo       OK - found %PYVER%
REM tkinter is what the GUI is drawn with. It ships with the normal Python
REM installer, but a stripped build can leave it out - check, don't assume.
%PYCMD% -c "import tkinter" >nul 2>&1
if errorlevel 1 (
    echo       *** WARNING: this Python has no tkinter, so the GUI cannot open. ***
    echo       Re-run the Python installer and enable "tcl/tk and IDLE".
    set "INSTALLED=1"
)

:python_done
echo.

REM ═══════════════════════════════════ 3. Google Chrome
echo [3/4] Google Chrome ...
REM The engine resolves Chrome in CHROME_CANDIDATES (veo3_flow_new_ui.js) -
REM 64-bit, 32-bit and per-user installs are all fine. Mirror that here.
REM NB: keep %CHROME% echoes OUTSIDE parenthesized blocks - the "(x86)"
REM install path contains a ")" that would close the block mid-parse.
set "CHROME="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if defined CHROME goto :chrome_found
echo       Not found in any standard location.
where winget >nul 2>&1
if errorlevel 1 goto :chrome_manual
echo       Installing Google Chrome ...
winget install --id Google.Chrome -e --accept-source-agreements --accept-package-agreements
set "INSTALLED=1"
goto :chrome_done

:chrome_manual
echo.
echo       *** Install Chrome by hand from  https://www.google.com/chrome/ ***
echo       Then run SETUP.bat again.
set "INSTALLED=1"
goto :chrome_done

:chrome_found
echo       OK - found it at %CHROME%

:chrome_done
echo.

REM ═══════════════════════════════════ 4. npm packages
echo [4/4] Node packages ^(puppeteer^) ...
if not defined NODEVER (
    echo       SKIPPED - Node.js is not usable yet.
    echo       Close this window, then run SETUP.bat again.
    goto :summary
)
if exist "node_modules\puppeteer\package.json" (
    echo       OK - already installed
    goto :summary
)
echo       Downloading puppeteer - this is the slow part, please wait ...
call npm install
if errorlevel 1 (
    echo.
    echo       *** npm install failed. Read the red text above. ***
    echo       A common cause is no internet, or a proxy/firewall.
    set "INSTALLED=1"
) else (
    echo       OK - puppeteer installed
)

:summary
echo.
echo ============================================================
echo    Result
echo ============================================================
set "MISSING=0"

for /f "tokens=*" %%v in ('node --version 2^>nul') do set "N2=%%v"
if defined N2 (echo    Node.js   OK  %N2%) else (echo    Node.js   MISSING & set "MISSING=1")

set "P2="
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 set "P2=py -3"
if not defined P2 (
    python -c "import sys" >nul 2>&1
    if not errorlevel 1 set "P2=python"
)
if defined P2 (echo    Python    OK) else (echo    Python    MISSING & set "MISSING=1")

set "CHROME="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if defined CHROME (echo    Chrome    OK) else (echo    Chrome    MISSING & set "MISSING=1")

if exist "node_modules\puppeteer\package.json" (
    echo    puppeteer OK
) else (
    echo    puppeteer MISSING & set "MISSING=1"
)

echo.
if "%MISSING%"=="1" goto :not_ready
if "%INSTALLED%"=="1" goto :restart

echo    Everything is ready.
echo.
echo    ----------------------------------------------------------
echo      Double-click  START_GUI.bat  to open the tool.
echo    ----------------------------------------------------------
echo.
echo    The FIRST run opens an automation Chrome window.
echo    If Flow asks you to sign in, sign in once - it is
echo    remembered from then on. See README_FIRST.txt.
echo.
pause
exit /b 0

:restart
echo    Something was just installed, so this window cannot see
echo    it yet.
echo.
echo    ----------------------------------------------------------
echo      1. CLOSE this window
echo      2. Run SETUP.bat one more time
echo      3. Then run START_GUI.bat
echo    ----------------------------------------------------------
echo.
pause
exit /b 0

:not_ready
echo    Some of the four are still missing - see the list above.
echo    Fix those, then run SETUP.bat again.
echo.
pause
exit /b 1
