@echo off
cd /d "%~dp0"
node scripts\launch-notes.mjs
if errorlevel 1 pause
