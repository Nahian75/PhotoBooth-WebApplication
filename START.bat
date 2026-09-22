@echo off
setlocal enabledelayedexpansion
title PhotoBooth - Student Photo Capture
cd /d "%~dp0"

echo(
echo ===============================================
echo    PhotoBooth - Student Photo Capture
echo ===============================================
echo(

REM ---------------------------------------------------------------
REM 1. Locate Node.js (PATH first, then the standard install folder)
REM ---------------------------------------------------------------
set "NODE="
where node >nul 2>&1 && set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"

if not defined NODE (
    echo  [X] Node.js was not found on this computer.
    echo(
    echo      1. Go to   https://nodejs.org
    echo      2. Download the "LTS" installer and run it
    echo      3. Start this file again
    echo(
    pause
    exit /b 1
)

for /f "delims=" %%v in ('"%NODE%" -v 2^>nul') do set "NODEVER=%%v"
echo  [OK] Node.js !NODEVER!

REM ---------------------------------------------------------------
REM 2. Install dependencies on first run
REM ---------------------------------------------------------------
if not exist "node_modules\express\package.json" (
    echo  [..] First run - installing components, please wait...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo(
        echo  [X] Install failed. Check your internet connection and try again.
        echo(
        pause
        exit /b 1
    )
    echo  [OK] Components installed
) else (
    echo  [OK] Components ready
)

REM ---------------------------------------------------------------
REM 3. Create/refresh the HTTPS certificate BEFORE trusting it.
REM    Always run: this PC's network address may differ from the last
REM    one, and the certificate is rebuilt when the address changes.
REM ---------------------------------------------------------------
echo  [..] Checking secure certificate...
"%NODE%" server.js --certs-only >nul 2>&1

REM ---------------------------------------------------------------
REM 4. One-time setup needing admin: firewall rule (so phones can
REM    connect) and trusting the certificate (so the browser stops
REM    warning). Both are done in a single prompt.
REM ---------------------------------------------------------------
set "NEEDFIREWALL="
set "NEEDCERT="

netsh advfirewall firewall show rule name="PhotoBooth Server" >nul 2>&1
if errorlevel 1 set "NEEDFIREWALL=1"

if exist "data\certs\cert.pem" (
    for /f "delims=" %%t in ('powershell -NoProfile -Command "try{$t=(Get-PfxCertificate '%CD%\data\certs\cert.pem').Thumbprint; if(Test-Path ('Cert:\LocalMachine\Root\'+$t)){'TRUSTED'}else{'NO'}}catch{'NO'}" 2^>nul') do set "CERTSTATE=%%t"
    if not "!CERTSTATE!"=="TRUSTED" set "NEEDCERT=1"
)

if defined NEEDFIREWALL (set "DOSETUP=1") else (if defined NEEDCERT set "DOSETUP=1")

if defined DOSETUP (
    echo  [..] One-time setup - please approve the Windows prompt...
    > "%TEMP%\pb_setup.bat" echo @echo off
    if defined NEEDFIREWALL >>"%TEMP%\pb_setup.bat" echo netsh advfirewall firewall add rule name="PhotoBooth Server" dir=in action=allow protocol=TCP localport=3000
    if defined NEEDCERT >>"%TEMP%\pb_setup.bat" echo certutil -addstore -f Root "%CD%\data\certs\cert.pem"
    powershell -NoProfile -Command "Start-Process -FilePath '%TEMP%\pb_setup.bat' -Verb RunAs -Wait -WindowStyle Hidden" >nul 2>&1
    del "%TEMP%\pb_setup.bat" >nul 2>&1

    netsh advfirewall firewall show rule name="PhotoBooth Server" >nul 2>&1
    if errorlevel 1 (
        echo  [i] Firewall not set - this PC works, but phones may not connect.
    ) else (
        echo  [OK] Phones allowed through the firewall
    )
) else (
    echo  [OK] Firewall and certificate already set up
)

REM ---------------------------------------------------------------
REM 5. If it is already running, just open the dashboard
REM ---------------------------------------------------------------
netstat -ano | findstr /r /c:"TCP .*:3000 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo(
    echo  [i] PhotoBooth is already running - opening the dashboard.
    start "" "https://localhost:3000"
    ping -n 3 127.0.0.1 >nul
    exit /b 0
)

REM ---------------------------------------------------------------
REM 6. Start the server and open the dashboard
REM ---------------------------------------------------------------
echo(
echo  Starting...   (the browser opens automatically)
echo(
echo  Keep this window open. Close it to stop PhotoBooth.
echo(

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'https://localhost:3000'"

"%NODE%" server.js

echo(
echo  PhotoBooth stopped.
ping -n 4 127.0.0.1 >nul
endlocal
