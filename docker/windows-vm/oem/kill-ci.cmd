@echo off
rem Stops every CI process in the guest. Closing the console window is not enough:
rem the powershell step and its node/pnpm children keep running detached and a second
rem launch then races the first on C:\konoha (svelte-kit build dies with EPERM).
taskkill /F /T /IM powershell.exe >nul 2>&1
taskkill /F /T /IM node.exe >nul 2>&1
taskkill /F /T /IM pnpm.exe >nul 2>&1
echo killed %DATE% %TIME% > "%~dp0..\logs\kill.txt"
