$ErrorActionPreference = 'Continue'
$D = 'D:\xiaopi\phpstudy_pro\Extensions\MySQL5.7.26'
$mysqld = "$D\bin\mysqld.exe"
$myini  = "$D\my.ini"

Write-Output "mysqld exists: $(Test-Path $mysqld)"
Write-Output "my.ini exists: $(Test-Path $myini)"

# 尝试直接前台同步运行 10 秒，捕获 stderr
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $mysqld
$psi.Arguments = "--defaults-file=`"$myini`""
$psi.UseShellExecute = $false
$psi.RedirectStandardError = $true
$psi.RedirectStandardOutput = $true
$psi.CreateNoWindow = $true
$p = [System.Diagnostics.Process]::Start($psi)
Write-Output "started pid=$($p.Id)"
Start-Sleep -Seconds 10
Write-Output "HasExited=$($p.HasExited)"
if ($p.HasExited) {
  Write-Output "exitcode=$($p.ExitCode)"
  Write-Output "--- stderr ---"
  Write-Output $p.StandardError.ReadToEnd()
} else {
  Write-Output "MYSQL RUNNING on pid=$($p.Id)"
}
