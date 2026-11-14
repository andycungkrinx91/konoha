@echo off
REM Runs at the final step of the Windows install (dockur copies /oem to C:\OEM).
REM windows-ci.ps1 also re-runs it from the share when C:\OEM\provision.ok is missing,
REM because the copy baked into the setup media is fixed at VM creation.
REM Installs exactly what .github/workflows/cross-platform.yml gets from the runner
REM image: Node 24, pnpm 12.16.1, Git, and an ffmpeg build with libwebp_anim.
REM Safe to re-run: every step overwrites, and the PATH append is idempotent.
setlocal
set LOG=C:\OEM\provision.log
del /q C:\OEM\provision.ok 2>nul
echo ==== provisioning start %DATE% %TIME% ==== >> "%LOG%"

REM --- Node 24 (actions/setup-node@v5, 24.x) ---
curl.exe -4 -fsSL --retry 3 --retry-delay 5 --retry-all-errors -o C:\OEM\node.msi https://nodejs.org/dist/v24.22.2/node-v24.22.2-x64.msi >> "%LOG%" 2>&1
REM msiexec and Inno Setup are GUI-subsystem binaries: cmd does not wait for them,
REM so npm and git would be missing at the probe below. `start /wait` blocks.
start /wait "" msiexec.exe /i C:\OEM\node.msi /qn /norestart ADDLOCAL=ALL >> "%LOG%" 2>&1

REM --- Git for Windows (tests/test_worktree_isolation.js shells out to git) ---
curl.exe -4 -fsSL --retry 3 --retry-delay 5 --retry-all-errors -o C:\OEM\git.exe https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/Git-2.56.1-64-bit.exe >> "%LOG%" 2>&1
start /wait "" C:\OEM\git.exe /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\shellhere,assoc,assoc_sh" >> "%LOG%" 2>&1

REM --- ffmpeg with libwebp_anim (CI uses `choco install ffmpeg`, which ships the
REM gyan.dev build; same upstream here, minus the Chocolatey dependency). ---
curl.exe -4 -fsSL --retry 3 --retry-delay 5 --retry-all-errors -o C:\OEM\ffmpeg.zip https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip >> "%LOG%" 2>&1
powershell -NoProfile -Command "Expand-Archive -Force C:\OEM\ffmpeg.zip C:\ffmpeg-extract; $d=(Get-ChildItem C:\ffmpeg-extract -Directory | Select-Object -First 1).FullName; if (Test-Path C:\ffmpeg) { Remove-Item -Recurse -Force C:\ffmpeg }; Move-Item $d C:\ffmpeg" >> "%LOG%" 2>&1

REM --- Microsoft Visual C++ 2015-2022 Redistributable (x64) for onnxruntime-node ---
curl.exe -4 -fsSL --retry 3 --retry-delay 5 --retry-all-errors -o C:\OEM\vc_redist.x64.exe https://aka.ms/vs/17/release/vc_redist.x64.exe >> "%LOG%" 2>&1
start /wait "" C:\OEM\vc_redist.x64.exe /install /quiet /norestart >> "%LOG%" 2>&1

REM --- pnpm 12.16.1 (pnpm/action-setup@v6.1.1). Installed to a fixed prefix so the
REM shim path is known without guessing the installing user's %APPDATA%. ---
call "C:\Program Files\nodejs\npm.cmd" install -g --prefix C:\npm pnpm@12.16.1 >> "%LOG%" 2>&1

REM Put both tool directories on the machine PATH once, for every later process.
powershell -NoProfile -Command "$p=[Environment]::GetEnvironmentVariable('Path','Machine'); $add=@('C:\ffmpeg\bin','C:\npm') | Where-Object { $p -notlike ('*' + $_ + '*') }; if ($add) { [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';')) + ';' + ($add -join ';')), 'Machine') }" >> "%LOG%" 2>&1

REM A fresh process would see these on PATH; this one does not, so probe absolute
REM paths. The marker lets run-ci.cmd fail fast instead of dying on a missing command.
set FAILED=
if not exist "C:\Program Files\nodejs\node.exe" set FAILED=1
if not exist "C:\npm\pnpm.cmd" set FAILED=1
if not exist "C:\Program Files\Git\cmd\git.exe" set FAILED=1
if not exist "C:\ffmpeg\bin\ffmpeg.exe" set FAILED=1
if not exist "%SystemRoot%\System32\vcruntime140_1.dll" set FAILED=1
if not exist "%SystemRoot%\System32\msvcp140_atomic_wait.dll" set FAILED=1
if defined FAILED (
  echo ==== provisioning INCOMPLETE %DATE% %TIME% ==== >> "%LOG%"
  echo MISSING TOOLS - see C:\OEM\provision.log
) else (
  echo ok> C:\OEM\provision.ok
  echo ==== provisioning done %DATE% %TIME% ==== >> "%LOG%"
  echo Provisioning complete.
)
endlocal
