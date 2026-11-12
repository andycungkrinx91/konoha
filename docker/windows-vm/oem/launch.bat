@echo off
rem Manual CI launcher for the dockur/windows guest.
rem Writes a probe file first so a headless operator can tell whether the
rem keystrokes reached a console at all, then runs the CI script.
rem %~dp0 is this file's own directory, so the probe lands even when Z: is
rem missing and run-ci.cmd is the thing that has to create it.
echo probe %DATE% %TIME% > "%~dp0..\logs\probe.txt" 2>&1
call "%~dp0run-ci.cmd"
