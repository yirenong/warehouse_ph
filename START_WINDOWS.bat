@echo off
setlocal
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :error
)
echo Starting FlowDepot at http://127.0.0.1:5180
echo Driver app: http://127.0.0.1:5180/driver/login
call npm run dev
exit /b 0
:error
echo.
echo Setup failed. Check the message above.
pause
exit /b 1
