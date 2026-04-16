@echo off
echo Supabase Database Setup
echo =========================
echo.
echo To run this setup, you need a Supabase personal access token
echo or fine-grained token with database_write permission.
echo.
echo 1. Go to: https://supabase.com/dashboard/account/tokens
echo 2. Create or copy a token with database_write access
echo 3. Run this command:
echo.
echo powershell -ExecutionPolicy Bypass -File .\setup-database.ps1 -AccessToken "YOUR_SUPABASE_TOKEN"
echo.
pause
