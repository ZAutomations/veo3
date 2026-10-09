@echo off
setlocal
call "%~dp0..\Setup\environment.bat"
chcp 65001 >nul
cd /d "%~dp0.."
title Agent prompt banao - stage 1

echo.
echo   ============================================
echo    AGENT PROMPT BANANA  (stage 1)
echo   ============================================
echo.
echo   Ye tab chalao jab character_refs folder mein tasveerein
echo   rakh di gayi hon.
echo.
echo   Aap ke story folders:
echo.
for /d %%D in ("stories\*") do (
  if exist "stories\%%~nxD\%%~nxD_story.json" echo       %%~nxD
)
echo.
echo   Neeche folder ka naam likhein - ya seedha story ki .json
echo   file ko is .bat ke upar DRAG kar dein.
echo.

set "NAME=%~1"
if "%NAME%"=="" set /p NAME="  Folder ka naam: "
if "%NAME%"=="" goto :end
set "NAME=%NAME:"=%"

for %%I in ("%NAME%") do set "LEAF=%%~nxI"
set "LEAF=%LEAF:_story.json=%"
set "LEAF=%LEAF:.json=%"

if not exist "stories\%LEAF%\%LEAF%_story.json" (
  echo.
  echo   Ye story nahi mili: stories\%LEAF%
  goto :end
)

echo.
npm run agent:prompt -- "stories\%LEAF%\%LEAF%_story.json"

:end
echo.
pause
