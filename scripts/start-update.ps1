[CmdletBinding(DefaultParameterSetName='Standard')]
param(
  [Parameter(Mandatory,ParameterSetName='Standard')]
  [Parameter(Mandatory,ParameterSetName='Resume')][string]$UpdateManifest,
  [Parameter(Mandatory,ParameterSetName='Resume')][switch]$ResumePreparation,
  [Parameter(Mandatory,ParameterSetName='Resume')][ValidatePattern('^[a-f0-9]{64}$')][string]$RecoveryUpdaterSha256
)
$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path -LiteralPath $UpdateManifest).Path
$scriptPath = Join-Path $PSScriptRoot 'update-interactive.ps1'
function ConvertTo-PowerShellLiteral([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
$command = '& ' + (ConvertTo-PowerShellLiteral $scriptPath) + ' -UpdateManifest ' + (ConvertTo-PowerShellLiteral $manifestPath)
if ($ResumePreparation) {
  $command += ' -ResumePreparation -RecoveryUpdaterSha256 ' + (ConvertTo-PowerShellLiteral $RecoveryUpdaterSha256)
}
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$process = Start-Process -FilePath (Get-Command pwsh -ErrorAction Stop).Source -WindowStyle Normal -ArgumentList @('-NoProfile','-EncodedCommand',$encoded) -PassThru
Write-Host ('Terminal de actualización Tomasini abierta (PID ' + $process.Id + ').')
