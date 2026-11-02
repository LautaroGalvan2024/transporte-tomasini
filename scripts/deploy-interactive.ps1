[CmdletBinding()]
param([Parameter(Mandatory)][string]$ReleaseManifest)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
try {
  $release = Get-Content -LiteralPath (Resolve-Path -LiteralPath $ReleaseManifest).Path -Raw | ConvertFrom-Json
  $runtime = Get-Content -LiteralPath (Join-Path $projectRoot '.local\runtime\node-verification.json') -Raw | ConvertFrom-Json
  $parameters = @{
    Release = $release.archive; ReleaseSha = $release.sha256
    NodeArchive = $runtime.archive; NodeSha = $runtime.sha256
    InstallerSha = $release.installerSha256; ExporterSha = $release.exporterSha256
    ResumeRelease = [bool]$release.resumeRelease
  }
  Set-Location -LiteralPath $projectRoot
  & (Join-Path $PSScriptRoot 'deploy.ps1') @parameters
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Conservar esta evidencia. No repetir el instalador ni borrar recursos para reintentar.'
} finally {
  [void](Read-Host 'Presioná Enter para cerrar esta terminal')
}
