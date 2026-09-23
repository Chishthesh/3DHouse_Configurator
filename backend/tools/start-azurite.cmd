@echo off
REM ---------------------------------------------------------------------------
REM Starts the local Blob/Queue emulator and applies the CORS rules the browser
REM needs to upload and read directly.
REM
REM Azurite does not survive a reboot, and when it is not running the app can
REM only report that storage is unreachable — every model fails to open. Run this
REM after starting the machine, before the API.
REM
REM Stored data lives in backend\.azurite and is kept between runs, so uploads,
REM captures and rendered layers all survive a restart.
REM ---------------------------------------------------------------------------

setlocal
set "ROOT=%~dp0.."
set "DATA=%ROOT%\.azurite"

REM Visual Studio 2022 ships Azurite, so there is normally nothing to install.
set "AZURITE=C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\Extensions\Microsoft\Azure Storage Emulator\azurite.exe"
if not exist "%AZURITE%" set "AZURITE=C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\Extensions\Microsoft\Azure Storage Emulator\azurite.exe"
if not exist "%AZURITE%" set "AZURITE=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\Extensions\Microsoft\Azure Storage Emulator\azurite.exe"

if not exist "%AZURITE%" (
  echo Could not find azurite.exe in the Visual Studio 2022 install.
  echo Install it with:  npm install -g azurite
  echo Then run:         azurite --silent --location "%DATA%" --blobHost 127.0.0.1 --blobPort 10000 --queueHost 127.0.0.1 --queuePort 10001
  exit /b 1
)

if not exist "%DATA%" mkdir "%DATA%"

REM Already listening? Then only the CORS rules need confirming.
netstat -ano | findstr /r /c:"TCP.*127.0.0.1:10000.*LISTENING" >nul
if %errorlevel%==0 (
  echo Azurite is already running on 127.0.0.1:10000.
) else (
  echo Starting Azurite, data in %DATA%
  start "" /b "%AZURITE%" --silent --location "%DATA%" --blobHost 127.0.0.1 --blobPort 10000 --queueHost 127.0.0.1 --queuePort 10001
  timeout /t 5 /nobreak >nul
)

REM Safe to repeat: applying the same rules again simply overwrites them.
echo Applying CORS rules...
node "%~dp0azurite-setup.mjs"

echo.
echo Azurite ready. Start the API next.
endlocal
