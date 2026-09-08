' GuangTi CaiWuJie hidden launcher: runs the guard bat with no window.
' Path-independent: uses this script's own folder as working directory.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run Chr(34) & shell.CurrentDirectory & "\start-guangti.bat" & Chr(34), 0, False
