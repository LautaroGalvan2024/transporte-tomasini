[CmdletBinding()]
param(
  [string]$PublicKeyPath = '.local/ci/tomasini-ci-ed25519.pub',
  [string]$ExpectedRelease = '1bce449e4b5e8c4a9b46ecedee9c37066b23e6ee2d3041ac7319acd82f949080'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($ExpectedRelease -notmatch '^[a-f0-9]{64}$') { throw 'Versión esperada inválida.' }
$keyPath = (Resolve-Path -LiteralPath $PublicKeyPath).Path
if (-not $keyPath.EndsWith('.pub')) { throw 'Este flujo recibe exclusivamente la clave pública .pub.' }
$publicKey = Get-Content -LiteralPath $keyPath -Raw
if ($publicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]*)?\r?\n?$') { throw 'El archivo no contiene una clave pública Ed25519 válida; no se transfiere.' }
$files = [ordered]@{}
$sources = [ordered]@{}
foreach ($name in @('setup_ci.py','ci_deploy.py','ci_migrations.py','install_vps.py','update_vps.py')) {
  $path = Join-Path $root ('infra\' + $name)
  $files[$name] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  $sources[$name] = $path
}
$files['ci.pub'] = (Get-FileHash -LiteralPath $keyPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sources['ci.pub'] = $keyPath
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$directory = Join-Path $root ('.local\ci\setup-' + $stamp)
New-Item -ItemType Directory -Path $directory | Out-Null
$identity = (& whoami.exe).Trim()
& icacls.exe $directory /inheritance:r /grant:r ($identity + ':(OI)(CI)F') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo restringir la carpeta local.' }
$remoteManifest = Join-Path $directory 'setup.json'
@{version=1; expectedRelease=$ExpectedRelease; files=$files} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $remoteManifest -Encoding utf8NoBOM
$manifestPath = Join-Path $directory 'launcher.json'
@{expectedRelease=$ExpectedRelease; sources=$sources; files=$files; remoteManifest=$remoteManifest; manifestSha256=(Get-FileHash -LiteralPath $remoteManifest -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
Write-Host $manifestPath
