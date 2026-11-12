[CmdletBinding(DefaultParameterSetName='Standard')]
param(
  [Parameter(Mandatory,ParameterSetName='Standard')]
  [Parameter(Mandatory,ParameterSetName='Resume')][string]$UpdateManifest,
  [Parameter(Mandatory,ParameterSetName='Resume')][switch]$ResumePreparation,
  [Parameter(Mandatory,ParameterSetName='Resume')][ValidatePattern('^[a-f0-9]{64}$')][string]$RecoveryUpdaterSha256
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$statePath = $null
$updated = $false
try {
  $manifest = Get-Content -LiteralPath (Resolve-Path -LiteralPath $UpdateManifest).Path -Raw | ConvertFrom-Json
  if ($manifest.mode -ne 'update') { throw 'Se requiere un manifiesto de actualización.' }
  foreach ($hash in @($manifest.sha256,$manifest.previousReleaseSha256,$manifest.planSha256,$manifest.updaterSha256,$manifest.coreSha256)) {
    if ($hash -notmatch '^[a-f0-9]{64}$') { throw 'Una huella del manifiesto no es válida.' }
  }
  $updater = Join-Path $projectRoot 'infra\update_vps.py'
  $core = Join-Path $projectRoot 'infra\install_vps.py'
  $updaterHash = if ($ResumePreparation) { $RecoveryUpdaterSha256.ToLowerInvariant() } else { $manifest.updaterSha256 }
  foreach ($pair in @(@($manifest.archive,$manifest.sha256),@($manifest.planPath,$manifest.planSha256),@($updater,$updaterHash),@($core,$manifest.coreSha256))) {
    if ((Get-FileHash -LiteralPath $pair[0] -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pair[1]) { throw 'Un artefacto cambió después de preparar y revisar el plan.' }
  }
  $shortHash = $manifest.sha256.Substring(0,16)
  $directory = Join-Path $projectRoot ('.local\deployments\' + $shortHash)
  $handoffRoot = '/home/mozzi/tomasini-update-' + $shortHash
  $remote = $handoffRoot
  if ($ResumePreparation) {
    $Host.UI.RawUI.WindowTitle = 'Transporte Tomasini · Publicar Controles y planilla'
    $plan = Get-Content -LiteralPath $manifest.planPath -Raw | ConvertFrom-Json
    $prior = Get-Content -LiteralPath (Join-Path $directory 'state.json') -Raw | ConvertFrom-Json
    if (@($plan.pendingMigrations).Count -ne 1 -or $plan.pendingMigrations[0] -ne '202611110001_trip_control_count' -or
        $plan.releaseSha256 -ne $manifest.sha256 -or $plan.previousReleaseSha256 -ne $manifest.previousReleaseSha256 -or
        $prior.release -ne $manifest.sha256 -or $prior.previousRelease -ne $manifest.previousReleaseSha256 -or
        $prior.stage -notin @('awaiting_sudo_or_updating','update_needs_review') -or
        (Test-Path -LiteralPath (Join-Path $directory 'installed.json'))) {
      throw 'La reanudación sólo admite una preparación interrumpida del plan de Controles.'
    }
    $directory = Join-Path $directory 'resume-preparation'
    $remote = '/home/mozzi/tomasini-resume-' + $shortHash
  }
  if (Test-Path -LiteralPath $directory) { throw 'Ya existe estado para este release; revisarlo antes de repetir una actualización.' }
  New-Item -ItemType Directory -Path $directory | Out-Null
  $identity = (& whoami.exe).Trim()
  & icacls.exe $directory /inheritance:r /grant:r ($identity + ':(OI)(CI)F') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo proteger la evidencia local.' }
  $statePath = Join-Path $directory 'state.json'
  function Write-UpdateState([string]$stage,[string]$detail='') {
    @{stage=$stage; detail=$detail; release=$manifest.sha256; previousRelease=$manifest.previousReleaseSha256; updatedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
  }
  Write-UpdateState 'preparing_update'
  $sshOptions = @('-i',(Join-Path $env:USERPROFILE '.ssh\github_actions_mozzi_prod'),'-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10')
  if ($ResumePreparation) {
    $inspectOriginal = @'
cd '__ORIGINAL__' || exit 1
for name in handoff diagnostics; do
  if test -e "$name" || test -L "$name"; then exit 1; fi
done
printf '%s  release.tar.gz\n%s  plan.json\n%s  update_vps.py\n%s  install_vps.py\n' '__RELEASE__' '__PLAN__' '__UPDATER__' '__CORE__' | sha256sum --check --status
'@
    $inspectOriginal = $inspectOriginal.Replace('__ORIGINAL__',$handoffRoot).Replace('__RELEASE__',$manifest.sha256).Replace('__PLAN__',$manifest.planSha256).Replace('__UPDATER__',$manifest.updaterSha256).Replace('__CORE__',$manifest.coreSha256)
    & ssh @sshOptions -o BatchMode=yes mozzi@72.60.50.213 $inspectOriginal
    if ($LASTEXITCODE -ne 0) { throw 'Los archivos del intento original cambiaron o ya tienen resultados para revisar.' }
  }
  & ssh @sshOptions -o BatchMode=yes mozzi@72.60.50.213 "mkdir -m 700 '$remote'"
  if ($LASTEXITCODE -ne 0) { throw 'No se creó una carpeta remota nueva; no se reutiliza una anterior.' }
  foreach ($file in @(@($manifest.archive,'release.tar.gz'),@($manifest.planPath,'plan.json'),@($updater,'update_vps.py'),@($core,'install_vps.py'))) {
    & scp @sshOptions -o BatchMode=yes -- $file[0] ("mozzi@72.60.50.213:" + $remote + '/' + $file[1])
    if ($LASTEXITCODE -ne 0) { throw 'Falló la transferencia de los artefactos de actualización.' }
  }
  $command = @'
cd '__DIR__' || exit 1
printf '%s  update_vps.py\n' '__UPDATER__' | sha256sum -c --status || exit 1
printf '%s  install_vps.py\n' '__CORE__' | sha256sum -c --status || exit 1
__START__ --release release.tar.gz --release-sha __RELEASE__ --plan plan.json --plan-sha __PLAN__ --core-sha __CORE__
exit $?
'@
  $start = if ($ResumePreparation) {
    "sudo -k /usr/bin/systemd-run --quiet --wait --collect --unit=tomasini-update-$shortHash --property=WorkingDirectory=$remote /usr/bin/python3 $remote/update_vps.py --resume-preparation"
  } else { 'sudo -k python3 update_vps.py' }
  $command = $command.Replace('__DIR__',$remote).Replace('__UPDATER__',$updaterHash).Replace('__CORE__',$manifest.coreSha256).Replace('__RELEASE__',$manifest.sha256).Replace('__PLAN__',$manifest.planSha256).Replace('__START__',$start)
  Write-Host 'Se actualizará únicamente Tomasini, conservando usuarios, datos y configuración.'
  Write-Host 'El proceso crea un respaldo previo y aplica la migración aditiva revisada. Ingresá sudo aquí; no se guarda ni se envía al chat.'
  if ($ResumePreparation) {
    Write-UpdateState 'awaiting_local_enter'
    [void](Read-Host 'Presioná Enter cuando estés listo para escribir la contraseña de sudo de la VPS')
  }
  Write-UpdateState 'awaiting_sudo_or_updating'
  & ssh @sshOptions -t mozzi@72.60.50.213 $command
  $result = $LASTEXITCODE
  if ($result -eq 2) { $updated = $true; throw 'Tomasini quedó actualizado; la entrega privada está pendiente. No repetir la actualización.' }
  if ($result -ne 0) {
    foreach ($name in @('failure.json','diagnostics.json')) {
      & scp @sshOptions -o BatchMode=yes -- ("mozzi@72.60.50.213:" + $handoffRoot + '/diagnostics/' + $name) (Join-Path $directory $name) 2>$null
    }
    throw 'La actualización se detuvo. Revisar el estado y diagnóstico privado; no reinstalar, borrar ni repetir automáticamente.'
  }
  $updated = $true
  Write-UpdateState 'downloading_update_evidence'
  $names = @('installed.json','preflight.json','postflight.json','backup-manifest.json','tomasini_prod.dump','migration-plan.json')
  if ($manifest.recoveryPolicy -eq 'forward-only') { $names += @('data-preservation.json','data-access.json') }
  foreach ($name in $names) {
    & scp @sshOptions -o BatchMode=yes -- ("mozzi@72.60.50.213:" + $handoffRoot + '/handoff/' + $name) (Join-Path $directory $name)
    if ($LASTEXITCODE -ne 0) { throw 'Actualización completada; una descarga privada quedó pendiente.' }
  }
  $receipt = Get-Content -LiteralPath (Join-Path $directory 'installed.json') -Raw | ConvertFrom-Json
  if ($receipt.kind -ne 'update' -or $receipt.release -ne $manifest.sha256 -or $receipt.previousRelease -ne $manifest.previousReleaseSha256 -or -not $receipt.verification.existingApplicationsPreserved -or -not $receipt.verification.apiEnvironmentPreserved -or -not $receipt.verification.migrationRoleLocked) { throw 'El recibo no confirma la actualización y conservación esperadas.' }
  if ($manifest.recoveryPolicy -eq 'forward-only' -and (-not $receipt.verification.originalDataPreserved -or -not $receipt.verification.newBackendReadOnlyVerified -or -not $receipt.verification.notificationTimerRestored)) { throw 'Falta evidencia de conservación de datos o funcionamiento de la nueva flota.' }
  $backup = Get-Content -LiteralPath (Join-Path $directory 'backup-manifest.json') -Raw | ConvertFrom-Json
  if ($backup.database -ne 'tomasini_prod' -or $backup.purpose -ne 'before-additive-update') { throw 'El respaldo no corresponde al estado previo a esta actualización.' }
  foreach ($pair in @(@('preflight.json',$receipt.verification.beforeSha256),@('postflight.json',$receipt.verification.afterSha256),@('tomasini_prod.dump',$backup.sha256))) {
    if ((Get-FileHash -LiteralPath (Join-Path $directory $pair[0]) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pair[1]) { throw 'Una huella de evidencia descargada no coincide.' }
  }
  $remove = ($names | ForEach-Object { "'" + $handoffRoot + '/handoff/' + $_ + "'" }) -join ' '
  & ssh @sshOptions -o BatchMode=yes mozzi@72.60.50.213 ("rm -- " + $remove + " && rmdir -- '" + $handoffRoot + "/handoff'")
  if ($LASTEXITCODE -ne 0) { throw 'Actualización y descarga completas; queda revisar limpieza de copias temporales de entrega.' }
  Write-UpdateState 'updated_verified_backup_downloaded'
  Write-Host 'Tomasini actualizado. Usuarios, datos, configuración y aplicaciones existentes verificados. Respaldo previo y evidencia descargados en .local.' -ForegroundColor Green
} catch {
  if ($statePath) {
    $stage = if ($updated) { 'updated_handoff_pending' } else { 'update_needs_review' }
    Write-UpdateState $stage $_.Exception.Message
  }
  Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
  [void](Read-Host 'Presioná Enter para cerrar esta terminal')
}
