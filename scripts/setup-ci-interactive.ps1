[CmdletBinding()]
param([Parameter(Mandatory)][string]$SetupManifest)
$ErrorActionPreference = 'Stop'
$statePath = $null
try {
  $manifest = Get-Content -LiteralPath (Resolve-Path -LiteralPath $SetupManifest).Path -Raw | ConvertFrom-Json
  foreach ($property in $manifest.files.PSObject.Properties) {
    $name, $hash = $property.Name, $property.Value
    if ($hash -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $manifest.sources.$name -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'Un helper o clave pública cambió después de revisión.' }
  }
  if ((Get-FileHash -LiteralPath $manifest.remoteManifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.manifestSha256) { throw 'El manifiesto revisado cambió.' }
  $directory = Split-Path -Parent (Resolve-Path -LiteralPath $SetupManifest).Path
  $statePath = Join-Path $directory 'state.json'
  if (Test-Path -LiteralPath $statePath) { throw 'Ya hay estado para este bootstrap; revisar antes de repetir.' }
  function Write-CiState([string]$stage,[string]$detail='') {
    @{stage=$stage; detail=$detail; updatedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8NoBOM
  }
  $remote = '/home/mozzi/tomasini-ci-bootstrap-' + $manifest.manifestSha256.Substring(0,16)
  $sshOptions = @('-i',(Join-Path $env:USERPROFILE '.ssh\github_actions_mozzi_prod'),'-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3')
  Write-CiState 'preparing'
  & ssh @sshOptions -o BatchMode=yes mozzi@72.60.50.213 "mkdir -m 700 '$remote'"
  if ($LASTEXITCODE -ne 0) { throw 'No se creó una carpeta remota nueva; no se reutiliza.' }
  foreach ($property in $manifest.sources.PSObject.Properties) {
    & scp @sshOptions -o BatchMode=yes -- $property.Value ("mozzi@72.60.50.213:" + $remote + '/' + $property.Name)
    if ($LASTEXITCODE -ne 0) { throw 'Falló la transferencia de un helper o clave pública.' }
  }
  & scp @sshOptions -o BatchMode=yes -- $manifest.remoteManifest ("mozzi@72.60.50.213:" + $remote + '/setup.json')
  if ($LASTEXITCODE -ne 0) { throw 'Falló la transferencia del manifiesto.' }
  $command = @'
cd '__DIR__' || exit 1
printf '%s  setup_ci.py\n' '__SETUP__' | sha256sum -c --status || exit 1
printf '%s  setup.json\n' '__MANIFEST__' | sha256sum -c --status || exit 1
exec sudo -k python3 -I setup_ci.py --manifest setup.json
'@
  $command = $command.Replace('__DIR__',$remote).Replace('__SETUP__',$manifest.files.'setup_ci.py').Replace('__MANIFEST__',$manifest.manifestSha256)
  Write-Host 'Se configurará un acceso exclusivo para GitHub Actions y se probará el build aislado, sin activar otro release ni modificar datos.'
  Write-Host 'Ingresá sudo en esta terminal. La clave privada CI permanece local y no se sube a la VPS.'
  Write-CiState 'awaiting_sudo_or_configuring'
  & ssh @sshOptions -t mozzi@72.60.50.213 $command
  $result = $LASTEXITCODE
  & scp @sshOptions -o BatchMode=yes -- ("mozzi@72.60.50.213:" + $remote + '/ci-build-diagnostic.json') (Join-Path $directory 'ci-build-diagnostic.json') 2>$null
  $diagnosticDownloaded = $LASTEXITCODE -eq 0
  if ($result -ne 0) { throw ('El bootstrap se detuvo; no repetir. Diagnóstico descargado: ' + $diagnosticDownloaded) }
  Write-CiState 'downloading_public_receipt'
  $receiptPath = Join-Path $directory 'ci-public-receipt.json'
  & scp @sshOptions -o BatchMode=yes -- ("mozzi@72.60.50.213:" + $remote + '/ci-public-receipt.json') $receiptPath
  if ($LASTEXITCODE -ne 0) { throw 'Configuración terminada; queda descargar su recibo público. No repetir bootstrap.' }
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  if ($receipt.status -ne 'ci_access_configured' -or $receipt.expectedRelease -ne $manifest.expectedRelease -or -not $receipt.verification.fullBuildProbePassed -or -not $receipt.verification.existingApplicationsPreserved -or -not $receipt.verification.applicationNotRestarted) { throw 'El recibo no confirma las verificaciones requeridas.' }
  Write-CiState 'ci_configured_build_probe_verified'
  Write-Host 'Acceso CI exclusivo configurado y preparación Linux completa verificada. Aplicaciones existentes sin reinicios.' -ForegroundColor Green
} catch {
  if ($statePath) { Write-CiState 'needs_review' $_.Exception.Message }
  Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
  [void](Read-Host 'Presioná Enter para cerrar esta terminal')
}
