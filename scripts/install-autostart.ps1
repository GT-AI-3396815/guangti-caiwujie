# GuangTi CaiWuJie - autostart installer (no admin required).
# 1) Registry Run key: launches the hidden guard at Windows logon.
# 2) Scheduled task (ONCE): lets you (re)start the service on demand via
#    schtasks /Run /TN "GuangTiCaiWuJie_Service" without a console window.
# Remove autostart:  reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v GuangTiCaiWuJie /f
# Remove task:       schtasks /Delete /TN "GuangTiCaiWuJie_Service" /F
$ErrorActionPreference = "Stop"
$scripts = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Split-Path -Parent $scripts

schtasks /Create /F /SC ONCE /ST 23:59 /TN "GuangTiCaiWuJie_Service" /TR "wscript.exe $project\server-hidden.vbs" | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "GuangTiCaiWuJie" -Value "wscript.exe $project\server-hidden.vbs"
Write-Host "[OK] autostart installed. Start now:  schtasks /Run /TN GuangTiCaiWuJie_Service"
