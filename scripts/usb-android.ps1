<#
  Prepara el modo cable en Android.

  Hace dos cosas:
    1) adb reverse: el telefono alcanza el servidor local de la PC a traves de
       su propio localhost, que si cuenta como origen seguro para la camara.
    2) Comprueba si el anclaje por USB esta activo, que es lo que hace que el
       VIDEO viaje por el cable.

  Uso:  .\scripts\usb-android.ps1 [-Port 8888]

  Requiere adb (Android platform-tools) y Depuracion USB activada en el telefono.
#>

param([int]$Port = 8888)

$ErrorActionPreference = 'Stop'

function Write-Step($text) { Write-Host "`n  $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "  OK    $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  AVISO $text" -ForegroundColor Yellow }
function Write-Bad($text)  { Write-Host "  ERROR $text" -ForegroundColor Red }

# --- 1. adb disponible -------------------------------------------------------
Write-Step 'Buscando adb...'
$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb) {
    Write-Bad 'adb no esta en el PATH.'
    Write-Host @"
  Instalalo con una de estas:
      winget install Google.PlatformTools
      choco install adb
  O descarga platform-tools de https://developer.android.com/tools/releases/platform-tools
"@
    exit 1
}
Write-Ok "adb en $adb"

# --- 2. dispositivo conectado ------------------------------------------------
Write-Step 'Buscando el telefono...'
$devices = @(& adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\S' })
$ready = @($devices | Where-Object { $_ -match "`tdevice$" })

if ($ready.Count -eq 0) {
    Write-Bad 'Ningun dispositivo listo.'
    if ($devices | Where-Object { $_ -match 'unauthorized' }) {
        Write-Host '  El telefono dice "unauthorized": acepta el dialogo de depuracion USB en la pantalla.'
    } else {
        Write-Host '  Revisa: cable conectado, Depuracion USB activada en Opciones de desarrollador.'
    }
    exit 1
}
if ($ready.Count -gt 1) {
    Write-Warn "Hay $($ready.Count) dispositivos; adb usara el primero o fallara. Desconecta los demas si da error."
}
Write-Ok ($ready[0] -replace "`t", ' -> ')

# --- 3. adb reverse ----------------------------------------------------------
Write-Step "Redirigiendo el puerto $Port por el cable..."
& adb reverse --remove-all 2>$null | Out-Null
& adb reverse "tcp:$Port" "tcp:$Port" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Bad "adb reverse fallo (codigo $LASTEXITCODE)"; exit 1 }
Write-Ok "El telefono puede abrir http://localhost:$Port"

# --- 4. anclaje por USB ------------------------------------------------------
Write-Step 'Comprobando el anclaje por USB (es lo que lleva el video por el cable)...'
$rndis = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
         Where-Object { $_.IPAddress -match '^192\.168\.4[23]\.' -or $_.IPAddress -match '^172\.20\.10\.' }

if ($rndis) {
    foreach ($ip in $rndis) { Write-Ok "Enlace por cable detectado: $($ip.IPAddress) en '$($ip.InterfaceAlias)'" }
} else {
    Write-Warn 'No veo un enlace de anclaje por USB.'
    Write-Host '  Activalo en el telefono: Ajustes > Conexiones > Zona Wi-Fi y anclaje > Anclaje por USB.'
    Write-Host '  Sin esto el video ira por el Wi-Fi, no por el cable.'
}

# --- 5. resumen --------------------------------------------------------------
Write-Host @"

  Listo. Ahora:

    1) En esta PC, si no lo tienes ya corriendo:   npm run local
    2) En la PC abre:                              http://localhost:$Port/pc.html
    3) En el telefono abre:                        http://localhost:$Port/phone.html
    4) Teclea el codigo de sala que muestra la PC y pulsa Transmitir.

  En el panel de estado veras la ruta elegida. Si dice 'cable USB', va por el cable.

"@ -ForegroundColor Gray
