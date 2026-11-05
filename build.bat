@echo off
chcp 65001 >nul
rem Double-click to build TradeClock release
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
pause
