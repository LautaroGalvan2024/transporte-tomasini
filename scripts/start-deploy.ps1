[CmdletBinding()]
param([Parameter(Mandatory)][string]$ReleaseManifest)
$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path -LiteralPath $ReleaseManifest).Path
$interactiveScript = Join-Path $PSScriptRoot 'deploy-interactive.ps1'
function ConvertTo-PowerShellLiteral([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
$command = '& ' + (ConvertTo-PowerShellLiteral $interactiveScript) + ' -ReleaseManifest ' + (ConvertTo-PowerShellLiteral $manifestPath)
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$powerShellPath = (Get-Command pwsh -ErrorAction Stop).Source
# Visible deliberately: the user must enter sudo directly into SSH, never into chat.
$process = Start-Process -FilePath $powerShellPath -WindowStyle Normal -ArgumentList @('-NoProfile','-EncodedCommand',$encodedCommand) -PassThru
Write-Host ('Terminal interactiva de despliegue abierta (PID ' + $process.Id + '). La contraseña se ingresa únicamente allí.')
