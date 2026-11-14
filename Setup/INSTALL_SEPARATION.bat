@echo off
setlocal
cd /d "%~dp0.."
if not exist ".separation-venv\Scripts\python.exe" (
  py -3.11 -m venv .separation-venv
  if errorlevel 1 exit /b 1
)
.separation-venv\Scripts\python.exe -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 exit /b 1
.separation-venv\Scripts\python.exe -m pip install -r Setup\requirements-separation.txt
if errorlevel 1 exit /b 1
.separation-venv\Scripts\python.exe -c "import demucs,torch,numpy,soundfile; print('Speech separation ready')"
