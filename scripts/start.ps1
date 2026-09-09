$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

docker compose --project-directory $ProjectRoot up --build --detach
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Project Management MVP is available at http://127.0.0.1:8000"
