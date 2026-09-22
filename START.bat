@echo off
setlocal enabledelayedexpansion
title PhotoBooth - Student Photo Capture
cd /d "%~dp0"

echo(
echo ===============================================
echo    PhotoBooth - Student Photo Capture
echo ===============================================
echo(

if not exist "PhotoBooth.exe" (
    echo  [X] PhotoBooth.exe is missing from this folder.
    echo      Copy the whole folder again and retry.
    echo(
    pause
    exit /b 1
)

REM Where photos and the student list are kept.
REM
REM  Normal mode   : Documents\PhotoBooth on whichever PC you run on.
REM  Portable mode : this folder itself - so everything travels with it
REM                  (USB stick, external drive). Turn it on by putting
REM                  a file named PORTABLE.txt next to PhotoBooth.exe.
set "STORE=%USERPROFILE%\Documents\PhotoBooth"
set "MODE=Documents\PhotoBooth on this PC"

if exist "%~dp0PORTABLE.txt" (
    set "STORE=%~dp0"
    if "!STORE:~-1!"=="\" set "STORE=!STORE:~0,-1!"
    set "PHOTOBOOTH_HOME=!STORE!"
    set "MODE=this folder (portable)"
)
echo  [OK] Photos are saved to: !MODE!

REM ---------------------------------------------------------------
REM 1. Create/refresh the security certificate for THIS computer.
REM    Always run: the certificate is tied to this PC's network
REM    address, which differs between computers and WiFi networks.
REM ---------------------------------------------------------------
echo  [..] Checking security certificate...
"%~dp0PhotoBooth.exe" --certs-only >nul 2>&1

REM ---------------------------------------------------------------
REM 2. One-time setup (single admin prompt):
REM      - firewall rule  -> phones can connect
REM      - trust the certificate -> no "not secure" warning
REM ---------------------------------------------------------------
set "NEEDFIREWALL="
set "NEEDCERT="

netsh advfirewall firewall show rule name="PhotoBooth Server" >nul 2>&1
if errorlevel 1 set "NEEDFIREWALL=1"

if exist "%STORE%\data\certs\cert.pem" (
    for /f "delims=" %%t in ('powershell -NoProfile -Command "try{$t=(Get-PfxCertificate '%STORE%\data\certs\cert.pem').Thumbprint; if(Test-Path ('Cert:\LocalMachine\Root\'+$t)){'TRUSTED'}else{'NO'}}catch{'NO'}" 2^>nul') do set "CERTSTATE=%%t"
    if not "!CERTSTATE!"=="TRUSTED" set "NEEDCERT=1"
)

if defined NEEDFIREWALL (set "DOSETUP=1") else (if defined NEEDCERT set "DOSETUP=1")

if defined DOSETUP (
    echo  [..] One-time setup - please approve the Windows prompt...
    > "%TEMP%\pb_setup.bat" echo @echo off
    if defined NEEDFIREWALL >>"%TEMP%\pb_setup.bat" echo netsh advfirewall firewall add rule name="PhotoBooth Server" dir=in action=allow protocol=TCP localport=3000
    if defined NEEDCERT >>"%TEMP%\pb_setup.bat" echo certutil -addstore -f Root "%STORE%\data\certs\cert.pem"
    powershell -NoProfile -Command "Start-Process -FilePath '%TEMP%\pb_setup.bat' -Verb RunAs -Wait -WindowStyle Hidden" >nul 2>&1
    del "%TEMP%\pb_setup.bat" >nul 2>&1

    netsh advfirewall firewall show rule name="PhotoBooth Server" >nul 2>&1
    if errorlevel 1 (
        echo  [i] Firewall not set - this PC works, but phones may not connect.
    ) else (
        echo  [OK] Ready
    )
) else (
    echo  [OK] Ready
)

REM ---------------------------------------------------------------
REM 3. Already running? Just open the dashboard.
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
REM 4. Launch
REM ---------------------------------------------------------------
echo(
echo  Starting...   (the browser opens automatically)
echo(
echo  Keep this window open. Close it to stop PhotoBooth.
echo(

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'https://localhost:3000'"

"%~dp0PhotoBooth.exe"

echo(
echo  PhotoBooth stopped.
ping -n 4 127.0.0.1 >nul
endlocal
