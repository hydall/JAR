@echo off
setlocal enableextensions
title Janitor Lorebook Extractor

rem ============================================================================
rem  One-click launcher for non-technical users.
rem  - Installs Node.js (via winget) if it's missing
rem  - Installs dependencies + the Chromium browser on first run
rem  - Creates .env from the template on first run
rem  - Starts the server (which opens the UI in your default browser)
rem  Just double-click this file.
rem ============================================================================

rem Work from the folder this script lives in (handles spaces in the path).
pushd "%~dp0"

echo(
echo  ==========================================================
echo   Janitor Lorebook Extractor - setup ^& launch
echo  ==========================================================
echo(

rem --- 1) Make sure Node.js is available -------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [ ! ] Node.js was not found. Trying to install it automatically...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo(
    echo  [ X ] Could not auto-install Node.js ^(winget is not available^).
    echo        Please install Node.js LTS from:  https://nodejs.org/en/download
    echo        Then run this file again.
    start "" "https://nodejs.org/en/download"
    echo(
    pause
    popd & exit /b 1
  )
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  rem winget updates PATH for new shells; refresh this one's view of node.
  where node >nul 2>nul
  if errorlevel 1 (
    echo(
    echo  [ X ] Node.js was installed but this window can't see it yet.
    echo        Close this window and double-click start.bat again.
    echo(
    pause
    popd & exit /b 1
  )
)

for /f "delims=" %%v in ('node -v') do echo  [ ok ] Node.js %%v

rem --- 2) Install dependencies + Chromium on first run ----------------------
if not exist "node_modules" (
  echo(
  echo  [ .. ] First run: installing dependencies and the browser.
  echo        This can take a few minutes - please wait...
  echo(
  call npm install
  if errorlevel 1 (
    echo(
    echo  [ X ] Install failed. Check your internet connection and try again.
    echo(
    pause
    popd & exit /b 1
  )
)

rem --- 3) Create .env from the template on first run ------------------------
if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
     echo  [ ok ] Created .env ^(edit to change the port if needed^).
  )
)

rem --- 4) Launch -------------------------------------------------------------
echo(
echo  [ -> ] Starting... the app will open in your browser shortly.
echo        Keep this window open while you use it. Press Ctrl+C to stop.
echo(
call npm start

echo(
echo  Server stopped.
pause
popd
endlocal
