#requires -Version 5.1
<#
.SYNOPSIS
  Validate a DSH profile before restarting the app.
.DESCRIPTION
  Checks the two files that can stop DSH from booting:

    package.json      BOM, strict UTF-8, JSON syntax, dsh.profile.bundles,
                      and every link: dependency target.
    cordis.patch.yml  YAML syntax and loader compatibility, checked by running
                      the dsh CLI with the file as an overlay on the web profile.

  Missing or unreadable bundle packages are warnings, not errors: DSH skips a
  bundle it cannot resolve and boots without it. A corrupt package.json is the
  fatal case, and it is also the case the built-in "disable third-party plugins"
  recovery cannot fix (that button JSON.parses the same file).

  With -Promote, the validated files are copied to <profile>\.known-good so
  restore-profile.ps1 can put them back from outside the app.

.PARAMETER ProfileDir
  Profile directory. Defaults to the desktop profile.
.PARAMETER DshCommand
  dsh launcher used for the patch check.
.PARAMETER Promote
  After a clean run, update <profile>\.known-good with the validated files.
.PARAMETER SkipPatchCheck
  Skip the YAML check (use when the dsh launcher is unavailable).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\preflight.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\preflight.ps1 -Promote
#>
param(
  [string]$ProfileDir = (Join-Path $env:USERPROFILE ".dsh\profiles\desktop"),
  [string]$DshCommand = "D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd",
  [switch]$Promote,
  [switch]$SkipPatchCheck
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Fail([string]$message) {
  $script:failures.Add($message) | Out-Null
  Write-Host ("FAIL  " + $message) -ForegroundColor Red
}
function Warn([string]$message) {
  $script:warnings.Add($message) | Out-Null
  Write-Host ("WARN  " + $message) -ForegroundColor Yellow
}
function Ok([string]$message) {
  Write-Host ("ok    " + $message) -ForegroundColor Green
}
function Copy-NoBom([string]$source, [string]$target) {
  $data = [System.IO.File]::ReadAllBytes($source)
  if ($data.Length -ge 3 -and $data[0] -eq 0xEF -and $data[1] -eq 0xBB -and $data[2] -eq 0xBF) {
    if ($data.Length -gt 3) { $data = $data[3..($data.Length - 1)] } else { $data = @() }
  }
  [System.IO.File]::WriteAllBytes($target, $data)
}

$manifestPath = Join-Path $ProfileDir "package.json"
$patchPath = Join-Path $ProfileDir "cordis.patch.yml"

Write-Host ""
Write-Host "preflight: $ProfileDir"
Write-Host ""

if (-not (Test-Path -LiteralPath $ProfileDir)) {
  Write-Host ("FAIL  profile directory not found: " + $ProfileDir) -ForegroundColor Red
  exit 2
}
if (-not (Test-Path -LiteralPath $manifestPath)) {
  Write-Host ("FAIL  package.json not found in " + $ProfileDir) -ForegroundColor Red
  exit 2
}

# --- package.json -----------------------------------------------------------
$bytes = [System.IO.File]::ReadAllBytes($manifestPath)
$hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
if ($hasBom) {
  Fail "package.json starts with a UTF-8 BOM: DSH cannot JSON.parse it, and the built-in recovery cannot either"
} else {
  Ok "package.json has no BOM"
}

$text = $null
try {
  $text = $utf8Strict.GetString($bytes)
} catch {
  Fail ("package.json is not valid UTF-8: " + $_.Exception.Message)
}

$manifest = $null
if ($null -ne $text) {
  try {
    $manifest = $text | ConvertFrom-Json
  } catch {
    Fail ("package.json is not valid JSON: " + $_.Exception.Message)
  }
}

$bundles = @()
if ($null -ne $manifest) {
  if ($null -eq $manifest.dsh -or $null -eq $manifest.dsh.profile) {
    Fail "package.json has no dsh.profile section"
  } else {
    $rawBundles = $manifest.dsh.profile.bundles
    if ($null -eq $rawBundles) {
      Fail "dsh.profile.bundles is missing"
    } else {
      $bundles = @($rawBundles)
      $badEntry = $false
      foreach ($entry in $bundles) {
        if (-not ($entry -is [string]) -or [string]::IsNullOrWhiteSpace($entry)) {
          Fail "dsh.profile.bundles contains a non-string or empty entry"
          $badEntry = $true
          break
        }
      }
      if (-not $badEntry) {
        $duplicates = @($bundles | Group-Object | Where-Object { $_.Count -gt 1 })
        if ($duplicates.Count -gt 0) {
          Warn ("duplicate bundle entries: " + (($duplicates | ForEach-Object { $_.Name }) -join ", "))
        }
        Ok ("dsh.profile.bundles holds " + $bundles.Count + " entries")
      }
    }
  }
}

# --- bundle resolution (warnings only) --------------------------------------
if ($null -ne $manifest -and $bundles.Count -gt 0) {
  # Official bundles live inside app.asar, which PowerShell cannot see. Only
  # profile-local packages and non-official names are checked here.
  $profileModules = Join-Path $ProfileDir "node_modules"
  $missing = @()
  foreach ($name in $bundles) {
    $rel = $name -replace "/", "\"
    if (Test-Path -LiteralPath (Join-Path $profileModules ($rel + "\package.json"))) { continue }
    if ($name.StartsWith("@deepseek-ai/")) { continue }
    $missing += $name
  }
  if ($missing.Count -gt 0) {
    Warn ("bundle package(s) not found in the profile: " + ($missing -join ", ") + " -- DSH skips these, the feature will be missing")
  } else {
    Ok "every profile-local bundle package resolves"
  }

  if ($null -ne $manifest.dependencies) {
    foreach ($property in $manifest.dependencies.PSObject.Properties) {
      $value = [string]$property.Value
      if ($value.StartsWith("link:")) {
        $target = ($value.Substring(5) -replace "/", "\")
        if (-not (Test-Path -LiteralPath $target)) {
          Warn ("link dependency " + $property.Name + " points at a missing path: " + $target)
        }
      }
    }
  }
}

# --- cordis.patch.yml -------------------------------------------------------
if (-not (Test-Path -LiteralPath $patchPath)) {
  Warn "cordis.patch.yml not found; DSH boots with bundle layers only"
} elseif ($SkipPatchCheck) {
  Warn "patch check skipped (-SkipPatchCheck)"
} elseif (-not (Test-Path -LiteralPath $DshCommand)) {
  Warn ("dsh launcher not found at " + $DshCommand + "; patch check skipped")
} else {
  # A native command writing to stderr must not terminate this script.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $DshCommand --profile web --patch $patchPath --dump-config 2>&1 | Out-String -Width 4096
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($output -match "failed to parse|YAMLException") {
    $detail = ($output -split '\r?\n' | Where-Object { $_ -match "YAMLException:" } | Select-Object -First 1)
    if ($null -eq $detail) {
      $detail = ($output -split '\r?\n' | Where-Object { $_ -match "failed to parse" -and $_ -notmatch "throw new Error" } | Select-Object -First 1)
    }
    if ($null -eq $detail) { $detail = "see the dsh output above" }
    Fail ("cordis.patch.yml is not valid YAML: " + $detail.Trim())
  } elseif ($code -ne 0 -and $output -notmatch "not found") {
    Fail ("dsh rejected the patch overlay (exit " + $code + ")")
  } elseif ($output -match "patch: entry .* not found") {
    $detail = ($output -split '\r?\n' | Where-Object { $_ -match "not found" } | Select-Object -First 1)
    Warn ("patch targets an entry missing from the web profile: " + $detail.Trim())
  } else {
    Ok "cordis.patch.yml parses and applies over the web profile"
  }
}

# --- known-good snapshot ----------------------------------------------------
if ($failures.Count -eq 0 -and $Promote) {
  $knownGood = Join-Path $ProfileDir ".known-good"
  New-Item -ItemType Directory -Path $knownGood -Force | Out-Null
  Copy-NoBom $manifestPath (Join-Path $knownGood "package.json")
  if (Test-Path -LiteralPath $patchPath) {
    Copy-NoBom $patchPath (Join-Path $knownGood "cordis.patch.yml")
  }
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $meta = "validated: " + $stamp + [Environment]::NewLine + "profile: " + $ProfileDir + [Environment]::NewLine
  [System.IO.File]::WriteAllText((Join-Path $knownGood "snapshot.txt"), $meta, $utf8NoBom)
  Ok ("known-good snapshot updated: " + $knownGood)
}

Write-Host ""
if ($failures.Count -gt 0) {
  Write-Host ("PREFLIGHT FAILED: " + $failures.Count + " error(s), " + $warnings.Count + " warning(s)") -ForegroundColor Red
  Write-Host "Do not restart DSH until these are fixed. Last resort: tools\restore-profile.cmd"
  exit 1
}
Write-Host ("PREFLIGHT PASSED: " + $warnings.Count + " warning(s)") -ForegroundColor Green
exit 0
