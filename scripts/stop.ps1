$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

docker compose --project-directory $ProjectRoot down
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Project Management MVP stopped. Local data was preserved."
