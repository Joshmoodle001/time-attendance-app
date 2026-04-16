# Direct Supabase SQL Setup
# This script validates access using environment variables and prints the SQL you need to run.

param(
    [string]$SupabaseUrl = $env:SUPABASE_URL,
    [string]$SupabaseAnonKey = $env:SUPABASE_ANON_KEY,
    [string]$ProjectRef = $env:SUPABASE_PROJECT_REF
)

$ErrorActionPreference = "Stop"

function Write-SetupHelp {
    Write-Host ""
    Write-Host "Set these environment variables before running this script:" -ForegroundColor Yellow
    Write-Host "  SUPABASE_URL"
    Write-Host "  SUPABASE_ANON_KEY"
    Write-Host "  SUPABASE_PROJECT_REF (optional, derived from SUPABASE_URL when possible)"
    Write-Host ""
    Write-Host "PowerShell example:" -ForegroundColor Cyan
    Write-Host '  $env:SUPABASE_URL = "https://your-project-ref.supabase.co"'
    Write-Host '  $env:SUPABASE_ANON_KEY = "your-anon-key"'
    Write-Host '  $env:SUPABASE_PROJECT_REF = "your-project-ref"'
    Write-Host ""
}

if (-not $SupabaseUrl -or -not $SupabaseAnonKey) {
    Write-Host "Supabase credentials were not found in the environment." -ForegroundColor Red
    Write-SetupHelp
    exit 1
}

if (-not $ProjectRef -and $SupabaseUrl -match "https://([^.]+)\.supabase\.co") {
    $ProjectRef = $Matches[1]
}

$setupSqlPath = Join-Path $PSScriptRoot "supabase-setup.sql"

Write-Host "====================================="
Write-Host "Supabase Attendance Database Setup"
Write-Host "====================================="
Write-Host ""

Write-Host "Testing connection..."
$testUri = "$SupabaseUrl/rest/v1/?apikey=$SupabaseAnonKey"

try {
    $response = Invoke-WebRequest -Uri $testUri -Method GET -TimeoutSec 10
    Write-Host "Connection OK: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "Connection failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "====================================="
Write-Host "MANUAL SETUP REQUIRED"
Write-Host "====================================="
Write-Host ""

if ($ProjectRef) {
    Write-Host "1. Go to: https://supabase.com/dashboard/project/$ProjectRef/sql/new"
} else {
    Write-Host "1. Open the SQL editor for your Supabase project."
}
Write-Host ""

if (Test-Path $setupSqlPath) {
    Write-Host "2. Paste and run the SQL from supabase-setup.sql:"
    Write-Host ""
    Get-Content $setupSqlPath -Raw | Write-Host
} else {
    Write-Host "2. supabase-setup.sql was not found next to this script." -ForegroundColor Yellow
    Write-Host "   Open the repository root and run the SQL from supabase-setup.sql manually."
}
Write-Host ""
Write-Host "3. After running the SQL, refresh the app."
Write-Host ""

Write-Host "Verifying setup..."
Start-Sleep -Seconds 1

$verifyUri = "$SupabaseUrl/rest/v1/attendance_upload_sessions?apikey=$SupabaseAnonKey"
try {
    $verify = Invoke-WebRequest -Uri $verifyUri -Method GET -TimeoutSec 10
    Write-Host "SUCCESS: Tables are accessible!" -ForegroundColor Green
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Write-Host "Status: $status - Tables may not be created yet" -ForegroundColor Yellow
}
