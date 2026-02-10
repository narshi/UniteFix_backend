$USER_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjk5OSwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzY5ODY5MzU2LCJleHAiOjE3NzI0NjEzNTZ9.CcwYysjmpsDLxrUijNLGwHXj_I6W9E5LjpgdpTI5vo4"; 
$headers = @{ "Authorization" = "Bearer $USER_TOKEN" };

Write-Output "1. Creating District: Uttara Kannada..."
try { 
    Invoke-RestMethod -Uri "http://localhost:3000/api/admin/districts" -Method POST -Headers $headers -Body '{"name": "Uttara Kannada", "state": "Karnataka", "isActive": true}' -ContentType "application/json" 
}
catch { 
    Write-Output "   Already exists or error: $($_.Exception.Message)" 
}

Write-Output "`n2. Creating District: Udupi..."
try { 
    Invoke-RestMethod -Uri "http://localhost:3000/api/admin/districts" -Method POST -Headers $headers -Body '{"name": "Udupi", "state": "Karnataka", "isActive": true}' -ContentType "application/json" 
}
catch { 
    Write-Output "   Already exists or error: $($_.Exception.Message)" 
}

Write-Output "`n3. Listing Districts..."
try {
    $districts = Invoke-RestMethod -Uri "http://localhost:3000/api/admin/districts" -Method GET -Headers $headers
    $districts | Format-Table id, name, isActive
}
catch {
    Write-Output "   Failed to list districts: $($_.Exception.Message)"
}

Write-Output "`n4. Creating Location in Uttara Kannada (581333)..."
try {
    Invoke-RestMethod -Uri "http://localhost:3000/api/admin/locations" -Method POST -Headers $headers -Body '{"pincode": "581333", "area": "Kumta", "district": "Uttara Kannada", "state": "Karnataka", "isActive": true}' -ContentType "application/json"
    Write-Output "   Success."
}
catch {
    Write-Output "   Failed (Expected if exists): $($_.Exception.Message)"
}

Write-Output "`n5. Testing Strict Validation (560001)..."
try {
    Invoke-RestMethod -Uri "http://localhost:3000/api/admin/locations" -Method POST -Headers $headers -Body '{"pincode": "560001", "area": "Bangalore", "district": "Bangalore Urban", "state": "Karnataka", "isActive": true}' -ContentType "application/json"
    Write-Output "   FAILED: Should have been rejected."
}
catch {
    Write-Output "   Success: Rejected as expected ($($_.Exception.Message))"
}
