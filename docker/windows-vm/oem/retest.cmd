@echo off
rem Re-mirror the share and run named suites only, so a Windows-only failure can be
rem re-tested in minutes instead of paying for a full windows-ci.ps1 run.
rem   retest.cmd test_queue_worker.js test_subagent_delegation_integrity.js
rem Log: Z:\docker\windows-vm\logs\retest.log
if not exist Z:\nul (
  echo FATAL: Z: is not mapped. Run run-ci.cmd, or map it: net use Z: \\host.lan\Data
  exit /b 1
)
if "%~1"=="" (
  echo Usage: retest.cmd ^<suite.js^> [suite.js ...]
  exit /b 1
)

robocopy Z:\ C:\konoha /MIR /R:2 /W:1 /NFL /NDL /NJH /NP /XD node_modules .konoha logs
if errorlevel 8 (
  echo FATAL: checkout mirror failed ^(robocopy exit %ERRORLEVEL%^)
  exit /b 1
)
cd /d C:\konoha

set KONOHA_UI_AUTOSTART=0
set KONOHA_TEST_EXCLUDE=test_yamanaka_
set CI=true
set LOG=Z:\docker\windows-vm\logs\retest.log
if exist %LOG% del %LOG%

rem Delayed expansion: everything inside the loop below is assigned and read in
rem the same block, and %VAR% would be expanded once at parse time — the exit code
rem line then reported the pre-loop value and every failure looked green.
setlocal enabledelayedexpansion
for %%S in (%*) do (
  echo ==== %%S ==== >> %LOG%
  rem Suites assert their own preconditions, and several refuse to run against a
  rem real profile. run_all.js gives each suite a throwaway HOME; mirror that here
  rem or the retest reports a guard message as if it were a failure.
  set "SUITE_HOME=%TEMP%\konoha-retest-%%~nS"
  if exist "!SUITE_HOME!" rd /s /q "!SUITE_HOME!" >nul 2>&1
  mkdir "!SUITE_HOME!" >nul 2>&1
  set "HOME=!SUITE_HOME!"
  set "USERPROFILE=!SUITE_HOME!"
  node tests\%%S >> %LOG% 2>&1
  echo ---- exit !ERRORLEVEL! ---- >> %LOG%
)
echo Done. See %LOG%
type %LOG%
