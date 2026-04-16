# Supabase schema setup via the Management API.
# Requires a personal access token or fine-grained token with database_write.

[CmdletBinding()]
param(
    [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN,
    [string]$ProjectRef,
    [string]$SqlFile = ".\supabase-setup.sql"
)

$ErrorActionPreference = "Stop"

function Get-ProjectRefFromEnv {
    $envFile = ".env.local"
    if (-not (Test-Path $envFile)) {
        return $null
    }

    $urlLine = Get-Content $envFile | Select-String -Pattern '^VITE_SUPABASE_URL=' | Select-Object -First 1
    if (-not $urlLine) {
        return $null
    }

    $url = ($urlLine.Line -replace '^VITE_SUPABASE_URL=', '').Trim()
    if (-not $url) {
        return $null
    }

    try {
        return ([Uri]$url).Host.Split('.')[0]
    } catch {
        return $null
    }
}

function Get-AnonConfigFromEnv {
    $envFile = ".env.local"
    if (-not (Test-Path $envFile)) {
        return $null
    }

    $content = Get-Content $envFile
    $urlLine = $content | Select-String -Pattern '^VITE_SUPABASE_URL=' | Select-Object -First 1
    $keyLine = $content | Select-String -Pattern '^VITE_SUPABASE_ANON_KEY=' | Select-Object -First 1
    if (-not $urlLine -or -not $keyLine) {
        return $null
    }

    return @{
        Url = ($urlLine.Line -replace '^VITE_SUPABASE_URL=', '').Trim()
        Key = ($keyLine.Line -replace '^VITE_SUPABASE_ANON_KEY=', '').Trim()
    }
}

if (-not $ProjectRef) {
    $ProjectRef = Get-ProjectRefFromEnv
}

if (-not $AccessToken) {
    throw "Missing AccessToken. Pass -AccessToken or set SUPABASE_ACCESS_TOKEN."
}

if (-not $ProjectRef) {
    throw "Missing ProjectRef. Pass -ProjectRef or add VITE_SUPABASE_URL to .env.local."
}

if (-not (Test-Path $SqlFile)) {
    throw "SQL file not found: $SqlFile"
}

$sql = Get-Content $SqlFile -Raw
$headers = @{
    "Authorization" = "Bearer $AccessToken"
    "Content-Type" = "application/json"
}
$body = @{
    query = $sql
} | ConvertTo-Json -Depth 4

Write-Host "Running SQL from $SqlFile against project $ProjectRef..."
Invoke-RestMethod `
    -Uri "https://api.supabase.com/v1/projects/$ProjectRef/database/query" `
    -Headers $headers `
    -Method POST `
    -Body $body `
    -TimeoutSec 60 | Out-Null

Write-Host "Schema update submitted successfully."

$anonConfig = Get-AnonConfigFromEnv
if ($anonConfig) {
    $verifyHeaders = @{
        "apikey" = $anonConfig.Key
        "Authorization" = "Bearer $($anonConfig.Key)"
    }
    $tablesToVerify = @(
        "attendance_records",
        "attendance_upload_sessions",
        "employees",
        "shift_rosters",
        "shift_sync_settings",
        "leave_upload_batches",
        "leave_applications",
        "employee_update_upload_logs",
        "ipulse_config",
        "ipulse_sync_logs",
        "biometric_clock_events"
    )

    Write-Host "Verifying public API availability for core tables..."
    foreach ($table in $tablesToVerify) {
        try {
            Invoke-RestMethod `
                -Uri "$($anonConfig.Url)/rest/v1/$table?select=*&limit=1" `
                -Headers $verifyHeaders `
                -Method GET `
                -TimeoutSec 20 | Out-Null
            Write-Host "VERIFIED: $table"
        } catch {
            $statusCode = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { "unknown" }
            Write-Warning "Verification failed for ${table} with status $statusCode."
        }
    }
} else {
    Write-Host "Skipped verification because .env.local does not contain VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
}
