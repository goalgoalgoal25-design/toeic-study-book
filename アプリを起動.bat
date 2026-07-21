@echo off
rem TOEIC Study Book launcher
cd /d "%~dp0"

rem If the app server is already running, just open the browser.
netstat -an | findstr ":8765" | findstr "LISTENING" >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:8765/"
  exit /b
)

rem No python? Open the app directly as a file.
where python >nul 2>nul
if %errorlevel% neq 0 (
  start "" "index.html"
  exit /b
)

start "" "http://localhost:8765/"
python serve.py
if errorlevel 1 (
  echo.
  echo Server failed to start. Opening the app directly instead...
  start "" "index.html"
  pause
)
