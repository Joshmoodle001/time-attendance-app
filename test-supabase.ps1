# Test Supabase connection
$supabaseUrl = "https://bkmlqnmnxkeibmrcpefp.supabase.co"
$anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrbWxxbm1ueGtlaWJtcmNwZWZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjgwODgsImV4cCI6MjA5MDQ0NDA4OH0.unff0no9HeKwh2jXuCqHzwVP2ADw2ATMPiIQ4zZi-8g"

$headers = @{
    "apikey" = $anonKey
    "Authorization" = "Bearer $anonKey"
    "Content-Type" = "application/json"
}

try {
    # Check if attendance_records table exists by querying it
    $response = Invoke-WebRequest -Uri "$supabaseUrl/rest/v1/attendance_upload_sessions" -Headers $headers -Method GET -TimeoutSec 15
    Write-Host "SUCCESS: Connected to Supabase! Status: $($response.StatusCode)"
    Write-Host "Tables exist!"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Response Code: $statusCode"
    if ($statusCode -eq 406) {
        Write-Host "Tables don't exist yet - need to run SQL setup"
    } elseif ($statusCode -eq 401) {
        Write-Host "Authentication issue"
    } else {
        Write-Host "Error: $($_.Exception.Message)"
    }
}
