@echo off
chcp 65001 >nul
rem Double-click to prepare and start TradeClock
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause
