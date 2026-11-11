@echo off
REM Entry point inside the guest. Runs the mirrored windows-latest job from the
REM shared checkout on drive Z: and leaves the log beside it.
powershell -NoProfile -ExecutionPolicy Bypass -File Z:\scripts\windows-ci.ps1 %*
exit /b %ERRORLEVEL%
