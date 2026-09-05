$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$taskPnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
$taskTsxPath = Join-Path $PSScriptRoot 'node_modules\tsx\dist\cli.mjs'
# Start the installed entry point directly; a restart does not require reinstalling packages.
if ($taskNodeCommand -and (Test-Path -LiteralPath $taskTsxPath)) {
    & $taskNodeCommand.Source $taskTsxPath (Join-Path $PSScriptRoot 'scripts\dev.ts')
    exit $LASTEXITCODE
}
if ($taskNodeCommand -and $taskPnpmCommand) {
    if (-not (Test-Path -LiteralPath $taskTsxPath)) {
        & $taskPnpmCommand.Source install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & $taskNodeCommand.Source $taskTsxPath (Join-Path $PSScriptRoot 'scripts\dev.ts')
    exit $LASTEXITCODE
}
$taskRuntimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node'
$taskNodePath = Join-Path $taskRuntimeRoot 'bin\node.exe'
$taskPnpmPath = Join-Path $taskRuntimeRoot 'node_modules\pnpm\bin\pnpm.cjs'
if (-not (Test-Path -LiteralPath $taskPnpmPath)) { $taskPnpmPath = Join-Path $taskRuntimeRoot 'node_modules\pnpm\bin\pnpm.mjs' }
if ((Test-Path -LiteralPath $taskNodePath) -and (Test-Path -LiteralPath $taskTsxPath)) {
    & $taskNodePath $taskTsxPath (Join-Path $PSScriptRoot 'scripts\dev.ts')
    exit $LASTEXITCODE
}
if ((Test-Path -LiteralPath $taskNodePath) -and (Test-Path -LiteralPath $taskPnpmPath)) {
    $env:PATH = (Join-Path $taskRuntimeRoot 'bin') + ';' + $env:PATH
    if (-not (Test-Path -LiteralPath $taskTsxPath)) {
        & $taskNodePath $taskPnpmPath install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & $taskNodePath $taskTsxPath (Join-Path $PSScriptRoot 'scripts\dev.ts')
    exit $LASTEXITCODE
}
throw 'Install Node.js LTS (22.12 or later) and pnpm 10, then run this script again.'
