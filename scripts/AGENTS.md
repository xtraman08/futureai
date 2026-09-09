# Platform script guidance

This directory contains local Docker lifecycle scripts:

- `start.ps1` and `stop.ps1` for Windows PowerShell.
- `start.sh` and `stop.sh` for macOS and Linux shells.

All scripts resolve the project root from their own location and run the same
Compose project. Start scripts build and launch in the background. Stop scripts
remove the container and network but must not delete the named data volume.

Keep platform behavior and user-facing messages consistent. Do not duplicate
application configuration in these scripts; keep it in `compose.yaml`.