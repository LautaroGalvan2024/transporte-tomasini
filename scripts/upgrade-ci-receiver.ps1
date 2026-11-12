[CmdletBinding()]
param(
  [switch]$Interactive,
  [ValidatePattern('^[a-f0-9]{16}$')][string]$Attempt
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$names = @('upgrade_ci_receiver.py','ci_deploy.py','ci_migrations.py')
if (!$Interactive) {
  $Attempt = [guid]::NewGuid().ToString('N').Substring(0,16)
}
if (!$Attempt) { throw 'Falta la identidad del intento.' }
$directory = Join-Path $root ('.local\ci\receiver-' + $Attempt)
$manifest = Join-Path $directory 'files.json'
$state = Join-Path $directory 'state.json'
function Write-Stage([string]$stage) {
  @{ stage=$stage; updatedAt=[DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $state -Encoding utf8NoBOM
}
if (!$Interactive) {
  New-Item -ItemType Directory -Path $directory | Out-Null
  $hashes = @{}
  foreach ($name in $names) {
    $hashes[$name] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root ('infra\' + $name))).Hash.ToLowerInvariant()
  }
  $hashes | ConvertTo-Json | Set-Content -LiteralPath $manifest -Encoding utf8NoBOM
  Write-Stage 'prepared'
  $scriptLiteral = "'" + $PSCommandPath.Replace("'","''") + "'"
  $command = "& $scriptLiteral -Interactive -Attempt '$Attempt'"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $process = Start-Process -FilePath (Get-Command pwsh).Source -WindowStyle Normal -ArgumentList @('-NoProfile','-EncodedCommand',$encoded) -PassThru
  Write-Output ('Terminal de configuración de GitHub para Tomasini abierta. Estado: ' + $state + ' (PID ' + $process.Id + ')')
  return
}

try {
  $Host.UI.RawUI.WindowTitle = 'Transporte Tomasini · Habilitar despliegues automáticos'
  if ((Get-Content -Raw -LiteralPath $state | ConvertFrom-Json).stage -ne 'prepared') { throw 'Este intento ya tiene estado. Revisalo antes de continuar.' }
  $hashes = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json -AsHashtable
  if ($hashes.Count -ne $names.Count) { throw 'Manifiesto de archivos inválido.' }
  foreach ($name in $names) {
    if ($hashes[$name] -notmatch '^[a-f0-9]{64}$' -or
        (Get-FileHash -LiteralPath (Join-Path $root ('infra\' + $name)) -Algorithm SHA256).Hash -ne $hashes[$name]) {
      throw 'Los archivos locales cambiaron después de preparar la instalación.'
    }
  }
  $target = 'mozzi@72.60.50.213'
  $sshOptions = @('-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-i',(Join-Path $env:USERPROFILE '.ssh\github_actions_mozzi_prod'))
  $remote = '/home/mozzi/tomasini-ci-upgrade-' + $Attempt
  Write-Stage 'uploading'
  & ssh @sshOptions -o BatchMode=yes $target "mkdir -m 700 '$remote'"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la carpeta remota del intento.' }
  foreach ($name in $names) {
    & scp @sshOptions -o BatchMode=yes -- (Join-Path $root ('infra\' + $name)) ("${target}:" + $remote + '/' + $name)
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo transferir un archivo de la instalación.' }
  }
  # Install only copies verified after reaching a root-owned staging directory.
  $command = @'
exec sudo -k /bin/sh -ceu '
umask 077
stage=$(/usr/bin/mktemp -d /run/tomasini-ci-upgrade.XXXXXXXX)
cd "$stage"
for name in upgrade_ci_receiver.py ci_deploy.py ci_migrations.py; do
  /usr/bin/install -m 600 "__SOURCE__/$name" "$name"
done
echo "__INSTALLER__  upgrade_ci_receiver.py" | /usr/bin/sha256sum --check --status
echo "__RECEIVER__  ci_deploy.py" | /usr/bin/sha256sum --check --status
echo "__MODULE__  ci_migrations.py" | /usr/bin/sha256sum --check --status
/usr/bin/python3 -I -B "$stage/upgrade_ci_receiver.py" --receiver-sha "__RECEIVER__" --module-sha "__MODULE__"
cd /
/usr/bin/rm -- "$stage/upgrade_ci_receiver.py" "$stage/ci_deploy.py" "$stage/ci_migrations.py"
/usr/bin/rmdir -- "$stage"
'
'@
  $command = $command.Replace('__SOURCE__',$remote).Replace('__INSTALLER__',$hashes['upgrade_ci_receiver.py']).Replace('__RECEIVER__',$hashes['ci_deploy.py']).Replace('__MODULE__',$hashes['ci_migrations.py']).Replace("`r`n","`n")
  Write-Host 'Se habilitará el receptor CI de Tomasini para las futuras migraciones automáticas desde GitHub.'
  Write-Stage 'awaiting_local_enter'
  [void](Read-Host 'Presioná Enter cuando estés listo para ingresar la contraseña de sudo de la VPS')
  Write-Stage 'awaiting_sudo_or_installing'
  & ssh @sshOptions -t $target $command
  if ($LASTEXITCODE -ne 0) { throw 'La VPS no confirmó la instalación. Revisá el resultado antes de reintentar.' }
  $check = 'cd /opt/tomasini/ops/ci && echo "' + $hashes['ci_deploy.py'] + '  ci_deploy.py" | sha256sum --check --status && echo "' + $hashes['ci_migrations.py'] + '  ci_migrations.py" | sha256sum --check --status'
  & ssh @sshOptions -o BatchMode=yes $target $check
  if ($LASTEXITCODE -ne 0) { throw 'No se confirmaron los archivos instalados por SSH.' }
  @{ status='ci_receiver_upgraded'; verifiedAt=[DateTime]::UtcNow.ToString('o'); files=$hashes } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'receipt.json') -Encoding utf8NoBOM
  Write-Stage 'verified'
  Write-Host 'Receptor de GitHub instalado y verificado.' -ForegroundColor Green
} catch {
  Write-Stage 'needs_review'
  Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
  [void](Read-Host 'Presioná Enter para cerrar')
}
