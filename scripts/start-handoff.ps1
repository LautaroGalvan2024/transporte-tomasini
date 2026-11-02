[CmdletBinding()]
param([Parameter(Mandatory)][string]$ReleaseManifest)
$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path -LiteralPath $ReleaseManifest).Path
$scriptPath = Join-Path $PSScriptRoot 'handoff-only.ps1'
function ConvertTo-PowerShellLiteral([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
$command = '& ' + (ConvertTo-PowerShellLiteral $scriptPath) + ' -ReleaseManifest ' + (ConvertTo-PowerShellLiteral $manifestPath)
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$process = Start-Process -FilePath (Get-Command pwsh -ErrorAction Stop).Source -WindowStyle Normal -ArgumentList @('-NoProfile','-EncodedCommand',$encoded) -PassThru
Write-Host ('Terminal de entrega privada abierta (PID ' + $process.Id + ').')
