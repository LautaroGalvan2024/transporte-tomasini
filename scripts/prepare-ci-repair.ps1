[CmdletBinding()]
param([string]$PublicKeyPath = '.local/ci/tomasini-ci-ed25519.pub')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$previous = Join-Path $root '.local\ci\setup-20261102T165809601Z\setup.json'
if ((Get-FileHash -LiteralPath $previous -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'd2fb207d5d6eb240436dffee5b68cdb9022bab68a0b5adc786849f56fdc51f63') { throw 'No coincide el manifiesto del intento original.' }
$keyPath = (Resolve-Path -LiteralPath $PublicKeyPath).Path
$publicKey = Get-Content -LiteralPath $keyPath -Raw
if (-not $keyPath.EndsWith('.pub') -or $publicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]*)?\r?\n?$') { throw 'Solo se admite la clave pública Ed25519 revisada.' }
$files, $sources = [ordered]@{}, [ordered]@{}
foreach ($name in @('repair_ci_bootstrap.py','setup_ci.py','ci_deploy.py','ci_migrations.py','install_vps.py','update_vps.py')) {
  $path = Join-Path $root ('infra\' + $name)
  $files[$name] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  $sources[$name] = $path
}
$files['ci.pub'] = (Get-FileHash -LiteralPath $keyPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sources['ci.pub'] = $keyPath
$files['previous-setup.json'] = (Get-FileHash -LiteralPath $previous -Algorithm SHA256).Hash.ToLowerInvariant()
$sources['previous-setup.json'] = $previous
$directory = Join-Path $root ('.local\ci\repair-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
New-Item -ItemType Directory -Path $directory | Out-Null
$identity = (& whoami.exe).Trim()
& icacls.exe $directory /inheritance:r /grant:r ($identity + ':(OI)(CI)F') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo proteger la carpeta local.' }
$expected = '1bce449e4b5e8c4a9b46ecedee9c37066b23e6ee2d3041ac7319acd82f949080'
$setupFiles = [ordered]@{}
foreach ($name in @('setup_ci.py','ci_deploy.py','ci_migrations.py','install_vps.py','update_vps.py','ci.pub')) { $setupFiles[$name] = $files[$name] }
$setupPath = Join-Path $directory 'setup.json'
@{version=1; expectedRelease=$expected; files=$setupFiles} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $setupPath -Encoding utf8NoBOM
$files['setup.json'] = (Get-FileHash -LiteralPath $setupPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sources['setup.json'] = $setupPath
$repairPath = Join-Path $directory 'repair.json'
@{version=1; expectedRelease=$expected; files=$files} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $repairPath -Encoding utf8NoBOM
$launcher = Join-Path $directory 'launcher.json'
@{mode='repair-before-access'; expectedRelease=$expected; sources=$sources; files=$files; remoteManifest=$repairPath; manifestSha256=(Get-FileHash -LiteralPath $repairPath -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $launcher -Encoding utf8NoBOM
Write-Host $launcher
