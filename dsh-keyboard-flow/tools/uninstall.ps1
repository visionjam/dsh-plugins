#requires -Version 5.1
<#
.SYNOPSIS
  Remove the keyboard-flow plugin from a DSH profile.
.DESCRIPTION
  Drops the bundle and dependency entries and removes the node_modules junction.
  The manifest is rewritten as BOM-free UTF-8 JSON, which the DSH loader requires.
#>
param(
  [string]$ProfileDir = (Join-Path $env:USERPROFILE ".dsh\profiles\desktop")
)

$ErrorActionPreference = "Stop"
$packageName = "@local/dsh-plugin-keyboard-flow"
$manifestPath = Join-Path $ProfileDir "package.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $manifestPath)) { throw "profile manifest not found: $manifestPath" }

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($null -eq $manifest.dsh.profile) { throw "profile manifest has no dsh.profile section" }

$bundles = @($manifest.dsh.profile.bundles) | Where-Object { $_ -ne $packageName }
$manifest.dsh.profile.bundles = @($bundles)

$dependency = $manifest.dependencies.PSObject.Properties[$packageName]
if ($null -ne $dependency) { $manifest.dependencies.PSObject.Properties.Remove($packageName) }

$json = $manifest | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($manifestPath, $json + [Environment]::NewLine, $utf8NoBom)
$bytes = [System.IO.File]::ReadAllBytes($manifestPath)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw "refusing to leave a BOM in $manifestPath" }
try { $null = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw "written manifest does not parse: $($_.Exception.Message)" }

$linkPath = Join-Path $ProfileDir "node_modules\@local\dsh-plugin-keyboard-flow"
if (Test-Path -LiteralPath $linkPath) {
  Remove-Item -LiteralPath $linkPath -Recurse -Force
  Write-Host "removed junction: $linkPath"
}

Write-Host ""
Write-Host "Uninstalled. Restart DSH to drop the plugin."
