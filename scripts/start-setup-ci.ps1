[CmdletBinding()]
param([Parameter(Mandatory)][string]$SetupManifest)
$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path -LiteralPath $SetupManifest).Path
$scriptPath = Join-Path $PSScriptRoot 'setup-ci-interactive.ps1'
function ConvertTo-PowerShellLiteral([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
$command = '& ' + (ConvertTo-PowerShellLiteral $scriptPath) + ' -SetupManifest ' + (ConvertTo-PowerShellLiteral $manifestPath)
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$process = Start-Process -FilePath (Get-Command pwsh -ErrorAction Stop).Source -WindowStyle Normal -ArgumentList @('-NoProfile','-EncodedCommand',$encoded) -PassThru
Write-Host ('Terminal de configuración CI Tomasini abierta (PID ' + $process.Id + ').')
