# Sync src/ into chrome/ and firefox/
Set-Location $PSScriptRoot\..
node scripts/build.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
