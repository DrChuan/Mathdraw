@echo off
cd /d "%~dp0"
node scripts\launch-drawing.mjs
if errorlevel 1 pause
