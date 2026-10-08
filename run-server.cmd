@echo off
rem Runs the hours-report server and restarts it if it stops. Used by install-windows.ps1.
rem Optional first argument: full path of node.exe (the scheduled task passes it).
cd /d "%~dp0"
set "NODE=%~1"
if "%NODE%"=="" set "NODE=node"
if not exist "data\logs" mkdir "data\logs"
:loop
echo [%date% %time%] starting >> "data\logs\console.log"
"%NODE%" "%~dp0server.js" >> "data\logs\console.log" 2>&1
rem wait 5 seconds before restarting (ping works without a console window)
ping -n 6 127.0.0.1 >nul
goto loop
