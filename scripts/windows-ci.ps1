# Mirrors the windows-latest job of .github/workflows/cross-platform.yml inside the
# local Windows VM (docker/windows-vm/compose.yml). Invoked from the guest as
#   Z:\docker\windows-vm\oem\run-ci.cmd   (also at C:\OEM\run-ci.cmd)
# The repo is mirrored to a local NTFS path first: pnpm's symlink/hardlink store and
# file watching do not work on a Windows network share.
[CmdletBinding()]
param(
  [string]$Source = 'Z:\',
  [string]$Work = 'C:\konoha',
  [string]$LogDir = 'Z:\docker\windows-vm\logs',
  [string]$Shard = $env:KONOHA_TEST_SHARD
)

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$log = Join-Path $LogDir ("windows-ci-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
# Native stdout goes here: the transcript only records cmdlet output (see Invoke-Step).
# A separate file because the transcript already holds $log open.
$stepLog = [IO.Path]::ChangeExtension($log, '.steps.log')
Start-Transcript -Path $log -Force | Out-Null

$env:KONOHA_TEST_PARALLEL = '1'
# Mirror the CI seed cache. Outside C:\konoha so the repo mirror does not wipe it;
# the harness rebuilds it when the source fingerprint moves and refuses to touch a
# directory it does not recognise.
$env:KONOHA_SEED_DIR = 'C:\konoha-seed'
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\ms-playwright'
# Playwright gives each download 30s by default. A hosted runner reaches the CDN in a
# few seconds; this guest's egress does not, and the install aborts mid-download.
$env:PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT = '180000'
$env:CI = 'true'
# The guest cannot reach astral.sh, and the winget fallback blocks indefinitely instead
# of failing: run 7 sat in the fresh-install smoke step for hours with no verdict.
# uv is only needed for the aislop MCP, which the smoke test does not exercise.
$env:KONOHA_SKIP_UV_INSTALL = '1'

# Provisioning writes PATH to the registry, which a shell that was already open never
# sees. Rebuild it from both scopes so node, pnpm, git and ffmpeg resolve regardless
# of when this process started - and again after the block below, in case it just ran.
function Update-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}
Update-Path

$failures = New-Object System.Collections.Generic.List[string]

# Ctrl-C in the console stops the pipeline without setting $LASTEXITCODE, so an
# interrupted run would otherwise reach the summary with $failures empty and exit 0 -
# a local mirror reporting green on a job that never finished. Every step below must
# complete before $completed flips, and the summary fails the run if it did not.
$completed = $false

function Invoke-Step {
  param([string]$Name, [scriptblock]$Body)
  Write-Host "`n=== $Name ===" -ForegroundColor Cyan
  $start = Get-Date
  # Start-Transcript records cmdlet output but not the stdout of native programs, so a
  # failing pnpm/node step would leave only its banner in the log. Tee through a cmdlet
  # instead: it still writes to the console and appends to $stepLog, and being a cmdlet
  # it leaves $LASTEXITCODE set by the native command it wrapped.
  & $Body 2>&1 | Tee-Object -FilePath $stepLog -Append
  $code = $LASTEXITCODE
  $elapsed = [int]((Get-Date) - $start).TotalSeconds
  if ($code -eq 0) {
    Write-Host "=== $Name OK (${elapsed}s) ===" -ForegroundColor Green
  } else {
    Write-Host "=== $Name FAILED (exit $code, ${elapsed}s) ===" -ForegroundColor Red
    $failures.Add("$Name (exit $code)")
  }
  $global:LASTEXITCODE = 0
}

Write-Host "Source: $Source`nWork:   $Work`nLog:    $log"

# Provisioning normally runs once during the Windows install, but the OEM script is
# baked into setup media, so editing it in the repo does not change a guest that was
# already installed. Re-run it from the share when the marker is missing or stale, and
# only then fail: a missing command otherwise reads like a suite defect.
$share = Join-Path $Source 'docker\windows-vm\oem\install.bat'
if (-not (Test-Path 'C:\OEM\provision.ok')) {
  $provision = 'C:\OEM\install.bat'
  if (Test-Path $share) {
    # The share copy carries the repo's line endings (LF). Batch files want CRLF, and
    # Set-Content writes CRLF, so stage a normalized copy instead of running it in place.
    $provision = 'C:\OEM\install-share.bat'
    Get-Content -Path $share | Set-Content -Path $provision -Encoding ASCII
  }
  if (Test-Path $provision) {
    Write-Host "`n=== Provision guest ($provision) ===" -ForegroundColor Cyan
    & cmd.exe /c "`"$provision`""
    Update-Path
  }
  if (-not (Test-Path 'C:\OEM\provision.ok')) {
    Write-Host 'Guest provisioning did not complete - see C:\OEM\provision.log' -ForegroundColor Red
    Stop-Transcript | Out-Null
    exit 1
  }
}

# onnxruntime-node (win32-x64) links against VC++ 2015-2022 runtime DLLs; GitHub Actions
# windows-latest pre-installs them, whereas older dockur/windows VM images may lack them.
$vcMissing = (-not (Test-Path "$env:SystemRoot\System32\vcruntime140_1.dll")) -or (-not (Test-Path "$env:SystemRoot\System32\msvcp140_atomic_wait.dll"))
if ($vcMissing) {
  Write-Host "`n=== Provision Visual C++ Redistributable (x64) ===" -ForegroundColor Cyan
  $vcExe = Join-Path $env:TEMP 'vc_redist.x64.exe'
  & curl.exe -4 -fsSL --retry 3 --retry-delay 5 --retry-all-errors -o $vcExe https://aka.ms/vs/17/release/vc_redist.x64.exe
  if ($LASTEXITCODE -eq 0 -and (Test-Path $vcExe)) {
    & cmd.exe /c "start /wait `"`" `"$vcExe`" /install /quiet /norestart"
  }
  $global:LASTEXITCODE = 0
  if ((-not (Test-Path "$env:SystemRoot\System32\vcruntime140_1.dll")) -or (-not (Test-Path "$env:SystemRoot\System32\msvcp140_atomic_wait.dll"))) {
    Write-Host 'Visual C++ Redistributable (x64) failed to install' -ForegroundColor Red
    Stop-Transcript | Out-Null
    exit 1
  }
}

# --- Checkout: mirror the working tree, keep node_modules and the guest disk out. ---
Write-Host "`n=== Checkout (robocopy) ===" -ForegroundColor Cyan
robocopy $Source $Work /MIR /R:2 /W:1 /NFL /NDL /NJH /NP /XD node_modules .konoha logs
# robocopy: 0-7 are success (bit flags), >=8 is a real error.
if ($LASTEXITCODE -ge 8) {
  $failures.Add("Checkout (robocopy exit $LASTEXITCODE)")
}
$global:LASTEXITCODE = 0

Push-Location $Work

Invoke-Step 'Install dependencies' { pnpm install --frozen-lockfile }

# The guest's egress to cdn.playwright.dev is unreliable (30 s socket timeouts, mid-transfer
# ECONNRESET), which fails the browser install here while the GitHub runner downloads it
# without trouble. If the host pre-staged a win64 browser tree into the share - see
# docs/CI.md - copy it in; Playwright then sees a completed install and
# skips the download. Nothing is staged by default, so the step still exercises the real
# network path when the share is empty.
# A Ctrl-C mid-install leaves this lock behind, and playwright then refuses every
# later install ("removal failed... rm -R __dirlock") without touching the browsers
# that were already copied in. Clear it unconditionally, before the import step can
# return early on an empty share - run 7 died here with nothing staged.
$lock = Join-Path $env:PLAYWRIGHT_BROWSERS_PATH '__dirlock'
if (Test-Path $lock) {
  Write-Host 'Removing stale Playwright directory lock from an interrupted install'
  Remove-Item -Recurse -Force $lock -ErrorAction SilentlyContinue
}

Invoke-Step 'Import pre-staged Playwright browsers' {
  $staged = Get-ChildItem -Path (Join-Path $Source '.tmp-playwright') -Directory -ErrorAction SilentlyContinue
  if (-not $staged) {
    Write-Host 'No pre-staged browsers in the share; the install step will download them'
    $global:LASTEXITCODE = 0
    return
  }
  foreach ($dir in $staged) {
    $dest = Join-Path $env:PLAYWRIGHT_BROWSERS_PATH $dir.Name
    robocopy $dir.FullName $dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
      $failures.Add("Import $($dir.Name) (robocopy exit $LASTEXITCODE)")
    } else {
      Write-Host "Imported $($dir.Name)"
    }
    $global:LASTEXITCODE = 0
  }
  # Copying the tree is not the same as landing a usable install: the layout below is
  # what playwright checks, and a stale or partial staging dir would otherwise surface
  # only as "Executable doesn't exist" inside unrelated suites.
  $expected = @{
    'chromium-1248'                 = 'chrome-win64\chrome.exe'
    'chromium_headless_shell-1248'  = 'chrome-headless-shell-win64\chrome-headless-shell.exe'
    'ffmpeg-1013'                   = 'ffmpeg-win64.exe'
  }
  foreach ($name in $expected.Keys) {
    if (-not (Test-Path (Join-Path $Source ".tmp-playwright\$name"))) { continue }
    $exe = Join-Path (Join-Path $env:PLAYWRIGHT_BROWSERS_PATH $name) $expected[$name]
    if (Test-Path $exe) {
      Write-Host "Verified $name"
    } else {
      $failures.Add("Import $name (missing $($expected[$name]))")
    }
  }
}

# The layout playwright actually needs, shared by the install and verify steps so the
# two cannot drift apart.
$playwrightRequired = @(
  'chromium_headless_shell-1248\chrome-headless-shell-win64\chrome-headless-shell.exe',
  'chromium-1248\chrome-win64\chrome.exe'
)

# Skipped when the import step already landed both browsers. Running it anyway makes
# playwright fetch winldd from cdn.playwright.dev - the one artifact the pre-staged
# tree does not cover and the one host the guest cannot reach - so the step would
# stall for minutes and fail with nothing to show for it. Tests never need winldd.
Invoke-Step 'Install Playwright browsers' {
  $missing = @($playwrightRequired | Where-Object { -not (Test-Path (Join-Path $env:PLAYWRIGHT_BROWSERS_PATH $_)) })
  if ($missing.Count -eq 0) {
    Write-Host 'Browsers already staged by the import step; skipping download'
    $global:LASTEXITCODE = 0
    return
  }
  Write-Host "Missing: $($missing -join ', '); downloading from cdn.playwright.dev"
  pnpm exec playwright install chromium
}

# A silently incomplete install surfaces 40 minutes later as "Executable doesn't
# exist" inside unrelated suites (documents, 3D benchmarks, animation export). Fail
# the step instead, while the log still shows the download.
Invoke-Step 'Verify Playwright browsers' {
  $missing = @($playwrightRequired | Where-Object { -not (Test-Path (Join-Path $env:PLAYWRIGHT_BROWSERS_PATH $_)) })
  if ($missing.Count -gt 0) {
    Write-Host "Playwright browsers incomplete under $($env:PLAYWRIGHT_BROWSERS_PATH): $($missing -join ', ')"
    $global:LASTEXITCODE = 1
  } else {
    Write-Host 'Playwright chromium and headless shell present'
    $global:LASTEXITCODE = 0
  }
}
Invoke-Step 'Build web' { pnpm --filter konoha-web build }

Invoke-Step 'Verify ffmpeg webp encoder' {
  $encoders = (& ffmpeg -hide_banner -encoders 2>$null) -join "`n"
  if ($encoders -match 'libwebp_anim') {
    Write-Host 'ffmpeg exposes libwebp_anim'
    $global:LASTEXITCODE = 0
  } else {
    Write-Host 'ffmpeg build lacks libwebp_anim (see C:\OEM\provision.log)'
    $global:LASTEXITCODE = 1
  }
}

Invoke-Step 'Lint' { pnpm lint }
# CI splits windows-latest over 16 shards (ubuntu: 8, macos: 5); this guest runs all of it in one pass by default,
# or a single shard when -Shard I/N or KONOHA_TEST_SHARD=I/N is set.
if ($Shard) { $env:KONOHA_TEST_SHARD = $Shard }
$testLabel = if ($Shard) { "Test (shard $Shard)" } else { 'Test (full suite)' }
Invoke-Step $testLabel { pnpm test }

Invoke-Step 'Fresh-install smoke test' {
  $smokeHome = Join-Path $env:SystemDrive 'konoha-smoke-home'
  Remove-Item -Recurse -Force $smokeHome -ErrorAction SilentlyContinue
  $saved = @{ HOME = $env:HOME; USERPROFILE = $env:USERPROFILE }
  $env:HOME = $smokeHome
  $env:USERPROFILE = $smokeHome
  # The smoke test proves install + migrate + version; nothing in init starts the web UI.
  node bin/cli.js init --yes --no-project
  if ($LASTEXITCODE -eq 0) { node bin/cli.js migrate --skip-embeddings }
  if ($LASTEXITCODE -eq 0) { node bin/cli.js version }
  $env:HOME = $saved.HOME
  $env:USERPROFILE = $saved.USERPROFILE
}

$completed = $true

Pop-Location

Write-Host "`n================ SUMMARY ================"
Write-Host 'See the run banner above for the suites the harness held back.'
if (-not $completed) { $failures.Add('run interrupted before completion') }
if ($failures.Count -eq 0) {
  Write-Host 'WINDOWS-CI RESULT: PASS'
  $exitCode = 0
} else {
  Write-Host 'WINDOWS-CI RESULT: FAIL'
  foreach ($f in $failures) { Write-Host "  - $f" }
  $exitCode = 1
}
Write-Host "Log: $log"
Stop-Transcript | Out-Null
exit $exitCode
