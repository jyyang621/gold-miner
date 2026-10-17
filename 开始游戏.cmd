@echo off
setlocal
cd /d "%~dp0"
set "GAME_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  set "GAME_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
if not exist "dist\index.html" (
  echo Game files are missing. Build the project first: pnpm build
  pause
  exit /b 1
)
"%GAME_NODE%" scripts\serve.mjs --open
if errorlevel 1 pause
