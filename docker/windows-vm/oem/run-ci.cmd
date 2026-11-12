@echo off
REM Entry point inside the guest. Runs the mirrored windows-latest job from the
REM shared checkout on drive Z: and leaves the log beside it.
REM Z: is a per-logon SMB mapping: it vanishes when the guest reboots and
REM nothing re-creates it, so every run after the first died on "The system
REM cannot find the drive specified". Map it here instead of assuming it exists.
if not exist Z:\nul net use Z: \\host.lan\Data >nul 2>&1
if not exist Z:\nul (
  echo Cannot map Z: to \\host.lan\Data - is the shared folder reachable?
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File Z:\scripts\windows-ci.ps1 %*
exit /b %ERRORLEVEL%
