#requires -Version 5.1
<#
.SYNOPSIS
  Link the keyboard-flow plugin into a DSH profile.
.DESCRIPTION
  Adds a link: dependency, appends the bundle to dsh.profile.bundles, and creates
  the node_modules junction. Restart DSH afterwards. The profile package.json is
  backed up before it changes, and the rewritten file is verified to be BOM-free
  UTF-8 JSON (the DSH loader rejects a manifest that starts with a BOM).
#>
param(
  [string]$ProfileDir = (Join-Path $env:USERPROFILE ".dsh\profiles\desktop"),
  [string]$PluginDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$packageName = "@local/dsh-plugin-keyboard-flow"
$manifestPath = Join-Path $ProfileDir "package.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Manifest([string]$path, $manifest) {
  $json = $manifest | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($path, $json + [Environment]::NewLine, $utf8NoBom)
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    throw "refusing to leave a BOM in $path"
  }
  try { $null = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { throw "written manifest does not parse: $($_.Exception.Message)" }
}

if (-not (Test-Path -LiteralPath $manifestPath)) { throw "profile manifest not found: $manifestPath" }
if (-not (Test-Path -LiteralPath (Join-Path $PluginDir "client.js"))) { throw "plugin not found: $PluginDir" }

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($null -eq $manifest.dependencies) { $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
if ($null -eq $manifest.dsh.profile) { throw "profile manifest has no dsh.profile section" }

$bundles = @($manifest.dsh.profile.bundles)
$needsBundle = -not ($bundles -contains $packageName)
$needsDependency = -not ($manifest.dependencies.PSObject.Properties.Name -contains $packageName)

if ($needsBundle -or $needsDependency) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = "$manifestPath.bak-keyboard-flow-$stamp"
  Copy-Item -LiteralPath $manifestPath -Destination $backup
  Write-Host "backup: $backup"
}

if ($needsDependency) {
  $linkSpec = "link:" + ($PluginDir -replace "\\", "/")
  $manifest.dependencies | Add-Member -NotePropertyName $packageName -NotePropertyValue $linkSpec
  Write-Host "dependency: $packageName -> $linkSpec"
}

if ($needsBundle) {
  $manifest.dsh.profile.bundles = @($bundles + $packageName)
  Write-Host "bundle: appended $packageName"
}

if ($needsBundle -or $needsDependency) {
  Write-Manifest $manifestPath $manifest
  Write-Host "manifest: written as UTF-8 without BOM"
}

$linkDir = Join-Path $ProfileDir "node_modules\@local"
$linkPath = Join-Path $linkDir "dsh-plugin-keyboard-flow"
if (-not (Test-Path -LiteralPath $linkDir)) { New-Item -ItemType Directory -Path $linkDir -Force | Out-Null }
if (Test-Path -LiteralPath $linkPath) {
  $existing = (Get-Item -LiteralPath $linkPath).Target
  if ($existing -ne $PluginDir) { Remove-Item -LiteralPath $linkPath -Recurse -Force }
}
if (-not (Test-Path -LiteralPath $linkPath)) {
  New-Item -ItemType Junction -Path $linkPath -Target $PluginDir | Out-Null
  Write-Host "junction: $linkPath -> $PluginDir"
}

Write-Host ""
Write-Host "Installed. Restart DSH to load the plugin."
