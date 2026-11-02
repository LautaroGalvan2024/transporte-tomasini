[CmdletBinding()]
param([Parameter(Mandatory)][string]$RepairManifest)
$ErrorActionPreference = 'Stop'
$statePath = $null
try {
  $manifest = Get-Content -LiteralPath (Resolve-Path -LiteralPath $RepairManifest).Path -Raw | ConvertFrom-Json
  if ($manifest.mode -ne 'repair-before-access') { throw 'Se requiere el manifiesto de recuperación revisado.' }
  foreach ($property in $manifest.files.PSObject.Properties) {
    $name, $hash = $property.Name, $property.Value
    if ($hash -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $manifest.sources.$name -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'Un artefacto de recuperación cambió después de revisión.' }
  }
  if ((Get-FileHash -LiteralPath $manifest.remoteManifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.manifestSha256) { throw 'El manifiesto revisado cambió.' }
  $directory = Split-Path -Parent (Resolve-Path -LiteralPath $RepairManifest).Path
  $statePath = Join-Path $directory 'state.json'
  if (Test-Path -LiteralPath $statePath) { throw 'Esta recuperación ya tiene estado; no se repite automáticamente.' }
  function Write-RepairState([string]$stage,[string]$detail='') {
    @{stage=$stage; detail=$detail; updatedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8NoBOM
  }
  $remote = '/home/mozzi/tomasini-ci-repair-' + $manifest.manifestSha256.Substring(0,16)
  $sshOptions = @('-i',(Join-Path $env:USERPROFILE '.ssh\github_actions_mozzi_prod'),'-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3')
  Write-RepairState 'preparing'
  & ssh @sshOptions -o BatchMode=yes mozzi@72.60.50.213 "mkdir -m 700 '$remote'"
  if ($LASTEXITCODE -ne 0) { throw 'No se creó una carpeta nueva de recuperación.' }
  foreach ($property in $manifest.sources.PSObject.Properties) {
    & scp @sshOptions -o BatchMode=yes -- $property.Value ("mozzi@72.60.50.213:" + $remote + '/' + $property.Name)
    if ($LASTEXITCODE -ne 0) { throw 'Falló una transferencia de recuperación.' }
  }
  & scp @sshOptions -o BatchMode=yes -- $manifest.remoteManifest ("mozzi@72.60.50.213:" + $remote + '/repair.json')
  if ($LASTEXITCODE -ne 0) { throw 'Falló la transferencia del manifiesto.' }
  $command = @'
cd '__DIR__' || exit 1
printf '%s  repair_ci_bootstrap.py\n' '__REPAIR__' | sha256sum -c --status || exit 1
printf '%s  repair.json\n' '__MANIFEST__' | sha256sum -c --status || exit 1
exec sudo -k python3 -I repair_ci_bootstrap.py --manifest repair.json
'@
  $command = $command.Replace('__DIR__',$remote).Replace('__REPAIR__',$manifest.files.'repair_ci_bootstrap.py').Replace('__MANIFEST__',$manifest.manifestSha256)
  Write-Host 'Se validará el fallo conocido y se retomará únicamente la preparación del acceso CI. La aplicación no se reinstala ni reinicia.'
  Write-Host 'Ingresá sudo aquí. El mismo proceso entrega el diagnóstico privado tanto si termina bien como si falla.'
  Write-RepairState 'awaiting_sudo_or_recovering'
  & ssh @sshOptions -t mozzi@72.60.50.213 $command
  $result = $LASTEXITCODE
  # Download bounded diagnostics regardless of the root command's result, without another sudo.
  & scp @sshOptions -o BatchMode=yes -- ("mozzi@72.60.50.213:" + $remote + '/ci-build-diagnostic.json') (Join-Path $directory 'ci-build-diagnostic.json') 2>$null
  $diagnosticDownloaded = $LASTEXITCODE -eq 0
  if ($result -ne 0) { throw ('La recuperación se detuvo; no repetir. Diagnóstico descargado: ' + $diagnosticDownloaded) }
  $receiptPath = Join-Path $directory 'ci-public-receipt.json'
  & scp @sshOptions -o BatchMode=yes -- ("mozzi@72.60.50.213:" + $remote + '/ci-public-receipt.json') $receiptPath
  if ($LASTEXITCODE -ne 0) { throw 'Acceso configurado; queda descargar su recibo sin repetir la recuperación.' }
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  if ($receipt.status -ne 'ci_access_configured' -or $receipt.expectedRelease -ne $manifest.expectedRelease -or -not $receipt.verification.fullBuildProbePassed -or -not $receipt.verification.existingApplicationsPreserved -or -not $receipt.verification.applicationNotRestarted) { throw 'El recibo no confirma las verificaciones requeridas.' }
  Write-RepairState 'ci_recovered_build_probe_verified'
  Write-Host 'Acceso CI configurado y build Linux completo verificado. Aplicación y servicios existentes conservados.' -ForegroundColor Green
} catch {
  if ($statePath) { Write-RepairState 'needs_review' $_.Exception.Message }
  Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
  [void](Read-Host 'Presioná Enter para cerrar esta terminal')
}
