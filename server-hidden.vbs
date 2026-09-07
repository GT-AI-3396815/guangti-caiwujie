' 光体•财无界 静默启动器：登录 Windows 后在后台拉起服务守护脚本（无窗口）
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\Users\AW\ZCodeProject\guangti-qianwujie"
shell.Run Chr(34) & shell.CurrentDirectory & "\start-guangti.bat" & Chr(34), 0, False
