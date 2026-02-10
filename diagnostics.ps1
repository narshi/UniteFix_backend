Write-Host "=== UniteFix Database Diagnostics ===" -ForegroundColor Cyan
Write-Host ""

# Add PostgreSQL to PATH for this session
$env:Path += ";C:\Program Files\PostgreSQL\16\bin"
$env:PGPASSWORD = "admin123"

Write-Host "1. Checking table count..." -ForegroundColor Yellow
$tableCount = psql -U postgres -d unitefix_db -t -A -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';"
Write-Host "   Total tables: $tableCount" -ForegroundColor Green

Write-Host ""
Write-Host "2. Listing all tables..." -ForegroundColor Yellow
psql -U postgres -d unitefix_db -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" -P pager=off

Write-Host ""
Write-Host "3. Checking seed data..." -ForegroundColor Yellow
$pincodeCount = psql -U postgres -d unitefix_db -t -A -c "SELECT COUNT(*) FROM serviceable_pincodes;"
Write-Host "   Serviceable pincodes: $pincodeCount" -Foreground Color Green

$adminCount = psql -U postgres -d unitefix_db -t -A -c "SELECT COUNT(*) FROM admin_users;"
Write-Host "   Admin users: $adminCount" -ForegroundColor Green

Write-Host ""
Write-Host "4. Showing serviceable pincodes..." -ForegroundColor Yellow
psql -U postgres -d unitefix_db -c "SELECT pin_code, area, district FROM serviceable_pincodes;" -P pager=off

Write-Host ""
Write-Host "5. Testing Admin Stats API..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/admin/stats" -Method GET -ErrorAction Stop
    Write-Host "   SUCCESS:" -ForegroundColor Green
    $response | ConvertTo-Json
} catch {
    Write-Host "   FAILED:" -ForegroundColor Red
    Write-Host "   Status: $($_.Exception.Response.StatusCode.value__)"
    Write-Host "   Error: $($_.Exception.Message)"
    if ($_.ErrorDetails) {
        Write-Host "   Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "6. Testing Locations API..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/admin/locations" -Method GET -ErrorAction Stop
    Write-Host "   SUCCESS:" -ForegroundColor Green
    $response | ConvertTo-Json
} catch {
    Write-Host "   FAILED:" -ForegroundColor Red
    Write-Host "   Status: $($_.Exception.Response.StatusCode.value__)"  
    Write-Host "   Error: $($_.Exception.Message)"
    if ($_.ErrorDetails) {
        Write-Host "   Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== Diagnostics Complete ===" -ForegroundColor Cyan
