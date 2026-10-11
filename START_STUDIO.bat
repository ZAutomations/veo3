@echo off
setlocal
title VEO3 Studio
cd /d "%~dp0"
call "%~dp0Setup\environment.bat"
if exist "%~dp0.venv\Scripts\python.exe" (
    set "STUDIO_PYTHON=%~dp0.venv\Scripts\python.exe"
) else (
    set "STUDIO_PYTHON=python"
)
"%STUDIO_PYTHON%" -c "import fastapi,uvicorn,webview" >nul 2>&1
if errorlevel 1 (
    echo Installing desktop interface requirements...
    "%STUDIO_PYTHON%" -m pip install -r "%~dp0Setup\requirements-desktop.txt"
    if errorlevel 1 goto :failed
)
"%STUDIO_PYTHON%" "%~dp0desktop_app.py"
if errorlevel 1 goto :failed
exit /b 0
:failed
echo Studio could not start. Read the error above. The classic START_GUI.bat is still available.
pause
exit /b 1
