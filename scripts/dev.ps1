# Builds and runs the CURRENT worktree, so what you look at is never an old install.
#   .\scripts\dev.ps1 tui    build the terminal app and run it from target\debug (nothing is installed)
#   .\scripts\dev.ps1 gui    start the desktop app (Vite and the Rust host rebuild from this folder)
# Both print the commit and when the binary was built first; compare it with what you expect.
# The terminal app runs its own service (MAIKER_SOCKET=dev-<folder> unless you set one), so a debug
# build never takes over the service your installed app and its agents use.
param([Parameter(Mandatory = $true)][ValidateSet('tui', 'gui')][string]$App)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$commit = (git rev-parse --short HEAD)
$dirty = if (git status --porcelain) { '*' } else { '' }
Write-Host "worktree: $root  commit: $commit$dirty" -ForegroundColor Cyan

# Windows will not replace a program that is running, so say so instead of failing halfway.
# The desktop app starts its own service (maiker-gui-daemon-*), which outlives the window and locks its file, so it counts too.
$running = Get-Process maiker*, maitty-gui* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$root*" }
if ($running) {
    Write-Host 'A build from this worktree is still running; stop it first (Stop-Process -Id <pid>):' -ForegroundColor Yellow
    $running | ForEach-Object { Write-Host "  $($_.Name) (pid $($_.Id))" }
    exit 1
}

if ($App -eq 'tui') {
    cargo build -p maiker
    # A failed build leaves the last good binary in place: running it would show old code.
    if ($LASTEXITCODE -ne 0) { Write-Host 'The build failed; nothing was started.' -ForegroundColor Red; exit $LASTEXITCODE }
    if (-not $env:MAIKER_SOCKET) { $env:MAIKER_SOCKET = 'dev-' + (Split-Path -Leaf $root) }
    Write-Host "service: $env:MAIKER_SOCKET" -ForegroundColor Cyan
    $exe = Join-Path $root 'target\debug\maiker.exe'
    Write-Host "running $exe (built $((Get-Item $exe).LastWriteTime))" -ForegroundColor Cyan
    & $exe
} else {
    Set-Location (Join-Path $root 'apps\gui')
    if (-not (Test-Path node_modules)) {
        pnpm install --frozen-lockfile --config.node-linker=hoisted
        if ($LASTEXITCODE -ne 0) { Write-Host 'Installing the packages failed; nothing was started.' -ForegroundColor Red; exit $LASTEXITCODE }
    }
    pnpm desktop:dev
    exit $LASTEXITCODE
}
