@echo off
title Agency OS
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install
)

rem Contrasena de aplicacion del correo, para que el sistema mande solo.
rem No se guarda en el vault a proposito. Quita el "rem" y pon la tuya:
rem set AGENCY_SMTP_PASS=abcd efgh ijkl mnop

start "" http://localhost:4180
node server.js
pause
