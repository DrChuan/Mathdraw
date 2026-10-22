@echo off
powershell.exe -NoLogo -NoProfile -File "%~dp0scripts\build-mathdraw-windows.ps1" %*
if errorlevel 1 (
  echo Windows packaging failed. See the message above.
  pause
  exit /b 1
)
pause
