@echo off
set "PATH=%~dp0..\.venv\Scripts;%~dp0..\tools\node;%~dp0..\tools\ffmpeg\bin;%PATH%"
set "PUPPETEER_SKIP_DOWNLOAD=true"
