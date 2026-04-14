# Deploy script for Time Attendance App

# Prerequisites check
Write-Host "=== Time Attendance App Deploy Script ===" -ForegroundColor Cyan

# Check if Node.js is installed
try {
    $nodeVersion = node --version
    Write-Host "[OK] Node.js version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js not installed. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Check if npm packages are installed
if (Test-Path "node_modules") {
    Write-Host "[OK] node_modules exists" -ForegroundColor Green
} else {
    Write-Host "[INFO] Installing npm packages..." -ForegroundColor Yellow
    npm install
}

# Check for required env vars
$envExample = Get-Content ".env.example" -Raw
if ($envExample -match "VITE_SUPABASE_URL") {
    if (-not (Test-Path ".env.local")) {
        Write-Host "[WARNING] .env.local not found. Copy .env.example to .env.local and fill in values" -ForegroundColor Yellow
    }
}

Write-Host "`n=== Setup Complete ===" -ForegroundColor Cyan
Write-Host "Next steps:" -ForegroundColor White
Write-Host "1. Create Supabase project at https://supabase.com" -ForegroundColor White
Write-Host "2. Copy .env.example to .env.local and add your Supabase credentials" -ForegroundColor White
Write-Host "3. Push database schema: npx supabase db push" -ForegroundColor White
Write-Host "4. Push code to GitHub and connect to Vercel" -ForegroundColor White

# Build test
Write-Host "`n=== Testing Production Build ===" -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Build successful!" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Build failed. Check errors above." -ForegroundColor Red
    exit 1
}