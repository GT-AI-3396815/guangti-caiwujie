@echo off
chcp 65001 >nul
title 光体•财无界 服务守护
cd /d "%~dp0"
echo ========================================
echo   光体•财无界 服务守护已启动
echo   访问地址: http://localhost:8642
echo   服务崩溃将自动重启，关闭此窗口即停止
echo ========================================
:loop
node server.js
echo [守护] 服务退出(代码 %errorlevel%)，2 秒后自动重启...
timeout /t 2 /nobreak >nul
goto loop
