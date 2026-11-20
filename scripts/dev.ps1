# Builds and runs the CURRENT worktree, so what you look at is never an old install.
#   .\scripts\dev.ps1 tui    build the terminal app and run it from target\debug (nothing is installed)
#   .\scripts\dev.ps1 gui    start the desktop app (Vite and the Rust host rebuild from this folder)
#   add -Stop to end a build of this worktree that is still running (its sessions end with it) instead of refusing
# Both print the commit and when the binary was built first; compare it with what you expect.
# Both run their own service (<PREFIX>_SOCKET=dev-<folder> unless you set one), so a debug build never
# takes over the service your installed app and its agents use. The desktop app also gets its own data,
# config and install folders under %LOCALAPPDATA%\maiker-dev\<folder>, so it starts empty and shares nothing.
param([Parameter(Mandatory = $true)][ValidateSet('tui', 'gui')][string]$App, [switch]$Stop)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
# The names that depend on the brand come from apps/gui/src/brand.ts, the one file that holds them (ADR 0012).
$brand = Get-Content (Join-Path $root 'apps\gui\src\brand.ts') -Raw
function Get-Brand([string]$Name) {
    if ($brand -match "export const $Name = '([^']*)'") { return $Matches[1] }
    throw "apps\gui\src\brand.ts has no $Name"
}
$command = Get-Brand 'APP_COMMAND'
$daemon = Get-Brand 'DAEMON_NAME'
$socketVariable = (Get-Brand 'ENV_PREFIX') + '_SOCKET'
$commit = (git rev-parse --short HEAD)
$dirty = if (git status --porcelain) { '*' } else { '' }
Write-Host "worktree: $root  commit: $commit$dirty" -ForegroundColor Cyan

# Windows will not replace a program that is running, so say so instead of failing halfway.
# The desktop app starts its own service (the daemon name, then the target), which outlives the window and locks its file, so it counts too.
$running = Get-Process "$command*", "$daemon*" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$root*" }
if ($running -and $Stop) {
    $running | ForEach-Object { Write-Host "stopping $($_.Name) (pid $($_.Id))" -ForegroundColor Yellow }
    $running | Stop-Process -Force
    Start-Sleep -Seconds 1
    $running = $null
}
if ($running) {
    Write-Host 'A build from this worktree is still running; stop it first (Stop-Process -Id <pid>), or run this again with -Stop:' -ForegroundColor Yellow
    $running | ForEach-Object { Write-Host "  $($_.Name) (pid $($_.Id))" }
    exit 1
}

if ($App -eq 'tui') {
    cargo build -p $command
    # A failed build leaves the last good binary in place: running it would show old code.
    if ($LASTEXITCODE -ne 0) { Write-Host 'The build failed; nothing was started.' -ForegroundColor Red; exit $LASTEXITCODE }
    if (-not [Environment]::GetEnvironmentVariable($socketVariable)) {
        [Environment]::SetEnvironmentVariable($socketVariable, 'dev-' + (Split-Path -Leaf $root))
    }
    Write-Host "service: $([Environment]::GetEnvironmentVariable($socketVariable))" -ForegroundColor Cyan
    $exe = Join-Path $root "target\debug\$command.exe"
    Write-Host "running $exe (built $((Get-Item $exe).LastWriteTime))" -ForegroundColor Cyan
    & $exe
} else {
    # A desktop build from a checkout must not reach the installed service: its own socket, data, config and install
    # folder (docs/ENVIRONMENT.md, isolated tests). Anything you set yourself is kept.
    $prefix = Get-Brand 'ENV_PREFIX'
    $isolated = Join-Path $env:LOCALAPPDATA ('maiker-dev\' + (Split-Path -Leaf $root))
    $defaults = @{
        SOCKET      = 'dev-' + (Split-Path -Leaf $root)
        DATA_DIR    = Join-Path $isolated 'data'
        CONFIG      = Join-Path $isolated 'config.toml'
        INSTALL_DIR = Join-Path $isolated 'bin'
    }
    foreach ($key in $defaults.Keys) {
        $name = "${prefix}_$key"
        if (-not [Environment]::GetEnvironmentVariable($name)) { [Environment]::SetEnvironmentVariable($name, $defaults[$key]) }
    }
    New-Item -ItemType Directory -Force -Path $defaults.DATA_DIR, $defaults.INSTALL_DIR | Out-Null
    Write-Host "own service: $([Environment]::GetEnvironmentVariable($socketVariable))  data: $([Environment]::GetEnvironmentVariable($prefix + '_DATA_DIR'))" -ForegroundColor Cyan
    Set-Location (Join-Path $root 'apps\gui')
    if (-not (Test-Path node_modules)) {
        pnpm install --frozen-lockfile --config.node-linker=hoisted
        if ($LASTEXITCODE -ne 0) { Write-Host 'Installing the packages failed; nothing was started.' -ForegroundColor Red; exit $LASTEXITCODE }
    }
    pnpm desktop:dev
    exit $LASTEXITCODE
}
