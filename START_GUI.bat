@echo off
title VEO3 Flow New-UI Launcher
REM Portable copy of the launcher: finds Python whichever way it was
REM installed - the py launcher (python.org / winget) or a python.exe
REM already on PATH. The original in the repo assumes `python` works.
set "PYCMD="
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PYCMD=py -3"
if not defined PYCMD (
    python -c "import sys" >nul 2>&1
    if not errorlevel 1 set "PYCMD=python"
)
if not defined PYCMD (
    echo.
    echo Python 3 was not found on this PC.
    echo Run SETUP.bat first, then close this window and try again.
    echo.
    pause
    exit /b 1
)
%PYCMD% "%~dp0veo3_gui.py"
if errorlevel 1 pause
