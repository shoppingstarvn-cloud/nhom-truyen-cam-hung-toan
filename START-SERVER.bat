@echo off
title NHOM TRUYEN CAM HUNG TOAN - Web Server
color 1F
echo.
echo  ============================================
echo   NHOM TRUYEN CAM HUNG TOAN - Web Server
echo  ============================================
echo.

:: Kill existing node on port 3000 if any
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo  Dang khoi dong server...
cd /d D:\educational-website
node server.js

echo.
echo  Server da dung. Bam phim bat ky de thoat.
pause > nul
