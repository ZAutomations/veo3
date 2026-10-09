@echo off
setlocal
title VEO3 - Install requirements
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "SETUP_RESULT=%ERRORLEVEL%"
echo.
if not "%SETUP_RESULT%"=="0" echo Setup did not finish. See the error above and Setup\setup.log, then run this file again.
pause
exit /b %SETUP_RESULT%
