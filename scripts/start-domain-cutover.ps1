[CmdletBinding()]
param(
  [switch]$Rollback,
  [switch]$InCurrentTerminal,
  [ValidatePattern('^[0-9a-f]{16}$')][string]$Attempt
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$names = @('domain_cutover.py','install_vps.py')
$target = 'mozzi@72.60.50.213'
$sshOptions = @('-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=10',
  '-o','ServerAliveInterval=15','-i',(Join-Path $env:USERPROFILE '.ssh\github_actions_mozzi_prod'))
function Assert-Exit([string]$message) {
  if ($LASTEXITCODE -ne 0) { throw $message }
}
if (!$Attempt) {
  if (!$Rollback) {
    foreach ($domain in @('transporte-tomasini.com','www.transporte-tomasini.com','transporte-tomasini-api.com','www.transporte-tomasini-api.com')) {
      $addresses = @([System.Net.Dns]::GetHostAddresses($domain) | ForEach-Object { $_.ToString() } | Sort-Object -Unique)
      if ($addresses.Count -ne 1 -or $addresses[0] -ne '72.60.50.213') { throw "$domain todavía no apunta exclusivamente a la VPS." }
    }
  }
  $Attempt = [guid]::NewGuid().ToString('N').Substring(0,16)
  $directory = Join-Path $root ('.local\domain-cutover\' + $Attempt)
  New-Item -ItemType Directory -Path $directory | Out-Null
  $hashes = @{}
  foreach ($name in $names) {
    $hashes[$name] = (Get-FileHash -LiteralPath (Join-Path $root ('infra\' + $name))).Hash.ToLowerInvariant()
  }
  @{ files=$hashes; rollback=$Rollback.IsPresent } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'manifest.json') -Encoding utf8NoBOM
  if (!$InCurrentTerminal) {
    $scriptLiteral = "'" + $PSCommandPath.Replace("'","''") + "'"
    $command = "& $scriptLiteral -InCurrentTerminal -Attempt '$Attempt'"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Start-Process -FilePath (Get-Command pwsh).Source -WindowStyle Normal -ArgumentList @('-NoProfile','-EncodedCommand',$encoded)
    Write-Output ("Terminal de dominios Tomasini abierta. Estado: " + (Join-Path $directory 'state.json'))
    return
  }
}
$directory = Join-Path $root ('.local\domain-cutover\' + $Attempt)
$state = Join-Path $directory 'state.json'
function Set-Stage([string]$stage) {
  @{ stage=$stage; updatedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding utf8NoBOM
}
try {
  if (Test-Path -LiteralPath $state) { throw 'El intento ya tiene un estado registrado.' }
  $manifest = Get-Content -Raw -LiteralPath (Join-Path $directory 'manifest.json') | ConvertFrom-Json -AsHashtable
  $hashes = $manifest.files
  foreach ($name in $names) {
    $file = Join-Path $root ('infra\' + $name)
    if ($hashes[$name] -notmatch '^[0-9a-f]{64}$' -or (Get-FileHash -LiteralPath $file).Hash -ne $hashes[$name]) { throw 'Los archivos revisados cambiaron.' }
  }
  $remote = '/home/mozzi/tomasini-domains-' + $Attempt
  Set-Stage 'uploading'
  & ssh @sshOptions -o BatchMode=yes $target "mkdir -m 700 '$remote'"
  Assert-Exit 'No se pudo preparar la transferencia SSH.'
  foreach ($name in $names) {
    & scp @sshOptions -o BatchMode=yes -- (Join-Path $root ('infra\' + $name)) ("${target}:" + $remote + '/' + $name)
    Assert-Exit 'No se pudo transferir el archivo operativo.'
  }
  $command = @'
exec sudo /bin/sh -ceu '
umask 077
stage=$(/usr/bin/mktemp -d /run/tomasini-domain.XXXXXXXX)
cd "$stage"
for name in domain_cutover.py install_vps.py; do /usr/bin/install -m 600 "__SOURCE__/$name" "$name"; done
echo "__SCRIPT__  domain_cutover.py" | /usr/bin/sha256sum --check --status
echo "__CORE__  install_vps.py" | /usr/bin/sha256sum --check --status
status=0
/usr/bin/python3 -I -B "$stage/domain_cutover.py" --core-sha "__CORE__" __ACTION__ > "$stage/result.txt" 2>&1 || status=$?
/usr/bin/cat "$stage/result.txt"
# The helper emits only its controlled result. SSH, sudo and terminal input are never recorded.
/usr/sbin/runuser -u mozzi -- /usr/bin/tee "__SOURCE__/result.txt" < "$stage/result.txt" > /dev/null
test "$status" -eq 0 || exit "$status"
cd /
/usr/bin/rm -- "$stage/domain_cutover.py" "$stage/install_vps.py" "$stage/result.txt"
/usr/bin/rmdir -- "$stage"
'
'@
  $action = if ($manifest.rollback) { '--rollback' } else { '' }
  $command = $command.Replace('__SOURCE__',$remote).Replace('__SCRIPT__',$hashes['domain_cutover.py']).Replace('__CORE__',$hashes['install_vps.py']).Replace('__ACTION__',$action).Replace("`r`n","`n")
  Set-Stage 'awaiting_sudo_or_installing'
  Write-Host 'Ingresá la contraseña de sudo en la terminal SSH si la VPS la solicita.'
  & ssh @sshOptions -t $target $command
  $installExit = $LASTEXITCODE
  & scp @sshOptions -o BatchMode=yes -- ("${target}:" + $remote + '/result.txt') (Join-Path $directory 'result.txt')
  if ($installExit -ne 0) { throw 'La VPS detuvo la operación. Si llegó al configurador, el resultado está en result.txt.' }
  Assert-Exit 'La VPS confirmó la operación pero no se pudo descargar el resultado.'
  Set-Stage 'verified'
  Write-Host 'Operación de dominios verificada.' -ForegroundColor Green
} catch {
  Set-Stage 'needs_review'
  Write-Error $_.Exception.Message
}
