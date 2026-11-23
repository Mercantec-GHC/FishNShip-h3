@echo off
setlocal DisableDelayedExpansion
set "ARDUINO_CLI=arduino-cli"
if exist "%ProgramFiles%\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe" set "ARDUINO_CLI=%ProgramFiles%\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
if exist "%LOCALAPPDATA%\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe" set "ARDUINO_CLI=%LOCALAPPDATA%\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
set "ARDUINO_CONFIG=%USERPROFILE%\.arduinoIDE\arduino-cli.yaml"
set "FISHNSHIP_FQBN=arduino:mbed_portenta:envie_m7"
set "FISHNSHIP_BOARD=%FISHNSHIP_FQBN%:split=50_50,target_core=cm7,security=none"
set "UPLOAD_PORT="

if not exist "%~dp0firmware\Demo.ino.bin" goto unpack
call :arduino version >nul 2>&1
if errorlevel 1 goto no_cli
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -Command "$cfg = @(); if (Test-Path -LiteralPath $env:ARDUINO_CONFIG) { $cfg = @('--config-file', $env:ARDUINO_CONFIG) }; $json = (& $env:ARDUINO_CLI @cfg board list --json | Out-String) | ConvertFrom-Json; $ports = @($json.detected_ports | Where-Object { $_.port.protocol -eq 'serial' -and $_.port.address -match '^COM[0-9]+$' -and $_.matching_boards.fqbn -contains $env:FISHNSHIP_FQBN } | ForEach-Object { $_.port.address } | Select-Object -Unique); if ($ports.Count -eq 1) { $ports[0] }"`) do set "UPLOAD_PORT=%%P"
if not defined UPLOAD_PORT goto no_port

echo Portenta H7 fundet paa %UPLOAD_PORT%.
if /i "%~1"=="/check" exit /b 0
echo Stop maskinen foer upload.
echo Luk Serial Monitor i Arduino IDE og afbryd browserens USB-overvaagning.
choice /C JN /N /M "Upload den byggede firmware til %UPLOAD_PORT%? [J/N] "
if errorlevel 2 exit /b 0
if not errorlevel 1 exit /b 1
call :arduino upload --fqbn "%FISHNSHIP_BOARD%" --port "%UPLOAD_PORT%" --input-dir "%~dp0firmware" "%~dp0Demo"
if errorlevel 1 goto failed
echo Upload faerdig. Forbind Arduino igen i FishNShip.
pause
exit /b 0

:arduino
if exist "%ARDUINO_CONFIG%" (
    "%ARDUINO_CLI%" --config-file "%ARDUINO_CONFIG%" %*
) else (
    "%ARDUINO_CLI%" %*
)
exit /b %errorlevel%

:unpack
echo Pak hele ZIP-filen ud, foer du koerer Upload.cmd.
goto failed

:no_cli
echo Arduino CLI blev ikke fundet. Installer Arduino IDE eller tilfoej Arduino CLI til PATH.
goto failed

:no_port
echo Tilslut praecis en Portenta H7 via USB i normal driftstilstand.

:failed
echo Upload blev ikke gennemfoert.
pause
exit /b 1
