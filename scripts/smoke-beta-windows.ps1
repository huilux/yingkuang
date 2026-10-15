$ErrorActionPreference = 'Stop'
$installer = (& node scripts/beta-release.mjs package windows-x64).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate installer' }
$installDir = Join-Path $env:RUNNER_TEMP 'yingkuang-beta-install'
if (Test-Path $installDir) { throw 'Use a fresh install directory' }
# NSIS requires /D to be the final argument. The runner's temporary path has no spaces.
if ($installDir.Contains(' ')) { throw 'NSIS smoke directory must not contain spaces' }
$setup = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "Installer failed: $($setup.ExitCode)" }
$app = Join-Path $installDir 'yingkuang.exe'
if (!(Test-Path $app)) { throw 'Installed executable missing' }
$previousBrowserArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
$process = Start-Process -FilePath $app -PassThru
try {
    $visible = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        $process.Refresh()
        if ($process.HasExited) { throw "Application exited during startup: $($process.ExitCode)" }
        if ($process.MainWindowHandle -ne 0 -and $process.MainWindowTitle -match '映框') { $visible = $true; break }
    }
    if (!$visible) { throw 'Native application window not observed' }
    & node scripts/check-installed-theme.mjs 'http://127.0.0.1:9223'
    if ($LASTEXITCODE -ne 0) { throw 'Installed WebView2 theme interaction check failed' }
} finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArgs
    if (!$process.HasExited) {
        $null = $process.CloseMainWindow()
        if (!$process.WaitForExit(10000)) { $process.Kill(); $process.WaitForExit() }
    }
}
# Verify the real installed resources before the uninstaller removes them.
@{ platform='windows-x64'; packageCheck='passed'; startup='passed'; method='NSIS silent installation, native window and WebView2 pointer/keyboard theme checks on Windows Server 2022'; installation='passed'; themeSwitching='passed'; themeChecks=(Get-Content test-output/beta-theme-windows-x64.json | ConvertFrom-Json); uninstall='pending'; interactiveAcceptance='pending' } | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8NoBOM test-output/beta-smoke-windows-x64.json
& node scripts/beta-release.mjs stage windows-x64 $installDir $env:GITHUB_SHA
if ($LASTEXITCODE -ne 0) { throw 'Installed license verification failed' }
$uninstaller = @(Get-ChildItem $installDir -Filter '*uninstall*.exe')
if ($uninstaller.Count -ne 1) { throw 'Expected one uninstaller' }
$remove = Start-Process -FilePath $uninstaller[0].FullName -ArgumentList '/S' -Wait -PassThru
if ($remove.ExitCode -ne 0) { throw "Uninstaller failed: $($remove.ExitCode)" }
for ($attempt = 0; $attempt -lt 30 -and (Test-Path $app); $attempt++) { Start-Sleep -Seconds 1 }
if (Test-Path $app) { throw 'Application executable remains after uninstall' }
$report = Get-Content test-output/beta-smoke-windows-x64.json | ConvertFrom-Json
$report.uninstall = 'passed'
$report | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8NoBOM test-output/beta-smoke-windows-x64.json
# Update the staged report after uninstall and recalculate its checksums.
$stagedReport = Get-ChildItem test-output/beta/windows-x64 -Filter '*_checks.json'
$checks = Get-Content $stagedReport.FullName | ConvertFrom-Json
$checks.uninstall = 'passed'
$checks | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8NoBOM $stagedReport.FullName
$hashes = Get-ChildItem test-output/beta/windows-x64 -File | Where-Object { $_.Name -notlike '*_SHA256SUMS.txt' } | Sort-Object Name | ForEach-Object { "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)" }
$sum = Get-ChildItem test-output/beta/windows-x64 -Filter '*_SHA256SUMS.txt'
$hashes | Set-Content -Encoding utf8NoBOM $sum.FullName
