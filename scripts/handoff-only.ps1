[CmdletBinding()]
param([Parameter(Mandatory)][string]$ReleaseManifest)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = Get-Content -LiteralPath (Resolve-Path -LiteralPath $ReleaseManifest).Path -Raw | ConvertFrom-Json
if ($release.sha256 -notmatch '^[a-f0-9]{64}$' -or $release.exporterSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Manifiesto inválido.' }
$shortHash = $release.sha256.Substring(0,16)
$evidenceDirectory = Join-Path $projectRoot ('.local\deployments\' + $shortHash)
$accessDirectory = Join-Path $projectRoot ('.local\production-access\' + $shortHash)
$statePath = Join-Path $evidenceDirectory 'state.json'
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($state.stage -ne 'installed_handoff_pending' -or $state.release -ne $release.sha256) { throw 'El estado no corresponde a una instalación completada pendiente de entrega.' }
$savedState = Join-Path $evidenceDirectory 'state-before-handoff.json'
if (Test-Path -LiteralPath $savedState) { throw 'Ya se inició la entrega final. Revisar su estado antes de repetirla.' }
Copy-Item -LiteralPath $statePath -Destination $savedState
function Write-HandoffState([string]$stage, [string]$detail = '') {
  @{ stage=$stage; detail=$detail; release=$release.sha256; updatedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}
$sshOptions = @('-i', (Join-Path $env:USERPROFILE '.ssh\github_actions_mozzi_prod'), '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')
$remoteDirectory = '/home/mozzi/tomasini-deploy-' + $shortHash
$exporterName = if ($release.resumeRelease) { 'export_artifacts_v2.py' } else { 'export_artifacts.py' }
$remoteHandoff = $remoteDirectory + '/handoff'
$names = @('admin-inicial.json','installed.json','preflight.json','postflight.json','tomasini_prod.dump','backup-manifest.json')
try {
  foreach ($name in $names) {
    $target = if ($name -eq 'admin-inicial.json') { Join-Path $accessDirectory $name } else { Join-Path $evidenceDirectory $name }
    if (Test-Path -LiteralPath $target) { throw 'Hay una entrega local parcial; no se sobrescriben sus archivos.' }
  }
  $remoteCommand = @'
cd '__DIR__' || exit 1
test ! -e handoff && test ! -L handoff || exit 1
printf '%s  __EXPORTER__\n' '__HASH__' | sha256sum -c --status || exit 1
sudo -k python3 __EXPORTER__ --release-sha __RELEASE__
'@
  $remoteCommand = $remoteCommand.Replace('__DIR__',$remoteDirectory).Replace('__EXPORTER__',$exporterName).Replace('__HASH__',$release.exporterSha256).Replace('__RELEASE__',$release.sha256)
  Write-Host 'Tomasini ya está instalado. Este paso solamente recupera el acceso privado y el respaldo.'
  Write-Host 'Ingresá sudo directamente en esta terminal. No se reinstala ni reinicia ninguna aplicación.'
  Write-HandoffState 'handoff_authentication'
  & ssh @sshOptions -t mozzi@72.60.50.213 $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw 'No se completó la entrega privada. La aplicación instalada permanece funcionando.' }
  Write-HandoffState 'downloading_private_artifacts'
  foreach ($name in $names) {
    $target = if ($name -eq 'admin-inicial.json') { Join-Path $accessDirectory $name } else { Join-Path $evidenceDirectory $name }
    & scp @sshOptions -o BatchMode=yes -- ("mozzi@72.60.50.213:" + $remoteHandoff + '/' + $name) $target
    if ($LASTEXITCODE -ne 0) { throw 'Falló una descarga privada; conservar los archivos recibidos para revisar.' }
  }
  $receipt = Get-Content -LiteralPath (Join-Path $evidenceDirectory 'installed.json') -Raw | ConvertFrom-Json
  if ($receipt.release -ne $release.sha256 -or -not $receipt.verification.existingApplicationsPreserved) { throw 'Recibo inesperado.' }
  $metadata = Get-Content -LiteralPath (Join-Path $evidenceDirectory 'backup-manifest.json') -Raw | ConvertFrom-Json
  $checks = @(@('preflight.json',$receipt.verification.beforeSha256),@('postflight.json',$receipt.verification.afterSha256),@('tomasini_prod.dump',$metadata.sha256))
  if ($metadata.database -ne 'tomasini_prod') { throw 'Respaldo de una base inesperada.' }
  foreach ($pair in $checks) {
    if ((Get-FileHash -LiteralPath (Join-Path $evidenceDirectory $pair[0]) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pair[1]) { throw 'Una huella descargada no coincide.' }
  }
  $removeFiles = ($names | ForEach-Object { "'" + $remoteHandoff + '/' + $_ + "'" }) -join ' '
  & ssh @sshOptions -o BatchMode=yes mozzi@72.60.50.213 ("rm -- " + $removeFiles + " && rmdir -- '" + $remoteHandoff + "'")
  if ($LASTEXITCODE -ne 0) { Write-HandoffState 'installed_private_copy_cleanup_pending'; throw 'Entrega completa; revisar la limpieza de las copias temporales remotas.' }
  Write-HandoffState 'installed_verified_backup_downloaded'
  Write-Host 'Acceso privado, evidencia y respaldo descargados y verificados. No se imprimieron contraseñas.' -ForegroundColor Green
} catch {
  $latest = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if ($latest.stage -ne 'installed_private_copy_cleanup_pending') { Write-HandoffState 'installed_handoff_pending' $_.Exception.Message }
  Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
  [void](Read-Host 'Presioná Enter para cerrar esta terminal')
}
