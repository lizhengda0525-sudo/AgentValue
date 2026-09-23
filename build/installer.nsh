!macro preInit
  SetRegView 64
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 == ""
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\AgentValue\app"
  ${EndIf}
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customRemoveFiles
  FindFirst $R0 $R1 "$INSTDIR\*.*"
  IfErrors done
  loop:
    StrCmp $R1 "." next
    StrCmp $R1 ".." next
    StrCmp $R1 "data" next
    IfFileExists "$INSTDIR\$R1\*.*" 0 removeFile
      RMDir /r "$INSTDIR\$R1"
      Goto next
    removeFile:
      Delete "$INSTDIR\$R1"
    next:
      FindNext $R0 $R1
      IfErrors close
      Goto loop
  close:
    FindClose $R0
  done:
    RMDir "$INSTDIR"
!macroend
