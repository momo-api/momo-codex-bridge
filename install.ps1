[CmdletBinding()]
param(
  [string]$ApiKey = "",
  [string]$Endpoint = "https://momoapi.us",
  [int]$Port = 18789,
  [switch]$NoAutostart
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
  Write-Host "[momo-codex-bridge] $Message" -ForegroundColor Cyan
}

function Write-Success([string]$Message) {
  Write-Host "[momo-codex-bridge] $Message" -ForegroundColor Green
}

function Write-Err([string]$Message) {
  Write-Host "[momo-codex-bridge] ERROR: $Message" -ForegroundColor Red
}

# 1. Check Node.js
Write-Step "Checking Node.js environment..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Step "Installing Node.js LTS via winget..."
    & $winget.Source install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
    $nodeDir = Join-Path $env:ProgramFiles "nodejs"
    if (Test-Path (Join-Path $nodeDir "node.exe")) {
      $env:Path = "$nodeDir;$env:Path"
    }
    $node = Get-Command node -ErrorAction SilentlyContinue
  }
}

if (-not $node) {
  Write-Err "Node.js 18+ is required. Please download and install Node.js from https://nodejs.org/"
  exit 1
}

$nodeVer = (& $node.Source --version).Trim().TrimStart("v")
$major = [int]($nodeVer.Split(".")[0])
if ($major -lt 18) {
  Write-Err "Node.js version must be >= 18; found v$nodeVer. Please update Node.js."
  exit 1
}
Write-Step "Found Node.js v$nodeVer"

# 2. Resolve API Key
if (-not $ApiKey) {
  $ApiKey = $env:MOMO_API_KEY
}
if (-not $ApiKey) {
  $ApiKey = Read-Host "Enter your MOMO API Key (e.g. sk-momo-...)"
}
if (-not $ApiKey) {
  Write-Err "MOMO API Key is required."
  exit 1
}

# 3. Download / Install to ~/.momo-codex-bridge
$installDir = Join-Path $HOME ".momo-codex-bridge" "app"
if (Test-Path $installDir) {
  Remove-Item -Recurse -Force $installDir
}
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

Write-Step "Downloading latest release package from GitHub..."
$tgzUrl = "https://github.com/momo-api/momo-codex-bridge/releases/download/v0.4.0/momo-api-codex-bridge-0.4.0.tgz"
$tgzPath = Join-Path $HOME ".momo-codex-bridge" "package.tgz"

try {
  Invoke-WebRequest -Uri $tgzUrl -OutFile $tgzPath -UseBasicParsing
  tar -xzf $tgzPath -C $installDir --strip-components=1
  Remove-Item $tgzPath -Force
} catch {
  Write-Step "Direct download failed, falling back to git clone..."
  git clone https://github.com/momo-api/momo-codex-bridge.git $installDir
}

# 4. Run Setup
Write-Step "Configuring Codex provider & syncing models..."
$bridgeBin = Join-Path $installDir "bin" "momo-codex-bridge.mjs"
$setupArgs = @($bridgeBin, "install", "--api-key", $ApiKey, "--endpoint", $Endpoint, "--port", "$Port")
if ($NoAutostart) { $setupArgs += "--no-autostart" }

& node.exe @setupArgs
if ($LASTEXITCODE -ne 0) {
  Write-Err "Setup failed with exit code $LASTEXITCODE"
  exit $LASTEXITCODE
}

# 5. Launch Background Service
Write-Step "Starting MOMO Codex Bridge daemon..."
Start-Process -FilePath "node.exe" -ArgumentList @($bridgeBin, "serve") -WindowStyle Hidden

# 6. Register PATH
$binDir = Join-Path $installDir "bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$binDir;$userPath", "User")
  $env:Path = "$binDir;$env:Path"
}

Write-Success "=========================================================="
Write-Success "  MOMO Codex Bridge installed and running successfully!   "
Write-Success "=========================================================="
Write-Host ""
Write-Host "Local Bridge is listening on: http://127.0.0.1:$Port/v1" -ForegroundColor Yellow
Write-Host "Codex CLI & ChatGPT Desktop have been configured with requires_openai_auth=false" -ForegroundColor Yellow
Write-Host "Synced models are ready. Restart Codex App to use." -ForegroundColor Yellow
Write-Host ""
Write-Host "Commands:"
Write-Host "  momo-codex-bridge status   - Check bridge running status"
Write-Host "  momo-codex-bridge models   - List available models"
Write-Host "  momo-codex-bridge doctor   - Run health diagnostics"
Write-Host "  momo-codex-bridge rollback - Restore previous config"
Write-Host ""
*** Add File: C:\Users\lumao\Desktop\momo-vps-dev-clean\momo-codex-switch\install.sh
#!/usr/bin/env bash
set -euo pipefail

API_KEY="${1:-${MOMO_API_KEY:-}}"
ENDPOINT="${MOMO_API_ENDPOINT:-https://momoapi.us}"
PORT="${MOMO_BRIDGE_PORT:-18789}"

echo "==> [momo-codex-bridge] Checking Node.js environment..."
if ! command -v node >/dev/null 2>&1; then
  echo "==> ERROR: Node.js 18+ is required. Please install Node.js from https://nodejs.org/"
  exit 1
fi

NODE_MAJOR=$(node -v | tr -d 'v' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "==> ERROR: Node.js version must be >= 18; found $(node -v)"
  exit 1
fi

if [ -z "$API_KEY" ]; then
  read -rp "Enter your MOMO API Key (e.g. sk-momo-...): " API_KEY
fi

if [ -z "$API_KEY" ]; then
  echo "==> ERROR: MOMO API Key is required."
  exit 1
fi

INSTALL_DIR="$HOME/.momo-codex-bridge/app"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

echo "==> [momo-codex-bridge] Downloading latest release from GitHub..."
TGZ_URL="https://github.com/momo-api/momo-codex-bridge/releases/download/v0.4.0/momo-api-codex-bridge-0.4.0.tgz"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$TGZ_URL" | tar -xz -C "$INSTALL_DIR" --strip-components=1 || git clone https://github.com/momo-api/momo-codex-bridge.git "$INSTALL_DIR"
elif command -v wget >/dev/null 2>&1; then
  wget -qO- "$TGZ_URL" | tar -xz -C "$INSTALL_DIR" --strip-components=1 || git clone https://github.com/momo-api/momo-codex-bridge.git "$INSTALL_DIR"
else
  git clone https://github.com/momo-api/momo-codex-bridge.git "$INSTALL_DIR"
fi

BRIDGE_BIN="$INSTALL_DIR/bin/momo-codex-bridge.mjs"
chmod +x "$BRIDGE_BIN"

echo "==> [momo-codex-bridge] Configuring Codex provider and syncing models..."
node "$BRIDGE_BIN" install --api-key "$API_KEY" --endpoint "$ENDPOINT" --port "$PORT"

echo "==> [momo-codex-bridge] Starting background daemon..."
nohup node "$BRIDGE_BIN" serve > /dev/null 2>&1 &

echo ""
echo "=========================================================="
echo "  MOMO Codex Bridge installed and running successfully!   "
echo "=========================================================="
echo "Local Bridge is listening on: http://127.0.0.1:$PORT/v1"
echo "Run 'momo-codex-bridge doctor' to verify health."
