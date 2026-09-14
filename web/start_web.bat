@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Scripts Box Browser

cd /d "%~dp0"

set "PYTHON="
if exist "..\.venv\Scripts\python.exe" (
    set "PYTHON=..\.venv\Scripts\python.exe"
) else (
    where python >nul 2>nul
    if !errorlevel! equ 0 set "PYTHON=python"
)
if not defined PYTHON (
    where py >nul 2>nul
    if !errorlevel! equ 0 set "PYTHON=py"
)

if not defined PYTHON (
    echo [ERROR] Python not found. Please install Python first.
    echo Download: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Scripts Box Cloud Browser
echo ============================================
echo URL: http://127.0.0.1:8765/
echo Close this window to stop the server.
echo ============================================
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 800; Start-Process 'http://127.0.0.1:8765/'"

"%PYTHON%" -m http.server 8765 --bind 127.0.0.1

pause
