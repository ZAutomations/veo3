@echo off
setlocal
call "%~dp0..\Setup\environment.bat"
chcp 65001 >nul
cd /d "%~dp0"
title Story banao - Gemini ke jawab se

echo.
echo   ============================================
echo    GEMINI KE JAWAB SE STORY BANANA
echo   ============================================
echo.
echo   Gemini ne jo jawab diya, usay ek .txt file mein save karein.
echo   Us file ka poora path neeche paste karein - ya us file ko
echo   is .bat file ke upar DRAG kar dein.
echo.

set "ANSWER=%~1"
if "%ANSWER%"=="" set /p ANSWER="  Jawab wali file ka path: "
if "%ANSWER%"=="" goto :end
set "ANSWER=%ANSWER:"=%"

if not exist "%ANSWER%" (
  echo.
  echo   Ye file nahi mili:
  echo   %ANSWER%
  goto :end
)

echo.
echo   Title: khali chhorein to video ka apna title khud le liya jayega
echo          (sirf tab likhein jab title badalna ho)
set /p TITLE="  Title: "

echo.
if "%TITLE%"=="" (
  node make_story_from_answer.js "%ANSWER%" --preset relationship-dialogue-real
) else (
  node make_story_from_answer.js "%ANSWER%" --preset relationship-dialogue-real --title "%TITLE%"
)

:end
echo.
pause
