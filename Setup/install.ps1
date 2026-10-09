param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$toolRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tools = Join-Path $toolRoot 'tools'
$venvPython = Join-Path $toolRoot '.venv\Scripts\python.exe'
$env:Path = "$toolRoot\.venv\Scripts;$tools\node;$tools\ffmpeg\bin;$env:Path"
$env:PUPPETEER_SKIP_DOWNLOAD = 'true'
Set-Location -LiteralPath $toolRoot

function Run-Checked([string]$Exe, [string[]]$Arguments) {
    # Native tools may write warnings/progress to stderr even on success.
    $ErrorActionPreference = 'Continue'
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Exe failed (exit $LASTEXITCODE). See the error above and rerun setup." }
}
function Get-Node {
    $candidate = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($candidate) {
        $version = & $candidate.Source -p 'process.versions.node' 2>$null
        if ($LASTEXITCODE -eq 0 -and [int]($version.Split('.')[0]) -ge 22) { return $candidate.Source }
    }
}
function Test-Python([string]$Exe) {
    $ErrorActionPreference = 'Continue'
    if (-not $Exe -or -not (Test-Path -LiteralPath $Exe)) { return $false }
    & $Exe -c 'import sys,tkinter,venv; assert (3,10) <= sys.version_info[:2] <= (3,12)' 2>$null
    return $LASTEXITCODE -eq 0
}
function Get-Python {
    $ErrorActionPreference = 'Continue'
    $candidates = @($venvPython, "$tools\python\python.exe")
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        foreach ($version in @('-3.12','-3.11','-3.10')) {
            $found = & $launcher.Source $version -c 'import sys; print(sys.executable)' 2>$null
            if ($LASTEXITCODE -eq 0) { $candidates += $found }
        }
    }
    $onPath = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($onPath) { $candidates += $onPath.Source }
    foreach ($candidate in $candidates) { if (Test-Python $candidate) { return $candidate } }
}
function Get-Chrome {
    foreach ($candidate in @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
}
function Download([string]$Url,[string]$File) {
    Write-Host "Downloading $(Split-Path $File -Leaf)..."
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $File
}
function Check-Signed([string]$File) {
    if ((Get-AuthenticodeSignature -LiteralPath $File).Status -ne 'Valid') { throw "Installer signature could not be verified: $File" }
}
function Relocate-Data {
    $manifestFile = Join-Path $toolRoot 'portable_manifest.json'
    if (-not (Test-Path -LiteralPath $manifestFile)) { return }
    $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
    $oldRoot = [string]$manifest.sourceRoot
    if ($manifest.preparedForRoot) { $oldRoot = [string]$manifest.preparedForRoot }
    function Convert-Value($value) {
        if ($value -is [string]) {
            $normalized = $value.Replace('\','/')
            $old = $oldRoot.Replace('\','/').TrimEnd('/')
            if ($normalized.Equals($old,[StringComparison]::OrdinalIgnoreCase)) { return $toolRoot }
            if ($normalized.StartsWith($old+'/',[StringComparison]::OrdinalIgnoreCase)) { return (Join-Path $toolRoot $normalized.Substring($old.Length+1)) }
            return $value
        }
        if ($value -is [System.Management.Automation.PSCustomObject]) {
            foreach ($property in $value.PSObject.Properties) { $property.Value = Convert-Value $property.Value }
        } elseif ($value -is [array]) { return ,@($value | ForEach-Object { Convert-Value $_ }) }
        return $value
    }
    $files = @((Join-Path $toolRoot 'gui_settings.json'))
    $stories = Join-Path $toolRoot 'stories'
    if (Test-Path -LiteralPath $stories) { $files += @(Get-ChildItem -LiteralPath $stories -Recurse -Filter '*.json' -File | Select-Object -ExpandProperty FullName) }
    foreach ($file in $files) {
        if (-not (Test-Path -LiteralPath $file)) { continue }
        $data = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
        $before = $data | ConvertTo-Json -Depth 100
        $data = Convert-Value $data
        $after = $data | ConvertTo-Json -Depth 100
        if ($after -ne $before) { [IO.File]::WriteAllText($file,$after+"`n",[Text.UTF8Encoding]::new($false)) }
    }
    $accountsFile = Join-Path $toolRoot 'accounts.json'
    if ((Test-Path -LiteralPath $accountsFile) -and $manifest.preparedForRoot -ne $toolRoot) {
        $accounts = Get-Content -LiteralPath $accountsFile -Raw | ConvertFrom-Json
        $accounts.PSObject.Properties.Remove('browser')
        [IO.File]::WriteAllText($accountsFile,($accounts|ConvertTo-Json -Depth 50)+"`n",[Text.UTF8Encoding]::new($false))
    }
    if ($manifest.PSObject.Properties['preparedForRoot']) { $manifest.preparedForRoot = $toolRoot }
    else { $manifest | Add-Member -NotePropertyName preparedForRoot -NotePropertyValue $toolRoot }
    [IO.File]::WriteAllText($manifestFile,($manifest|ConvertTo-Json -Depth 20)+"`n",[Text.UTF8Encoding]::new($false))
}

if ($CheckOnly) {
    Write-Host 'CHECK ONLY - no downloads, installs or settings changes.'
    Write-Host "Node 22+: $(Get-Node)"
    Write-Host "Python 3.10-3.12 with tkinter: $(Get-Python)"
    Write-Host "Chrome: $(Get-Chrome)"
    foreach ($name in @('ffmpeg','ffprobe','whisper','yt-dlp')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        Write-Host "$name : $($cmd.Source)"
    }
    exit 0
}

Start-Transcript -Path (Join-Path $PSScriptRoot 'setup.log') -Append | Out-Null
try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'This setup requires 64-bit Windows 10 or 11.' }
    New-Item -ItemType Directory -Path $tools -Force | Out-Null
    $cache = Join-Path $tools 'downloads'
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    Write-Host '[1/7] Checking Node.js (22 or newer)...'
    $node = Get-Node
    if (-not $node) {
        $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
        $release = $index | Where-Object { $_.version -like 'v24.*' -and $_.lts } | Select-Object -First 1
        if (-not $release) { throw 'Could not find the Node 24 LTS release.' }
        $name = "node-$($release.version)-win-x64.zip"
        $zip = Join-Path $cache $name
        Download "https://nodejs.org/dist/$($release.version)/$name" $zip
        $sums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt").Content
        $match = [regex]::Match($sums,'(?m)^([a-f0-9]{64})\s+'+[regex]::Escape($name)+'\s*$')
        if (-not $match.Success -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $match.Groups[1].Value) { throw 'Node download checksum mismatch.' }
        Expand-Archive -LiteralPath $zip -DestinationPath $cache -Force
        $nodeDir = Join-Path $tools 'node'
        New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
        Copy-Item -Path (Join-Path $cache "node-$($release.version)-win-x64\*") -Destination $nodeDir -Recurse -Force
        $node = Get-Node
        if (-not $node) { throw 'Node installation verification failed.' }
    }
    Write-Host '[2/7] Checking Python + tkinter...'
    $python = Get-Python
    if (-not $python) {
        $installer = Join-Path $cache 'python-3.12.10-amd64.exe'
        Download 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' $installer
        Check-Signed $installer
        $target = Join-Path $tools 'python'
        $process = Start-Process -FilePath $installer -ArgumentList @('/quiet','InstallAllUsers=0',"TargetDir=`"$target`"",'PrependPath=0','Include_launcher=0','Include_test=0','Include_tcltk=1','Include_pip=1') -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -notin @(0,3010)) { throw "Python installer exited $($process.ExitCode)" }
        $python = Get-Python
        if (-not $python) { throw 'Python installation verification failed.' }
    }
    if (-not (Test-Python $venvPython)) { Run-Checked $python @('-m','venv',(Join-Path $toolRoot '.venv')) }
    $python = $venvPython
    Write-Host '[3/7] Checking Google Chrome...'
    if (-not (Get-Chrome)) {
        $installer = Join-Path $cache 'ChromeSetup.exe'
        Download 'https://dl.google.com/chrome/install/latest/chrome_installer.exe' $installer
        Check-Signed $installer
        $process = Start-Process -FilePath $installer -ArgumentList '/silent','/install' -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -notin @(0,3010)) { throw "Chrome installer exited $($process.ExitCode)" }
        if (-not (Get-Chrome)) { throw 'Chrome was not found after installation. Install Chrome, then rerun setup.' }
    }
    Write-Host '[4/7] Checking FFmpeg and FFprobe...'
    if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
        $zip = Join-Path $cache 'ffmpeg-release-essentials.zip'
        Download 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' $zip
        $unpack = Join-Path $cache 'ffmpeg-unpack'
        Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
        $binary = Get-ChildItem -LiteralPath $unpack -Recurse -Filter ffmpeg.exe -File | Select-Object -First 1
        if (-not $binary) { throw 'FFmpeg archive did not contain ffmpeg.exe.' }
        $bin = Join-Path $tools 'ffmpeg\bin'
        New-Item -ItemType Directory -Path $bin -Force | Out-Null
        Copy-Item -Path (Join-Path $binary.Directory.FullName '*.exe') -Destination $bin -Force
    }
    Run-Checked 'ffmpeg' @('-version')
    Run-Checked 'ffprobe' @('-version')
    Write-Host '[5/7] Installing Node packages from package-lock.json...'
    $ErrorActionPreference = 'Continue'
    & $node -e "require('puppeteer')" 2>$null
    $probeExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($probeExit -ne 0) {
        $npm = Join-Path (Split-Path $node) 'npm.cmd'
        if (-not (Test-Path -LiteralPath $npm)) { $npm = (Get-Command npm.cmd -ErrorAction Stop).Source }
        Run-Checked $npm @('ci','--no-audit','--no-fund')
    }
    Write-Host '[6/7] Installing Python requirements (CPU speech transcription)...'
    Run-Checked $python @('-m','pip','install','--upgrade','pip','setuptools','wheel')
    $ErrorActionPreference = 'Continue'
    & $python -c 'import torch' 2>$null
    $probeExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($probeExit -ne 0) { Run-Checked $python @('-m','pip','install','torch','--index-url','https://download.pytorch.org/whl/cpu') }
    Run-Checked $python @('-m','pip','install','-r',(Join-Path $PSScriptRoot 'requirements.txt'))
    Run-Checked $python @('-c','import tkinter,openpyxl,whisper,yt_dlp; import whisper as w; w.load_model("base",device="cpu"); print("Python packages and Whisper base model ready.")')
    Write-Host '[7/7] Updating copied paths and verifying the tool...'
    Relocate-Data
    Run-Checked $node @('--check','veo3_flow_new_ui.js')
    Run-Checked $node @('--check','agent_mode.js')
    Run-Checked $node @('--check','mcp_server.js')
    Write-Host ''
    Write-Host 'SETUP COMPLETE. Double-click START_GUI.bat.' -ForegroundColor Green
    Write-Host 'On the new laptop, use Accounts to open the browser and sign into Flow once for each account.'
} catch {
    Write-Host "SETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Stop-Transcript | Out-Null
    exit 1
}
Stop-Transcript | Out-Null
exit 0
