# Simple database check
$env:Path += ";C:\Program Files\PostgreSQL\16\bin"
$env:PGPASSWORD = "admin123"

# Get table count
$tables = psql -U postgres -d unitefix_db -t -A -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';"

# Get seed counts
$pincodes = psql -U postgres -d unitefix_db -t -A -c "SELECT COUNT(*) FROM serviceable_pincodes;"
$admins = psql -U postgres -d unitefix_db -t -A -c "SELECT COUNT(*) FROM admin_users;"

# Create result object
$result = @{
    total_tables         = $tables.Trim()
    serviceable_pincodes = $pincodes.Trim()
    admin_users          = $admins.Trim()
    timestamp            = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
}

# Output as JSON
$result | ConvertTo-Json | Out-File -FilePath "db_status.json" -Encoding ASCII

# Also display
Write-Host "Database Status:"
Write-Host "Tables: $tables"
Write-Host "Pincodes: $pincodes"  
Write-Host "Admins: $admins"
