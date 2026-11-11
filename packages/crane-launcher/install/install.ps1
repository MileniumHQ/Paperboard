# Installs Paperboard on Windows. In PowerShell:
#
#   irm https://i.paperboard.dev | iex
#
# `npx @mileniumhq/paperboard install` and `npm install -g @mileniumhq/paperboard`
# run this same file (packages/crane-launcher/install/install.ps1; Origami
# serves it at i.paperboard.dev). install.sh is the Linux and macOS half.
#
# It runs Paperboard's own installer silently, for this account only, into
# %LOCALAPPDATA%\Programs\paperboard\paperboard.exe (where the launcher,
# packages/crane-launcher/src/app.ts, looks for it). The download is checked
# against the release's SHA256SUMS before it runs.
#
# Errors are thrown, never `exit`: piped into iex, exit would close the
# person's PowerShell window along with the message.

& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $base = if ($env:PAPERBOARD_DOWNLOADS) { $env:PAPERBOARD_DOWNLOADS } else { 'https://i.paperboard.dev/pb' }
    $file = 'paperboard-windows-x64-setup.exe'

    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'Paperboard was not installed: it needs 64-bit Windows.'
    }

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("paperboard-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        Write-Host "Downloading Paperboard ($file)..."
        $sumsFile = Join-Path $tmp 'SHA256SUMS'
        try { Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sumsFile }
        catch { throw "Paperboard was not installed: could not download $base/SHA256SUMS ($($_.Exception.Message))" }
        $expected = $null
        foreach ($line in Get-Content $sumsFile) {
            $parts = $line -split '\s+', 2
            if ($parts.Count -eq 2 -and $parts[1] -eq $file) { $expected = $parts[0].ToLowerInvariant() }
        }
        if (-not $expected) { throw "Paperboard was not installed: the latest release has no $file." }

        $setup = Join-Path $tmp $file
        try { Invoke-WebRequest -UseBasicParsing -Uri "$base/latest/$file" -OutFile $setup }
        catch { throw "Paperboard was not installed: could not download $base/latest/$file ($($_.Exception.Message))" }
        $actual = (Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            throw "Paperboard was not installed: the download doesn't match its checksum (expected $expected, got $actual)."
        }

        Write-Host 'Installing...'
        $run = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
        if ($run.ExitCode -ne 0) { throw "Paperboard was not installed: its installer stopped with code $($run.ExitCode)." }
        $exe = Join-Path $env:LOCALAPPDATA 'Programs\paperboard\paperboard.exe'
        if (-not (Test-Path $exe)) { throw "Paperboard was not installed: its installer finished, but $exe isn't there." }
        Write-Host 'Paperboard is installed. Open it from the Start menu.'
    }
    finally {
        try { Remove-Item -Recurse -Force -Path $tmp }
        catch { Write-Warning "Couldn't remove the download folder $tmp ($($_.Exception.Message))." }
    }
}
