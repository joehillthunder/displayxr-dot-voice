@echo off
rem One-command setup: installs dependencies, creates .env with fresh secrets, starts the bridge
rem and the MCP server in their own windows, and opens the display.
rem   setup-windows.bat          bridge + MCP server + display
rem   setup-windows.bat voice    also start the Realtime voice fallback (needs OPENAI_API_KEY)
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install it with:
  echo   winget install OpenJS.NodeJS.LTS
  echo then open a new terminal and run this script again.
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 24 or newer is required; found:
  node --version
  exit /b 1
)

echo Installing dependencies...
call npm install --no-fund --no-audit || exit /b 1
node tools\init-env.ts || exit /b 1

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if "%%A"=="BRIDGE_SECRET" set "BRIDGE_SECRET=%%B"
  if "%%A"=="BRIDGE_PORT" set "BRIDGE_PORT=%%B"
)
if "%BRIDGE_PORT%"=="" set "BRIDGE_PORT=8787"

start "DisplayXR bridge" cmd /k node bridge\server.ts
timeout /t 2 /nobreak >nul
start "DisplayXR MCP server" cmd /k node mcp-server\server.ts
if /i "%~1"=="voice" start "DisplayXR voice" cmd /k node voice-fallback\server.ts

timeout /t 2 /nobreak >nul
echo.
echo Display: http://localhost:%BRIDGE_PORT%/display/
echo   For glasses-free 3D, open that page in the DisplayXR Browser. The link below carries the
echo   bridge secret in the #fragment, which never leaves this machine.
start "" "http://localhost:%BRIDGE_PORT%/display/#secret=%BRIDGE_SECRET%"
echo.
echo Try it with no OpenAI account:   npm run mock -- demo
if /i "%~1"=="voice" echo Voice fallback:                  http://localhost:8791/
echo Connect a dot or another agent:  see docs\connect-dots.md
endlocal
