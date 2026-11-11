# Mirrors the windows-latest job of .github/workflows/cross-platform.yml inside the
# local Windows VM (docker/windows-vm/compose.yml). Invoked from the guest as
#   C:\OEM\run-ci.cmd            (copied there by dockur's /oem hook)
#   Z:\docker\windows-vm\oem\run-ci.cmd
# The repo is mirrored to a local NTFS path first: pnpm's symlink/hardlink store and
# file watching do not work on a Windows network share.
[CmdletBinding()]
param(
  [string]$Source = 'Z:\',
  [string]$Work = 'C:\konoha',
  [string]$LogDir = 'Z:\docker\windows-vm\logs'
)

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$log = Join-Path $LogDir ("windows-ci-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Start-Transcript -Path $log -Force | Out-Null

# Suites this guest cannot run. Kept in the repo and still run on GitHub Actions;
# the runner prints this list into the transcript.
$env:KONOHA_TEST_EXCLUDE = 'test_yamanaka_'
$env:KONOHA_TEST_PARALLEL = '1'
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\ms-playwright'
$env:CI = 'true'

$failures = New-Object System.Collections.Generic.List[string]

function Invoke-Step {
  param([string]$Name, [scriptblock]$Body)
  Write-Host "`n=== $Name ===" -ForegroundColor Cyan
  $start = Get-Date
  & $Body
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
Invoke-Step 'Install Playwright browsers' { pnpm exec playwright install chromium }
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
Invoke-Step 'Test (full suite, Yamanaka excluded)' { pnpm test }

Invoke-Step 'Fresh-install smoke test' {
  $smokeHome = Join-Path $env:SystemDrive 'konoha-smoke-home'
  Remove-Item -Recurse -Force $smokeHome -ErrorAction SilentlyContinue
  $saved = @{ HOME = $env:HOME; USERPROFILE = $env:USERPROFILE }
  $env:HOME = $smokeHome
  $env:USERPROFILE = $smokeHome
  node bin/cli.js init --yes --no-project
  if ($LASTEXITCODE -eq 0) { node bin/cli.js migrate --skip-embeddings }
  if ($LASTEXITCODE -eq 0) { node bin/cli.js version }
  $env:HOME = $saved.HOME
  $env:USERPROFILE = $saved.USERPROFILE
}

Pop-Location

Write-Host "`n================ SUMMARY ================"
Write-Host "Excluded suites (not run on this guest): $env:KONOHA_TEST_EXCLUDE"
Write-Host "See the run banner above for the exact file list."
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
