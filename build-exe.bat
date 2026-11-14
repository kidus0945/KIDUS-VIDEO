@echo off
title Build Kidus Studio Windows EXE
echo ============================================
echo   Kidus Studio - Windows EXE Builder
echo ============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js 22+ is required. Download from https://nodejs.org/
  pause
  exit /b 1
)

if not exist ".env" (
  echo Creating .env from .env.example...
  copy .env.example .env >nul
  echo Please edit .env and paste your GEMINI_API_KEY before running Kidus Studio.exe!
)

echo [1/4] Installing app dependencies...
call npm install
if %errorlevel% neq 0 goto :error

echo [2/4] Installing Electron packager...
call npm install --no-save electron electron-builder
if %errorlevel% neq 0 goto :error

echo [3/4] Building web assets...
call npm run build
if %errorlevel% neq 0 goto :error

echo [4/4] Packaging Kidus Studio.exe...
call npx electron-builder --config electron-builder.json --win portable
if %errorlevel% neq 0 goto :error

echo.
echo Done! Your Windows app is ready at: dist-exe\Kidus Studio.exe
echo Make sure your .env file with GEMINI_API_KEY is in the same folder as Kidus Studio.exe.
pause
exit /b 0

:error
echo.
echo Build failed. Check the messages above.
pause
exit /b 1
