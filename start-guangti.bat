@echo off
rem GuangTi CaiWuJie service guard: auto-restart on crash. ASCII only (headless cmd parses ANSI).
cd /d "%~dp0"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
echo [%date% %time%] guard started (node=%NODE_EXE%) >> server-guard.log
:loop
echo [%date% %time%] starting node... >> server-guard.log
"%NODE_EXE%" server.js >> server-guard.log 2>&1
echo [%date% %time%] node exited (%errorlevel%), restart in 2s >> server-guard.log
timeout /t 2 /nobreak >nul
goto loop
