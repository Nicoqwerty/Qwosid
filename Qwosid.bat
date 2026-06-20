@echo off
REM Run from wherever this .bat lives, so it works on any machine
cd /d "%~dp0"
start /b cmd /c "npm run dev > nul 2>&1"
timeout /t 2 /nobreak > nul
start msedge --app=http://localhost:5173 --window-size=1400,900 --no-first-run
