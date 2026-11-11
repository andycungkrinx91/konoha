@echo off
REM Runs once, at the final step of the Windows install (dockur copies /oem to C:\OEM).
REM Installs exactly what .github/workflows/cross-platform.yml gets from the runner
REM image: Node 24, pnpm 12.16.1, Git, and an ffmpeg build with libwebp_anim.
setlocal
set LOG=C:\OEM\provision.log
echo ==== provisioning start %DATE% %TIME% ==== >> "%LOG%"

REM --- Node 24 (actions/setup-node@v5, 24.x) ---
curl.exe -fsSL -o C:\OEM\node.msi https://nodejs.org/dist/v24.22.2/node-v24.22.2-x64.msi >> "%LOG%" 2>&1
msiexec.exe /i C:\OEM\node.msi /qn /norestart ADDLOCAL=ALL >> "%LOG%" 2>&1

REM --- Git for Windows (tests/test_worktree_isolation.js shells out to git) ---
curl.exe -fsSL -o C:\OEM\git.exe https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/Git-2.56.1-64-bit.exe >> "%LOG%" 2>&1
C:\OEM\git.exe /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\shellhere,assoc,assoc_sh" >> "%LOG%" 2>&1

REM --- ffmpeg with libwebp_anim (CI uses `choco install ffmpeg`, which ships the
REM gyan.dev build; same upstream here, minus the Chocolatey dependency). ---
curl.exe -fsSL -o C:\OEM\ffmpeg.zip https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip >> "%LOG%" 2>&1
powershell -NoProfile -Command "Expand-Archive -Force C:\OEM\ffmpeg.zip C:\ffmpeg-extract; $d=(Get-ChildItem C:\ffmpeg-extract -Directory | Select-Object -First 1).FullName; Move-Item $d C:\ffmpeg; $p=[Environment]::GetEnvironmentVariable('Path','Machine'); [Environment]::SetEnvironmentVariable('Path', $p + ';C:\ffmpeg\bin', 'Machine')" >> "%LOG%" 2>&1

REM --- pnpm 12.16.1 (pnpm/action-setup@v6.1.1) ---
call "C:\Program Files\nodejs\npm.cmd" install -g pnpm@12.16.1 >> "%LOG%" 2>&1

echo ==== provisioning done %DATE% %TIME% ==== >> "%LOG%"
endlocal
