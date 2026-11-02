[CmdletBinding()]
param([Parameter(Mandatory)][string]$RepairManifest)
$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path -LiteralPath $RepairManifest).Path
$scriptPath = Join-Path $PSScriptRoot 'ci-repair-interactive.ps1'
function ConvertTo-PowerShellLiteral([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
$command = '& ' + (ConvertTo-PowerShellLiteral $scriptPath) + ' -RepairManifest ' + (ConvertTo-PowerShellLiteral $manifestPath)
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$process = Start-Process -FilePath (Get-Command pwsh -ErrorAction Stop).Source -WindowStyle Normal -ArgumentList @('-NoProfile','-EncodedCommand',$encoded) -PassThru
Write-Host ('Terminal de recuperación CI Tomasini abierta (PID ' + $process.Id + ').')
