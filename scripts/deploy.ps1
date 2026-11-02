[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Release,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ReleaseSha,
  [Parameter(Mandatory)][string]$NodeArchive,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$NodeSha,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$InstallerSha,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExporterSha,
  [switch]$ResumeRelease,
  [string]$SshKey = "$env:USERPROFILE\.ssh\github_actions_mozzi_prod"
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseFile = (Resolve-Path -LiteralPath $Release).Path
$nodeFile = (Resolve-Path -LiteralPath $NodeArchive).Path
$installer = Join-Path $projectRoot 'infra\install_vps.py'
$exporter = Join-Path $projectRoot 'infra\export_artifacts.py'
if ((Get-FileHash -LiteralPath $releaseFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ReleaseSha) { throw 'La huella del release no coincide.' }
if ((Get-FileHash -LiteralPath $nodeFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $NodeSha) { throw 'La huella del runtime Node no coincide.' }
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $InstallerSha) { throw 'El instalador cambió después de preparar el release.' }
if ((Get-FileHash -LiteralPath $exporter -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExporterSha) { throw 'El exportador cambió después de preparar el release.' }
$shortHash = $ReleaseSha.Substring(0,16)
$evidenceDirectory = Join-Path $projectRoot ('.local\deployments\' + $shortHash)
$accessDirectory = Join-Path $projectRoot ('.local\production-access\' + $shortHash)
$priorState = $null
if ($ResumeRelease) {
  $priorStatePath = Join-Path $evidenceDirectory 'state.json'
  if (-not (Test-Path -LiteralPath $priorStatePath)) { throw 'Falta el estado del intento inicial; no se puede recuperar.' }
  $priorState = Get-Content -LiteralPath $priorStatePath -Raw | ConvertFrom-Json
  if ($priorState.release -ne $ReleaseSha -or $priorState.stage -ne 'needs_review' -or (Test-Path -LiteralPath (Join-Path $evidenceDirectory 'installed.json')) -or (Test-Path -LiteralPath (Join-Path $evidenceDirectory 'state-before-resume.json'))) { throw 'El estado local no permite retomar exclusivamente la preparación inicial.' }
  Copy-Item -LiteralPath $priorStatePath -Destination (Join-Path $evidenceDirectory 'state-before-resume.json')
} elseif ((Test-Path -LiteralPath $evidenceDirectory) -or (Test-Path -LiteralPath $accessDirectory)) { throw 'Ya existe estado local para este release. Revisarlo antes de reintentar.' }
$identity = (& whoami.exe).Trim()
foreach ($directory in @($evidenceDirectory, $accessDirectory)) {
  if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
  & icacls.exe $directory /inheritance:r /grant:r ($identity + ':(OI)(CI)F') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudieron restringir los permisos de la carpeta local privada.' }
}
$statePath = Join-Path $evidenceDirectory 'state.json'
function Write-DeployState([string]$stage, [string]$detail = '') {
  @{ stage = $stage; detail = $detail; release = $ReleaseSha; updatedAt = [DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}
Write-DeployState 'preparing'
$remoteDirectory = '/home/mozzi/tomasini-deploy-' + $ReleaseSha.Substring(0,16)
$sshOptions = @('-i', $SshKey, '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')
$deploymentInstalled = $false
try {
if ($ResumeRelease) {
  & ssh @sshOptions -o BatchMode=yes mozzi@72.60.50.213 "test -d '$remoteDirectory' && test -f '$remoteDirectory/release.tar.gz' && test -f '$remoteDirectory/node.tar.xz' && test ! -e '$remoteDirectory/resume_vps.py' && test ! -e '$remoteDirectory/export_artifacts_v2.py'"
  if ($LASTEXITCODE -ne 0) { throw 'Los archivos remotos no permiten esta recuperación única; no se sobrescriben.' }
  $installerName = 'resume_vps.py'
  $exporterName = 'export_artifacts_v2.py'
  $uploads = @(@($installer, $installerName), @($exporter, $exporterName))
} else {
& ssh @sshOptions -o BatchMode=yes mozzi@72.60.50.213 "mkdir -m 700 '$remoteDirectory'"
if ($LASTEXITCODE -ne 0) { throw 'No se creó el directorio remoto exclusivo. No se reutiliza ni elimina uno anterior.' }
  $installerName = 'install_vps.py'
  $exporterName = 'export_artifacts.py'
  $uploads = @(@($releaseFile, 'release.tar.gz'), @($nodeFile, 'node.tar.xz'), @($installer, $installerName), @($exporter, $exporterName))
}
foreach ($entry in $uploads) {
  & scp @sshOptions -- $entry[0] ("mozzi@72.60.50.213:" + $remoteDirectory + '/' + $entry[1])
  if ($LASTEXITCODE -ne 0) { throw 'Falló la transferencia del paquete propio.' }
}
Write-Host 'La VPS pedirá sudo en esta terminal. Escribí la contraseña allí; no se guarda ni se envía al chat.'
Write-Host 'El instalador rechaza recursos existentes y solo instala Tomasini. Una falla conserva la base y el estado para revisión.'
$remoteCommand = @'
cd '__DIR__' || exit 1
printf '%s  __INSTALL_FILE__\n' '__INSTALLER__' | sha256sum -c --status || exit 1
printf '%s  __EXPORT_FILE__\n' '__EXPORTER__' | sha256sum -c --status || exit 1
sudo -k python3 __INSTALL_FILE__ --release release.tar.gz --release-sha __RELEASE__ --node-archive node.tar.xz --node-sha __NODE__ __RESUME__ --export-helper __EXPORT_FILE__ --export-helper-sha __EXPORTER__
exit $?
'@
$remoteCommand = $remoteCommand.Replace('__DIR__', $remoteDirectory).Replace('__INSTALLER__', $InstallerSha).Replace('__EXPORTER__', $ExporterSha).Replace('__RELEASE__', $ReleaseSha).Replace('__NODE__', $NodeSha)
$resumeFlag = if ($ResumeRelease) { '--resume-release' } else { '' }
$remoteCommand = $remoteCommand.Replace('__INSTALL_FILE__', $installerName).Replace('__EXPORT_FILE__', $exporterName).Replace('__RESUME__', $resumeFlag)
Write-DeployState 'awaiting_sudo_or_installing'
& ssh @sshOptions -t mozzi@72.60.50.213 $remoteCommand
if ($LASTEXITCODE -eq 2) { $deploymentInstalled = $true; Write-DeployState 'installed_handoff_pending'; throw 'El sistema está instalado; quedó pendiente la descarga privada. No volver a instalar.' }
if ($LASTEXITCODE -ne 0) { throw 'La instalación no terminó correctamente. No repetir ni borrar recursos para reintentar: revisar el estado privado.' }
$deploymentInstalled = $true
Write-DeployState 'downloading_private_artifacts'
$remoteHandoff = $remoteDirectory + '/handoff'
$artifactNames = @('admin-inicial.json','installed.json','preflight.json','postflight.json','tomasini_prod.dump','backup-manifest.json')
foreach ($name in $artifactNames) {
  $destination = if ($name -eq 'admin-inicial.json') { Join-Path $accessDirectory $name } else { Join-Path $evidenceDirectory $name }
  & scp @sshOptions -o BatchMode=yes -- ("mozzi@72.60.50.213:" + $remoteHandoff + '/' + $name) $destination
  if ($LASTEXITCODE -ne 0) { throw 'El sistema está instalado; falló la descarga privada. No repetir la instalación.' }
}
$receipt = Get-Content -LiteralPath (Join-Path $evidenceDirectory 'installed.json') -Raw | ConvertFrom-Json
if ($receipt.release -ne $ReleaseSha -or -not $receipt.verification.existingApplicationsPreserved) { throw 'El recibo no confirma el release y las comprobaciones esperadas.' }
$backupManifest = Get-Content -LiteralPath (Join-Path $evidenceDirectory 'backup-manifest.json') -Raw | ConvertFrom-Json
if ($backupManifest.database -ne 'tomasini_prod' -or (Get-FileHash -LiteralPath (Join-Path $evidenceDirectory 'tomasini_prod.dump') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $backupManifest.sha256) { throw 'El respaldo descargado no coincide con su huella.' }
foreach ($pair in @(@('preflight.json', $receipt.verification.beforeSha256), @('postflight.json', $receipt.verification.afterSha256))) {
  if ((Get-FileHash -LiteralPath (Join-Path $evidenceDirectory $pair[0]) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pair[1]) { throw 'La evidencia descargada no coincide con su huella.' }
}
$removeFiles = ($artifactNames | ForEach-Object { "'" + $remoteHandoff + '/' + $_ + "'" }) -join ' '
& ssh @sshOptions -o BatchMode=yes mozzi@72.60.50.213 ("rm -- " + $removeFiles + " && rmdir -- '" + $remoteHandoff + "'")
if ($LASTEXITCODE -ne 0) { Write-DeployState 'installed_private_copy_cleanup_pending'; throw 'Instalación y descarga completas; revisar eliminación de las copias temporales privadas de entrega.' }
Write-DeployState 'installed_verified_backup_downloaded'
Write-Host 'Instalación verificada. Credencial inicial y respaldo descargados en .local con acceso privado; no se imprimieron.'
Write-Host ('Estado y evidencia: ' + $statePath)
} catch {
  $currentState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if ($currentState.stage -notin @('installed_handoff_pending','installed_private_copy_cleanup_pending')) {
    $failureStage = if ($deploymentInstalled) { 'installed_handoff_pending' } else { 'needs_review' }
    Write-DeployState $failureStage $_.Exception.Message
  }
  throw
}
