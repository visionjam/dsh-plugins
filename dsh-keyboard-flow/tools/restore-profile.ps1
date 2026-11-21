#requires -Version 5.1
<#
.SYNOPSIS
  Restore a DSH profile from a known-good snapshot, without starting the app.
.DESCRIPTION
  Use this when DeepSeek Harness will not start after a profile change and the
  built-in "disable third-party plugins" button cannot help (for example a
  package.json with a UTF-8 BOM: that recovery JSON.parses the same file and
  fails too).

  The default source is <profile>\.known-good, written by:
      powershell -ExecutionPolicy Bypass -File tools\preflight.ps1 -Promote
  after a boot you verified. Older snapshots live under <profile>\backups.

  Before overwriting, the current package.json and cordis.patch.yml are copied
  to <profile>\backups\pre-restore-<timestamp>. Files are written as UTF-8
  without BOM and re-parsed afterwards.

.PARAMETER ProfileDir
  Profile directory. Defaults to the desktop profile.
.PARAMETER Snapshot
  Snapshot to restore: a directory path, or a name under <profile>\backups.
  Defaults to .known-good.
.PARAMETER List
  List available snapshots and exit.
.PARAMETER Force
  Skip the confirmation prompt.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\restore-profile.ps1 -List

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\restore-profile.ps1 -Force
#>
param(
  [string]$ProfileDir = (Join-Path $env:USERPROFILE ".dsh\profiles\desktop"),
  [string]$Snapshot = "",
  [switch]$List,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)

function Write-NoBom([string]$source, [string]$target) {
  $data = [System.IO.File]::ReadAllBytes($source)
  if ($data.Length -ge 3 -and $data[0] -eq 0xEF -and $data[1] -eq 0xBB -and $data[2] -eq 0xBF) {
    if ($data.Length -gt 3) { $data = $data[3..($data.Length - 1)] } else { $data = @() }
  }
  [System.IO.File]::WriteAllBytes($target, $data)
}

function Get-Snapshots([string]$profile) {
  $items = @()
  $knownGood = Join-Path $profile ".known-good"
  if (Test-Path -LiteralPath (Join-Path $knownGood "package.json")) {
    $items += [pscustomobject]@{ Name = ".known-good"; Path = $knownGood; Stamp = (Get-Item -LiteralPath $knownGood).LastWriteTime }
  }
  $backups = Join-Path $profile "backups"
  if (Test-Path -LiteralPath $backups) {
    foreach ($dir in Get-ChildItem -LiteralPath $backups -Directory | Sort-Object LastWriteTime -Descending) {
      if (Test-Path -LiteralPath (Join-Path $dir.FullName "package.json")) {
        $items += [pscustomobject]@{ Name = $dir.Name; Path = $dir.FullName; Stamp = $dir.LastWriteTime }
      }
    }
  }
  return $items
}

if (-not (Test-Path -LiteralPath $ProfileDir)) {
  Write-Host ("profile directory not found: " + $ProfileDir) -ForegroundColor Red
  exit 2
}

if ($List) {
  $items = Get-Snapshots $ProfileDir
  if ($items.Count -eq 0) {
    Write-Host "no snapshots yet. Create one after a verified boot:" -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File tools\preflight.ps1 -Promote"
    exit 0
  }
  Write-Host ""
  Write-Host ("snapshots in " + $ProfileDir) -ForegroundColor Cyan
  foreach ($item in $items) {
    Write-Host ("  " + $item.Name.PadRight(28) + $item.Stamp.ToString("yyyy-MM-dd HH:mm:ss"))
  }
  Write-Host ""
  exit 0
}

# --- resolve the source -----------------------------------------------------
$source = $null
if ([string]::IsNullOrWhiteSpace($Snapshot)) {
  $source = Join-Path $ProfileDir ".known-good"
} elseif (Test-Path -LiteralPath $Snapshot) {
  $source = $Snapshot
} else {
  $source = Join-Path (Join-Path $ProfileDir "backups") $Snapshot
}

$sourceManifest = Join-Path $source "package.json"
if (-not (Test-Path -LiteralPath $sourceManifest)) {
  Write-Host ("snapshot has no package.json: " + $source) -ForegroundColor Red
  Write-Host "Run with -List to see available snapshots."
  exit 2
}
$sourcePatch = Join-Path $source "cordis.patch.yml"

# --- confirm ----------------------------------------------------------------
Write-Host ""
Write-Host "restore profile" -ForegroundColor Cyan
Write-Host ("  from: " + $source)
Write-Host ("  into: " + $ProfileDir)
Write-Host ""
if (-not $Force) {
  $answer = Read-Host "Type YES to overwrite the profile configuration"
  if ($answer -ne "YES") {
    Write-Host "cancelled"
    exit 1
  }
}

# --- keep the current files -------------------------------------------------
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path (Join-Path $ProfileDir "backups") ("pre-restore-" + $stamp)
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$manifestPath = Join-Path $ProfileDir "package.json"
$patchPath = Join-Path $ProfileDir "cordis.patch.yml"
if (Test-Path -LiteralPath $manifestPath) { Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $backupDir "package.json") -Force }
if (Test-Path -LiteralPath $patchPath) { Copy-Item -LiteralPath $patchPath -Destination (Join-Path $backupDir "cordis.patch.yml") -Force }
Write-Host ("current files saved to " + $backupDir)

# --- restore ----------------------------------------------------------------
Write-NoBom $sourceManifest $manifestPath
Write-Host "restored package.json (UTF-8, no BOM)"

if (Test-Path -LiteralPath $sourcePatch) {
  Write-NoBom $sourcePatch $patchPath
  Write-Host "restored cordis.patch.yml"
} else {
  Write-Host "snapshot has no cordis.patch.yml; current patch left untouched" -ForegroundColor Yellow
}

# --- verify -----------------------------------------------------------------
$bytes = [System.IO.File]::ReadAllBytes($manifestPath)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
  Write-Host "restored package.json still has a BOM" -ForegroundColor Red
  exit 1
}
try {
  $null = $utf8Strict.GetString($bytes) | ConvertFrom-Json
} catch {
  Write-Host ("restored package.json does not parse: " + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
Write-Host "restored package.json parses" -ForegroundColor Green
Write-Host ""
Write-Host "Done. Start DeepSeek Harness again." -ForegroundColor Green
exit 0
