param(
    [string]$ShortcutPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'START_STUDIO.lnk'),
    [switch]$UpdateTarget,
    [switch]$IfNeeded
)
$ErrorActionPreference = 'Stop'
$studioRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$iconFile = Join-Path $studioRoot 'desktop_ui\studio.ico'
if (-not (Test-Path -LiteralPath $iconFile)) { throw 'Studio icon is missing. Update the repository first.' }
$shortcutShell = New-Object -ComObject WScript.Shell
$link = $shortcutShell.CreateShortcut($ShortcutPath)
if ($IfNeeded -and (Test-Path -LiteralPath $ShortcutPath)) {
    $iconMatches = $link.IconLocation -eq ($iconFile + ',0')
    $targetMatches = -not $UpdateTarget -or ($link.TargetPath -eq (Join-Path $studioRoot 'START_STUDIO.bat') -and $link.WorkingDirectory -eq $studioRoot)
    if ($iconMatches -and $targetMatches) { return }
}

if ($UpdateTarget -or -not (Test-Path -LiteralPath $ShortcutPath)) {
    $link.TargetPath = Join-Path $studioRoot 'START_STUDIO.bat'
    $link.WorkingDirectory = $studioRoot
    $link.Description = 'VEO3 Studio'
    $link.Arguments = ''
}
$link.IconLocation = $iconFile + ',0'
$link.Save()
if (-not ('StudioShortcutIconNotify' -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class StudioShortcutIconNotify {
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
    public static extern void SHChangeNotify(uint eventId, uint flags, string path, IntPtr unused);
}
"@
}
[StudioShortcutIconNotify]::SHChangeNotify(0x2000, 0x0005, $ShortcutPath, [IntPtr]::Zero)
Write-Host "Studio icon applied: $ShortcutPath"
