@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-profile.ps1" %*
pause
