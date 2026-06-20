@echo off
REM Launches the Qwosid desktop (Electron) app. Runs from wherever this .bat
REM lives, so it works on any machine.
cd /d "%~dp0"

REM If a packaged build already exists, launch it directly (instant, no console).
if exist "release\win-unpacked\Qwosid.exe" (
  start "" "release\win-unpacked\Qwosid.exe"
  exit /b
)

REM First-time / source checkout: install deps, build the UI, run Electron.
if not exist "node_modules\" (
  echo Installing dependencies, this only happens once...
  call npm install
)
echo Building Qwosid...
call npm run build
if errorlevel 1 (
  echo Build failed - see the messages above.
  pause
  exit /b 1
)
echo Starting Qwosid...
start "" cmd /c "npx electron ."
exit /b
