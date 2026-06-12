param(
  [string]$OutputRoot = "",
  [string]$PortableFolderName = "server time and attendance system"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-OutputRoot {
  param([string]$RequestedRoot)

  if ($RequestedRoot) {
    return $RequestedRoot
  }

  try {
    $desktopPath = [Environment]::GetFolderPath('Desktop')
    if ($desktopPath -and (Test-Path -LiteralPath $desktopPath)) {
      return $desktopPath
    }
  } catch {
    # Fall back to the repo-local staging folder if Desktop cannot be resolved.
  }

  return (Join-Path $repoRoot 'portable-dist')
}

$outputRoot = Resolve-OutputRoot -RequestedRoot $OutputRoot
$packageRoot = Join-Path $outputRoot $PortableFolderName
$appRoot = Join-Path $packageRoot 'resources\app'
$portableDataRoot = Join-Path $appRoot 'portable-data'

function Reset-TargetDirectory {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Path $Path | Out-Null
}

function Ensure-ParentDirectory {
  param([string]$Path)
  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
}

function Copy-IfExists {
  param(
    [string]$Source,
    [string]$Destination
  )
  if (Test-Path -LiteralPath $Source) {
    Ensure-ParentDirectory -Path $Destination
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
  }
}

function Merge-Path {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    return
  }

  $sourceItem = Get-Item -LiteralPath $Source -Force
  if ($sourceItem.PSIsContainer) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
      Merge-Path -Source $_.FullName -Destination (Join-Path $Destination $_.Name)
    }
    return
  }

  Ensure-ParentDirectory -Path $Destination
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

Reset-TargetDirectory -Path $packageRoot
New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
New-Item -ItemType Directory -Path $portableDataRoot -Force | Out-Null

$repoItemsToCopy = @(
  'api',
  'dist',
  'electron',
  'node_modules',
  'public',
  'src',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'tailwind.config.js',
  'postcss.config.js',
  'components.json'
)

foreach ($item in $repoItemsToCopy) {
  $sourcePath = Join-Path $repoRoot $item
  $destinationPath = Join-Path $appRoot $item
  Copy-IfExists -Source $sourcePath -Destination $destinationPath
}

$dataSources = @(
  @{ Source = (Join-Path $repoRoot 'portable-data'); Destination = $portableDataRoot },
  @{ Source = (Join-Path $repoRoot '.electron-user-data'); Destination = (Join-Path $portableDataRoot 'user-data') },
  @{ Source = (Join-Path $repoRoot '.electron-session-data'); Destination = (Join-Path $portableDataRoot 'session-data') },
  @{ Source = (Join-Path $repoRoot 'report-bridge.log'); Destination = (Join-Path $portableDataRoot 'report-bridge.log') },
  @{ Source = (Join-Path $repoRoot 'resources\app\portable-data'); Destination = $portableDataRoot }
)

foreach ($entry in $dataSources) {
  Merge-Path -Source $entry.Source -Destination $entry.Destination
}

$runtimeFiles = @(
  'EMBER Time Attendance.exe',
  'chrome_100_percent.pak',
  'chrome_200_percent.pak',
  'd3dcompiler_47.dll',
  'ffmpeg.dll',
  'icudtl.dat',
  'libEGL.dll',
  'libGLESv2.dll',
  'resources.pak',
  'snapshot_blob.bin',
  'v8_context_snapshot.bin',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll'
)

foreach ($fileName in $runtimeFiles) {
  Copy-IfExists -Source (Join-Path $repoRoot $fileName) -Destination (Join-Path $packageRoot $fileName)
}

Copy-IfExists -Source (Join-Path $repoRoot 'locales') -Destination (Join-Path $packageRoot 'locales')
Copy-IfExists -Source (Join-Path $repoRoot 'swiftshader') -Destination (Join-Path $packageRoot 'swiftshader')

$launcherPath = Join-Path $packageRoot 'Launch Server Time Attendance.bat'
@'
@echo off
setlocal
cd /d "%~dp0"
if not exist "EMBER Time Attendance.exe" (
  echo EMBER Time Attendance.exe was not found in this portable folder.
  pause
  exit /b 1
)
start "" "EMBER Time Attendance.exe"
'@ | Set-Content -LiteralPath $launcherPath -Encoding ASCII

$resetPath = Join-Path $packageRoot 'Prepare For New Machine.bat'
@'
@echo off
setlocal
cd /d "%~dp0"
if exist "resources\app\portable-data\machine.json" del /f /q "resources\app\portable-data\machine.json"
if exist "resources\app\portable-data\worker-config.json" del /f /q "resources\app\portable-data\worker-config.json"
echo Portable machine identity cleared. The next launch will open the setup checklist again.
pause
'@ | Set-Content -LiteralPath $resetPath -Encoding ASCII

$readmePath = Join-Path $packageRoot 'README.txt'
@'
SERVER TIME AND ATTENDANCE SYSTEM

How to use this folder:
1. Keep the whole folder together.
2. Launch the app with "Launch Server Time Attendance.bat" or the EXE.
3. On first launch, complete the setup checklist.
4. If you copy this folder to another machine and want a fresh machine identity, run "Prepare For New Machine.bat" before launching there.

Important:
- Local app data lives inside resources\app\portable-data.
- The builder merges both the current portable-data layout and older hidden Electron data folders.
- The Amber live site can route report generation to this machine.
- If this machine is set as the primary host and is offline, Amber can fail over to another ready machine.
'@ | Set-Content -LiteralPath $readmePath -Encoding ASCII

Write-Host "Portable package created at: $packageRoot"
