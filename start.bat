@echo off
chcp 65001 >nul
title Hours Report
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=8080
start "" http://localhost:%PORT%
node server.js
pause
