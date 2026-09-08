@echo off
REM Guangti Caiwujie silent service daemon launcher.
REM Ported from server-hidden.vbs to bypass WSH startup error (800A01A8 - missing WScript.Shell object).
REM Original .vbs kept at the same path as backup.
REM Runs in background, no visible window.

cd /d "C:\Users\AW\ZCodeProject\guangti-qianwujie"
start "" /B "start-guangti.bat"
exit /b 0