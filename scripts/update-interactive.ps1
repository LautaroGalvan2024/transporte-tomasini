[CmdletBinding()]
param([Parameter(Mandatory)][string]$UpdateManifest)
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
  foreach ($pair in @(@($manifest.archive,$manifest.sha256),@($manifest.planPath,$manifest.planSha256),@($updater,$manifest.updaterSha256),@($core,$manifest.coreSha256))) {
    if ((Get-FileHash -LiteralPath $pair[0] -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pair[1]) { throw 'Un artefacto cambió después de preparar y revisar el plan.' }
  }
  $shortHash = $manifest.sha256.Substring(0,16)
  $directory = Join-Path $projectRoot ('.local\deployments\' + $shortHash)
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
  $remote = '/home/mozzi/tomasini-update-' + $shortHash
  $sshOptions = @('-i',(Join-Path $env:USERPROFILE '.ssh\github_actions_mozzi_prod'),'-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10')
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
sudo -k python3 update_vps.py --release release.tar.gz --release-sha __RELEASE__ --plan plan.json --plan-sha __PLAN__ --core-sha __CORE__
exit $?
'@
  $command = $command.Replace('__DIR__',$remote).Replace('__UPDATER__',$manifest.updaterSha256).Replace('__CORE__',$manifest.coreSha256).Replace('__RELEASE__',$manifest.sha256).Replace('__PLAN__',$manifest.planSha256)
  Write-Host 'Se actualizará únicamente Tomasini, conservando usuarios, datos y configuración.'
  Write-Host 'El proceso crea un respaldo previo y aplica la migración aditiva revisada. Ingresá sudo aquí; no se guarda ni se envía al chat.'
  Write-UpdateState 'awaiting_sudo_or_updating'
  & ssh @sshOptions -t mozzi@72.60.50.213 $command
  $result = $LASTEXITCODE
  if ($result -eq 2) { $updated = $true; throw 'Tomasini quedó actualizado; la entrega privada está pendiente. No repetir la actualización.' }
  if ($result -ne 0) {
    foreach ($name in @('failure.json','diagnostics.json')) {
      & scp @sshOptions -o BatchMode=yes -- ("mozzi@72.60.50.213:" + $remote + '/diagnostics/' + $name) (Join-Path $directory $name) 2>$null
    }
    throw 'La actualización se detuvo. Revisar el estado y diagnóstico privado; no reinstalar, borrar ni repetir automáticamente.'
  }
  $updated = $true
  Write-UpdateState 'downloading_update_evidence'
  $names = @('installed.json','preflight.json','postflight.json','backup-manifest.json','tomasini_prod.dump','migration-plan.json')
  foreach ($name in $names) {
    & scp @sshOptions -o BatchMode=yes -- ("mozzi@72.60.50.213:" + $remote + '/handoff/' + $name) (Join-Path $directory $name)
    if ($LASTEXITCODE -ne 0) { throw 'Actualización completada; una descarga privada quedó pendiente.' }
  }
  $receipt = Get-Content -LiteralPath (Join-Path $directory 'installed.json') -Raw | ConvertFrom-Json
  if ($receipt.kind -ne 'update' -or $receipt.release -ne $manifest.sha256 -or $receipt.previousRelease -ne $manifest.previousReleaseSha256 -or -not $receipt.verification.existingApplicationsPreserved -or -not $receipt.verification.apiEnvironmentPreserved) { throw 'El recibo no confirma la actualización y conservación esperadas.' }
  $backup = Get-Content -LiteralPath (Join-Path $directory 'backup-manifest.json') -Raw | ConvertFrom-Json
  if ($backup.database -ne 'tomasini_prod' -or $backup.purpose -ne 'before-additive-update') { throw 'El respaldo no corresponde al estado previo a esta actualización.' }
  foreach ($pair in @(@('preflight.json',$receipt.verification.beforeSha256),@('postflight.json',$receipt.verification.afterSha256),@('tomasini_prod.dump',$backup.sha256))) {
    if ((Get-FileHash -LiteralPath (Join-Path $directory $pair[0]) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pair[1]) { throw 'Una huella de evidencia descargada no coincide.' }
  }
  $remove = ($names | ForEach-Object { "'" + $remote + '/handoff/' + $_ + "'" }) -join ' '
  & ssh @sshOptions -o BatchMode=yes mozzi@72.60.50.213 ("rm -- " + $remove + " && rmdir -- '" + $remote + "/handoff'")
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
