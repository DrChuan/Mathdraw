[CmdletBinding()]
param(
    [switch]$IncludeNotes,
    [switch]$SkipInstall,
    [switch]$UnsignedDevelopment
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Please run this script on Windows 10/11 x64.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = $projectRoot
$appRoot = Join-Path $workspaceRoot 'apps\mindmap-notes'
$target = 'x86_64-pc-windows-msvc'
$appVersion = (Get-Content (Join-Path $appRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). No successful package is reported." }
}
foreach ($program in @('node', 'npm.cmd', 'rustc', 'rustup', 'cargo')) {
    if (-not (Get-Command $program -ErrorAction SilentlyContinue)) {
        throw "Missing $program. Install Node.js and the Rust MSVC toolchain, then reopen the terminal."
    }
}
$nodeVersion = [version](& node -p 'process.versions.node')
if ($nodeVersion -lt [version]'22.12.0') { throw 'Node.js 22.12 or newer is required (Node 24/26 recommended).' }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'Install Visual Studio Build Tools with Desktop development with C++ and Windows SDK.' }
$cpp = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $cpp) { throw 'The MSVC C++ build tools are missing. Add Desktop development with C++ and Windows SDK.' }
$targets = & rustup target list --installed
if ($LASTEXITCODE -ne 0 -or $targets -notcontains $target) {
    throw "Install the Rust target first: rustup target add $target"
}
# Stable releases must use the same private updater key as prior releases.
if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and -not $UnsignedDevelopment) {
    throw 'Set TAURI_SIGNING_PRIVATE_KEY to the release key path, or use -UnsignedDevelopment for a local-only build. Never upload the private key.'
}
$records = @()
Push-Location $appRoot
try {
    if (-not $SkipInstall) { Invoke-Checked 'npm.cmd' @('ci') }
    foreach ($product in @('Mathdraw') + $(if ($IncludeNotes) { @('Mindgrove') } else { @() })) {
        $binary = $product.ToLowerInvariant()
        $script = if ($product -eq 'Mathdraw') { 'bundle:drawing' } else { 'bundle' }
        Write-Host "Building $product x64 installer..."
        $buildArgs = @('run', $script, '--', '--target', $target, '--bundles', 'nsis')
        if ($UnsignedDevelopment -and $product -eq 'Mathdraw') { $buildArgs += @('--config', '{"bundle":{"createUpdaterArtifacts":false}}') }
        Invoke-Checked 'npm.cmd' $buildArgs
        $release = Join-Path $appRoot "src-tauri\target\$target\release"
        $installers = @(Get-ChildItem (Join-Path $release 'bundle\nsis') -Filter "$product*$appVersion*.exe" -File)
        $executable = Join-Path $release "$binary.exe"
        if ($installers.Count -eq 0 -or -not (Test-Path $executable)) { throw "Build output is incomplete for $product." }
        $outputRoot = if ($product -eq 'Mathdraw') { $projectRoot } else { $appRoot }
        $output = Join-Path $outputRoot 'artifacts/mathdraw\windows'
        New-Item -ItemType Directory -Force -Path $output | Out-Null
        $signed = @()
        if ($product -eq 'Mathdraw' -and -not $UnsignedDevelopment) {
            foreach ($installer in $installers) {
                $sig = $installer.FullName + '.sig'
                if (-not (Test-Path $sig)) { throw "Missing updater signature: $sig" }
                $signed += $sig
            }
        }
        foreach ($file in @($executable) + @($installers.FullName) + $signed) {
            Copy-Item -LiteralPath $file -Destination $output -Force
            $result = Join-Path $output (Split-Path $file -Leaf)
            $records += [pscustomobject]@{ product=$product; file=$result; sha256=(Get-FileHash $result -Algorithm SHA256).Hash }
        }
        Write-Host "Output: $output"
    }
    $manifest = Join-Path $projectRoot 'artifacts/mathdraw\windows\build-info.json'
    [pscustomobject]@{ builtAt=(Get-Date).ToString('o'); target=$target; node=$nodeVersion.ToString(); files=$records } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest -Encoding UTF8
    Write-Host 'Completed. Use the *-setup.exe installer for distribution. Updater signatures accompany release installers; Authenticode signing is not configured.'
} finally { Pop-Location }
