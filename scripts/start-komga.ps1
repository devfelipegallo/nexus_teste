$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$komgaExe = Join-Path $projectRoot 'komga\runtime\bin\Komga.exe'
$libraryDir = Join-Path $projectRoot 'komga\library'

if (-not (Test-Path -LiteralPath $komgaExe)) {
  Write-Error 'O Komga portátil não foi encontrado em komga\runtime. Consulte docs\KOMGA.md.'
}

New-Item -ItemType Directory -Force -Path $libraryDir | Out-Null
$running = Get-Process -Name 'Komga' -ErrorAction SilentlyContinue
if ($running) {
  Write-Output 'O Komga já está em execução em http://localhost:25600'
  exit 0
}

Start-Process -FilePath $komgaExe -WorkingDirectory (Split-Path $komgaExe) -WindowStyle Hidden
Write-Output 'Komga iniciado. Abra http://localhost:25600 para concluir a configuração.'
Write-Output "Pasta sugerida para a biblioteca: $libraryDir"
