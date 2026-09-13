Option Explicit
Dim fso, appPath, appShell
Set fso = CreateObject("Scripting.FileSystemObject")
appPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "release\AgentVault-win32-x64\AgentVault.exe")
If fso.FileExists(appPath) Then
  Set appShell = CreateObject("WScript.Shell")
  appShell.Run Chr(34) & appPath & Chr(34), 1, False
Else
  MsgBox "AgentVault.exe is missing. Build the desktop package first. See README.md.", 48, "AgentVault"
End If
