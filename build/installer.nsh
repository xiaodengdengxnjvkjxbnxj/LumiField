!ifndef MUI_BGCOLOR
  !define MUI_BGCOLOR "FFFFFF"
!endif
!ifndef MUI_TEXTCOLOR
  !define MUI_TEXTCOLOR "111217"
!endif
!ifndef MUI_DIRECTORYPAGE_BGCOLOR
  !define MUI_DIRECTORYPAGE_BGCOLOR "FFFFFF"
!endif
!ifndef MUI_DIRECTORYPAGE_TEXTCOLOR
  !define MUI_DIRECTORYPAGE_TEXTCOLOR "111217"
!endif
!ifndef MUI_INSTFILESPAGE_COLORS
  !define MUI_INSTFILESPAGE_COLORS "3257F7 FFFFFF"
!endif
!ifndef MUI_FINISHPAGE_LINK_COLOR
  !define MUI_FINISHPAGE_LINK_COLOR "3257F7"
!endif
!ifndef MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE
!endif
!ifndef MUI_HEADERIMAGE_BITMAP_STRETCH
  !define MUI_HEADERIMAGE_BITMAP_STRETCH "FitControl"
!endif
!ifndef MUI_HEADERIMAGE_UNBITMAP_STRETCH
  !define MUI_HEADERIMAGE_UNBITMAP_STRETCH "FitControl"
!endif
!ifndef BUILD_UNINSTALLER
  !ifndef MUI_CUSTOMFUNCTION_GUIINIT
    !define MUI_CUSTOMFUNCTION_GUIINIT LumiFieldGuiInit
  !endif
!endif

!include LogicLib.nsh
!include FileFunc.nsh
!include StdUtils.nsh
!include nsDialogs.nsh
!include WinMessages.nsh

!define LUMIFIELD_INSTALL_MARKER ".lumifield-install-root"

!ifndef BUILD_UNINSTALLER
  Var LumiFieldWelcomePage
  Var LumiFieldHeroFont
  Var LumiFieldTitleFont
  Var LumiFieldBodyFont
  Var LumiFieldSmallFont
  Var LumiFieldDirectoryPage
  Var LumiFieldDirectoryInput
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
    Call LumiFieldUsePreferredInstallDir
    Call LumiFieldDisableUnsafeOldUninstallers
    ${If} ${Silent}
      Call LumiFieldValidateInstallDir
    ${EndIf}
  !endif
!macroend

!macro customInstall
  FileOpen $0 "$INSTDIR\${LUMIFIELD_INSTALL_MARKER}" w
  ${IfNot} ${Errors}
    FileWrite $0 "LumiField install root$\r$\n"
    FileWrite $0 "appId=com.lumifield.desktop$\r$\n"
    FileClose $0
  ${EndIf}
!macroend

!macro customRemoveFiles
  Call un.LumiFieldRemoveInstalledFiles
!macroend

!macro customWelcomePage
  Page custom LumiFieldWelcomeShow
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customPageAfterChangeDir
  Page custom LumiFieldDirectoryShow LumiFieldDirectoryLeave
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function LumiFieldFinishStartApp
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${Else}
        StrCpy $1 ""
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "LumiFieldFinishStartApp"
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW LumiFieldTintCommonControls
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
Function LumiFieldGuiInit
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i .r0'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4) i .r0'
  Call LumiFieldTintCommonControls
FunctionEnd

Function LumiFieldTintCommonControls
  SetCtlColors $HWNDPARENT "111217" "FFFFFF"

  GetDlgItem $0 $HWNDPARENT 1
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 2
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 3
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}

  GetDlgItem $0 $HWNDPARENT 1028
  ${If} $0 <> 0
    SetCtlColors $0 "4B5263" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1256
  ${If} $0 <> 0
    SetCtlColors $0 "4B5263" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1034
  ${If} $0 <> 0
    SetCtlColors $0 "" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1035
  ${If} $0 <> 0
    SetCtlColors $0 "" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1037
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1038
  ${If} $0 <> 0
    SetCtlColors $0 "4B5263" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1039
  ${If} $0 <> 0
    SetCtlColors $0 "" "FFFFFF"
  ${EndIf}

  FindWindow $0 "#32770" "" $HWNDPARENT
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"

    GetDlgItem $1 $0 1000
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1001
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1004
    ${If} $1 <> 0
      SetCtlColors $1 "3257F7" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1006
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1016
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1019
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1020
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1023
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1024
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1027
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1201
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1202
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1203
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1204
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function LumiFieldUsePreferredInstallDir
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/D=" $R1
  ${IfNot} ${Errors}
  ${AndIf} $R1 != ""
    StrCpy $INSTDIR "$R1"
  ${Else}
    Call LumiFieldUseRegisteredInstallDir
    Pop $R2
    ${If} $R2 != "1"
      Call LumiFieldUseFirstAvailableInstallDir
    ${EndIf}
  ${EndIf}
  Push "$INSTDIR"
  Call LumiFieldNormalizeInstallDir
  Pop $INSTDIR
FunctionEnd

Function LumiFieldUseFirstAvailableInstallDir
  IfFileExists "D:\*.*" driveD 0
  IfFileExists "E:\*.*" driveE 0
  IfFileExists "F:\*.*" driveF 0
  IfFileExists "G:\*.*" driveG 0
  IfFileExists "H:\*.*" driveH 0
  IfFileExists "I:\*.*" driveI 0
  IfFileExists "J:\*.*" driveJ 0
  IfFileExists "K:\*.*" driveK 0
  IfFileExists "L:\*.*" driveL 0
  IfFileExists "M:\*.*" driveM 0
  IfFileExists "N:\*.*" driveN 0
  IfFileExists "O:\*.*" driveO 0
  IfFileExists "P:\*.*" driveP 0
  IfFileExists "Q:\*.*" driveQ 0
  IfFileExists "R:\*.*" driveR 0
  IfFileExists "S:\*.*" driveS 0
  IfFileExists "T:\*.*" driveT 0
  IfFileExists "U:\*.*" driveU 0
  IfFileExists "V:\*.*" driveV 0
  IfFileExists "W:\*.*" driveW 0
  IfFileExists "X:\*.*" driveX 0
  IfFileExists "Y:\*.*" driveY 0
  IfFileExists "Z:\*.*" driveZ 0
  StrCpy $INSTDIR "C:\LumiField"
  Return

  driveD:
    StrCpy $INSTDIR "D:\LumiField"
    Return
  driveE:
    StrCpy $INSTDIR "E:\LumiField"
    Return
  driveF:
    StrCpy $INSTDIR "F:\LumiField"
    Return
  driveG:
    StrCpy $INSTDIR "G:\LumiField"
    Return
  driveH:
    StrCpy $INSTDIR "H:\LumiField"
    Return
  driveI:
    StrCpy $INSTDIR "I:\LumiField"
    Return
  driveJ:
    StrCpy $INSTDIR "J:\LumiField"
    Return
  driveK:
    StrCpy $INSTDIR "K:\LumiField"
    Return
  driveL:
    StrCpy $INSTDIR "L:\LumiField"
    Return
  driveM:
    StrCpy $INSTDIR "M:\LumiField"
    Return
  driveN:
    StrCpy $INSTDIR "N:\LumiField"
    Return
  driveO:
    StrCpy $INSTDIR "O:\LumiField"
    Return
  driveP:
    StrCpy $INSTDIR "P:\LumiField"
    Return
  driveQ:
    StrCpy $INSTDIR "Q:\LumiField"
    Return
  driveR:
    StrCpy $INSTDIR "R:\LumiField"
    Return
  driveS:
    StrCpy $INSTDIR "S:\LumiField"
    Return
  driveT:
    StrCpy $INSTDIR "T:\LumiField"
    Return
  driveU:
    StrCpy $INSTDIR "U:\LumiField"
    Return
  driveV:
    StrCpy $INSTDIR "V:\LumiField"
    Return
  driveW:
    StrCpy $INSTDIR "W:\LumiField"
    Return
  driveX:
    StrCpy $INSTDIR "X:\LumiField"
    Return
  driveY:
    StrCpy $INSTDIR "Y:\LumiField"
    Return
  driveZ:
    StrCpy $INSTDIR "Z:\LumiField"
    Return
FunctionEnd

Function LumiFieldHasPreferredInstallDrive
  IfFileExists "D:\*.*" hasPreferred 0
  IfFileExists "E:\*.*" hasPreferred 0
  IfFileExists "F:\*.*" hasPreferred 0
  IfFileExists "G:\*.*" hasPreferred 0
  IfFileExists "H:\*.*" hasPreferred 0
  IfFileExists "I:\*.*" hasPreferred 0
  IfFileExists "J:\*.*" hasPreferred 0
  IfFileExists "K:\*.*" hasPreferred 0
  IfFileExists "L:\*.*" hasPreferred 0
  IfFileExists "M:\*.*" hasPreferred 0
  IfFileExists "N:\*.*" hasPreferred 0
  IfFileExists "O:\*.*" hasPreferred 0
  IfFileExists "P:\*.*" hasPreferred 0
  IfFileExists "Q:\*.*" hasPreferred 0
  IfFileExists "R:\*.*" hasPreferred 0
  IfFileExists "S:\*.*" hasPreferred 0
  IfFileExists "T:\*.*" hasPreferred 0
  IfFileExists "U:\*.*" hasPreferred 0
  IfFileExists "V:\*.*" hasPreferred 0
  IfFileExists "W:\*.*" hasPreferred 0
  IfFileExists "X:\*.*" hasPreferred 0
  IfFileExists "Y:\*.*" hasPreferred 0
  IfFileExists "Z:\*.*" hasPreferred 0
  Push "0"
  Return

  hasPreferred:
    Push "1"
    Return
FunctionEnd

Function LumiFieldNormalizeInstallDir
  Exch $0
  Push "$0"
  Call LumiFieldTrimInstallDir
  Pop $0
  StrLen $1 "$0"
  ${If} $1 == 2
    StrCpy $2 "$0" 1 1
    ${If} $2 == ":"
      StrCpy $0 "$0\LumiField"
    ${EndIf}
  ${ElseIf} $1 == 3
    StrCpy $2 "$0" 1 1
    StrCpy $3 "$0" 1 2
    ${If} $2 == ":"
    ${AndIf} $3 == "\"
      StrCpy $0 "$0LumiField"
    ${EndIf}
  ${EndIf}

  StrLen $1 "$0"
  StrCpy $2 "$0" 10 -10
  ${If} $1 < 10
  ${OrIf} $2 != "\LumiField"
  ${AndIf} $2 != "\lumifield"
    StrCpy $0 "$0\LumiField"
  ${EndIf}
  Exch $0
FunctionEnd

Function LumiFieldTrimInstallDir
  Exch $0

  trim:
    StrLen $1 "$0"
    ${If} $1 > 3
      StrCpy $2 "$0" 1 -1
      ${If} $2 == "\"
        StrCpy $0 "$0" -1
        Goto trim
      ${EndIf}
    ${EndIf}

  Exch $0
FunctionEnd

Function LumiFieldInstallDirLooksOwned
  Exch $0
  StrCpy $1 "0"

  IfFileExists "$0\${LUMIFIELD_INSTALL_MARKER}" 0 +2
    StrCpy $1 "1"

  StrCpy $0 "$1"
  Exch $0
FunctionEnd

Function LumiFieldExistingInstallPathCanBeAdopted
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call LumiFieldTrimInstallDir
  Pop $2
  ${If} $2 == ""
    Goto done
  ${EndIf}

  Push "$2"
  Call LumiFieldNormalizeInstallDir
  Pop $3
  ${If} $2 != $3
    Goto done
  ${EndIf}

  IfFileExists "$2\*.*" 0 done
  IfFileExists "$2\${LUMIFIELD_INSTALL_MARKER}" adopt 0
  IfFileExists "$2\${PRODUCT_FILENAME}.exe" adopt 0
  IfFileExists "$2\resources\app.asar" adopt 0
  IfFileExists "$2\resources\app\package.json" adopt 0
  IfFileExists "$2\resources\app\server.js" adopt 0
  Goto done

  adopt:
    StrCpy $1 "1"

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function LumiFieldUseRegisteredInstallDir
  ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call LumiFieldExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call LumiFieldNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call LumiFieldExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call LumiFieldNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call LumiFieldExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call LumiFieldNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call LumiFieldExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call LumiFieldNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  Push "0"
FunctionEnd

Function LumiFieldRegisteredInstallDirCanBeAdopted
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call LumiFieldNormalizeInstallDir
  Pop $2

  ReadRegStr $3 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$3"
  Call LumiFieldExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call LumiFieldNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$3"
  Call LumiFieldExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call LumiFieldNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$3"
  Call LumiFieldExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call LumiFieldNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$3"
  Call LumiFieldExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call LumiFieldNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function LumiFieldInstallDirIsEmpty
  Exch $0
  FindFirst $1 $2 "$0\*.*"
  StrCpy $3 "1"

  loop:
    StrCmp $2 "" done
    StrCmp $2 "." next
    StrCmp $2 ".." next
    StrCpy $3 "0"
    Goto done

  next:
    FindNext $1 $2
    Goto loop

  done:
    FindClose $1
    StrCpy $0 "$3"
    Exch $0
FunctionEnd

Function LumiFieldOldInstallPathNeedsQuarantine
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call LumiFieldTrimInstallDir
  Pop $2
  Push "$2"
  Call LumiFieldNormalizeInstallDir
  Pop $3

  ${If} $2 != $3
    StrCpy $1 "1"
    Goto done
  ${EndIf}

  IfFileExists "$2\${LUMIFIELD_INSTALL_MARKER}" done 0
  Push "$2"
  Call LumiFieldExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Goto done
  ${EndIf}

  StrCpy $1 "1"

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function LumiFieldDisableUnsafeOldUninstallers
  StrCpy $2 "0"

  ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call LumiFieldDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call LumiFieldOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy LumiField uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call LumiFieldDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call LumiFieldOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy LumiField uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ${If} $2 == "1"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    DeleteRegKey HKCU "Software\${APP_GUID}"
  ${EndIf}

  StrCpy $2 "0"

  ReadRegStr $0 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call LumiFieldDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call LumiFieldOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy LumiField uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call LumiFieldDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call LumiFieldOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy LumiField uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ${If} $2 == "1"
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    DeleteRegKey HKLM "Software\${APP_GUID}"
  ${EndIf}
FunctionEnd

Function LumiFieldDeleteLegacyUninstallerFileIfMissingMarker
  Pop $0
  ${If} $0 != ""
    Push "$0"
    Call LumiFieldTrimInstallDir
    Pop $1
    ${If} $1 != ""
      IfFileExists "$1\${LUMIFIELD_INSTALL_MARKER}" done 0
      DetailPrint "Remove legacy LumiField uninstaller file: $1"
      Delete "$1\Uninstall ${PRODUCT_FILENAME}.exe"
    ${EndIf}
  ${EndIf}

  done:
FunctionEnd

Function LumiFieldValidateInstallDir
  Push "$INSTDIR"
  Call LumiFieldNormalizeInstallDir
  Pop $INSTDIR

  Push "$INSTDIR"
  Call LumiFieldRegisteredInstallDirCanBeAdopted
  Pop $3

  Push "$INSTDIR"
  Call LumiFieldExistingInstallPathCanBeAdopted
  Pop $4

  StrCpy $0 "$INSTDIR" 1 0
  StrCpy $1 "$INSTDIR" 1 1
  ${If} $1 == ":"
    ${If} $0 == "C"
    ${OrIf} $0 == "c"
      Call LumiFieldHasPreferredInstallDrive
      Pop $2
      ${If} $2 == "1"
      ${AndIf} $3 != "1"
      ${AndIf} $4 != "1"
        MessageBox MB_ICONSTOP|MB_OK "检测到这台电脑还有 D-Z 盘，LumiField 不安装到 C 盘。请改选 D 盘或其它非 C 盘的 LumiField 文件夹。$\r$\n$\r$\n如果电脑只有 C 盘，安装器会自动放行 C:\LumiField。"
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}

  StrLen $0 "$INSTDIR"
  StrCpy $1 "$INSTDIR" 10 -10
  ${If} $0 < 10
  ${OrIf} $1 != "\LumiField"
  ${AndIf} $1 != "\lumifield"
    MessageBox MB_ICONSTOP|MB_OK "安装目录必须是独立的 LumiField 文件夹。请选择一个上级目录，安装器会自动创建 LumiField 子文件夹。"
    Abort
  ${EndIf}

  IfFileExists "$INSTDIR\*.*" 0 valid

  Push "$INSTDIR"
  Call LumiFieldInstallDirLooksOwned
  Pop $0
  ${If} $0 == "1"
    Goto valid
  ${EndIf}

  ${If} $3 == "1"
    Goto valid
  ${EndIf}

  ${If} $4 == "1"
    Goto valid
  ${EndIf}

  Push "$INSTDIR"
  Call LumiFieldInstallDirIsEmpty
  Pop $0
  ${If} $0 == "1"
    Goto valid
  ${EndIf}

  MessageBox MB_ICONSTOP|MB_OK "为避免卸载时误删其它文件，LumiField 不能安装到已有文件的非专属目录。请新建或选择一个空的 LumiField 文件夹。$\r$\n$\r$\n当前路径：$INSTDIR"
  Abort

  valid:
FunctionEnd
Function LumiFieldWelcomeShow
  Call LumiFieldUsePreferredInstallDir

  nsDialogs::Create 1018
  Pop $LumiFieldWelcomePage
  ${If} $LumiFieldWelcomePage == error
    Abort
  ${EndIf}

  SetCtlColors $LumiFieldWelcomePage "111217" "FFFFFF"
  CreateFont $LumiFieldHeroFont "Microsoft YaHei UI" 24 700
  CreateFont $LumiFieldTitleFont "Microsoft YaHei UI" 11 700
  CreateFont $LumiFieldBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $LumiFieldSmallFont "Microsoft YaHei UI" 8 400

  ${NSD_CreateLabel} 22u 20u 82u 10u "LUMIFIELD"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LumiFieldSmallFont 1
  SetCtlColors $0 "3257F7" "FFFFFF"

  ${NSD_CreateLabel} 22u 42u 226u 30u "LumiField 安装"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LumiFieldHeroFont 1
  SetCtlColors $0 "111217" "FFFFFF"

  ${NSD_CreateLabel} 22u 78u 36u 2u ""
  Pop $0
  SetCtlColors $0 "" "3257F7"

  ${NSD_CreateLabel} 22u 96u 238u 24u "为这台电脑安装 LumiField。默认安装到 D:\LumiField，下一步可以自由选择其它位置。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LumiFieldBodyFont 1
  SetCtlColors $0 "4B5263" "FFFFFF"

  ${NSD_CreateLabel} 22u 130u 238u 12u "默认位置：$INSTDIR"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LumiFieldTitleFont 1
  SetCtlColors $0 "3257F7" "FFFFFF"

  nsDialogs::Show
FunctionEnd

Function LumiFieldDirectoryBrowse
  nsDialogs::SelectFolderDialog "选择 LumiField 安装文件夹" "$INSTDIR"
  Pop $0
  ${If} $0 != error
  ${AndIf} $0 != ""
    Push "$0"
    Call LumiFieldNormalizeInstallDir
    Pop $0
    StrCpy $INSTDIR "$0"
    SendMessage $LumiFieldDirectoryInput ${WM_SETTEXT} 0 "STR:$INSTDIR"
  ${EndIf}
FunctionEnd

Function LumiFieldDirectoryShow
  Call LumiFieldUsePreferredInstallDir

  nsDialogs::Create 1018
  Pop $LumiFieldDirectoryPage
  ${If} $LumiFieldDirectoryPage == error
    Abort
  ${EndIf}

  SetCtlColors $LumiFieldDirectoryPage "111217" "FFFFFF"
  CreateFont $LumiFieldTitleFont "Microsoft YaHei UI" 15 700
  CreateFont $LumiFieldBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $LumiFieldSmallFont "Microsoft YaHei UI" 8 500

  ${NSD_CreateLabel} 22u 12u 238u 20u "选择安装位置"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LumiFieldTitleFont 1
  SetCtlColors $0 "111217" "FFFFFF"

  ${NSD_CreateLabel} 22u 40u 238u 24u "你可以使用默认路径，也可以选择其它磁盘或文件夹。安装器会自动创建缺失的目录。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LumiFieldBodyFont 1
  SetCtlColors $0 "4B5263" "FFFFFF"

  ${NSD_CreateLabel} 22u 76u 238u 10u "安装目录"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LumiFieldSmallFont 1
  SetCtlColors $0 "3257F7" "FFFFFF"

  ${NSD_CreateText} 22u 94u 178u 15u "$INSTDIR"
  Pop $LumiFieldDirectoryInput
  SendMessage $LumiFieldDirectoryInput ${WM_SETFONT} $LumiFieldBodyFont 1
  SetCtlColors $LumiFieldDirectoryInput "111217" "FFFFFF"

  ${NSD_CreateBrowseButton} 210u 93u 50u 17u "浏览..."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LumiFieldSmallFont 1
  ${NSD_OnClick} $0 LumiFieldDirectoryBrowse

  ${NSD_CreateLabel} 22u 122u 238u 12u "默认推荐：D:\LumiField；选盘符会自动建文件夹。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LumiFieldSmallFont 1
  SetCtlColors $0 "6B7280" "FFFFFF"

  nsDialogs::Show
FunctionEnd

Function LumiFieldDirectoryLeave
  ${NSD_GetText} $LumiFieldDirectoryInput $0
  ${If} $0 == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择安装文件夹。"
    Abort
  ${EndIf}
  Push "$0"
  Call LumiFieldNormalizeInstallDir
  Pop $0
  StrCpy $INSTDIR "$0"
  SendMessage $LumiFieldDirectoryInput ${WM_SETTEXT} 0 "STR:$INSTDIR"
  Call LumiFieldValidateInstallDir
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
!macro customUnInit
  Call un.LumiFieldValidateUninstallDir
!macroend

Function un.LumiFieldInstallDirLooksOwned
  Exch $0
  StrCpy $1 "0"

  IfFileExists "$0\${LUMIFIELD_INSTALL_MARKER}" 0 +2
    StrCpy $1 "1"

  StrCpy $0 "$1"
  Exch $0
FunctionEnd

Function un.LumiFieldNormalizeInstallDir
  Exch $0
  Push "$0"
  Call un.LumiFieldTrimInstallDir
  Pop $0
  StrLen $1 "$0"
  ${If} $1 == 2
    StrCpy $2 "$0" 1 1
    ${If} $2 == ":"
      StrCpy $0 "$0\LumiField"
    ${EndIf}
  ${ElseIf} $1 == 3
    StrCpy $2 "$0" 1 1
    StrCpy $3 "$0" 1 2
    ${If} $2 == ":"
    ${AndIf} $3 == "\"
      StrCpy $0 "$0LumiField"
    ${EndIf}
  ${EndIf}

  StrLen $1 "$0"
  StrCpy $2 "$0" 10 -10
  ${If} $1 < 10
  ${OrIf} $2 != "\LumiField"
  ${AndIf} $2 != "\lumifield"
    StrCpy $0 "$0\LumiField"
  ${EndIf}
  Exch $0
FunctionEnd

Function un.LumiFieldTrimInstallDir
  Exch $0

  trim:
    StrLen $1 "$0"
    ${If} $1 > 3
      StrCpy $2 "$0" 1 -1
      ${If} $2 == "\"
        StrCpy $0 "$0" -1
        Goto trim
      ${EndIf}
    ${EndIf}

  Exch $0
FunctionEnd

Function un.LumiFieldValidateUninstallDir
  Push "$INSTDIR"
  Call un.LumiFieldTrimInstallDir
  Pop $0
  Push "$0"
  Call un.LumiFieldNormalizeInstallDir
  Pop $1
  ${If} $0 != $1
    MessageBox MB_OK|MB_ICONSTOP "当前卸载路径不是 LumiField 专属目录，已阻止卸载以避免误删其它文件。$\r$\n$\r$\n当前路径：$INSTDIR$\r$\n安全路径应为：$0"
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $INSTDIR "$0"

  Push "$INSTDIR"
  Call un.LumiFieldInstallDirLooksOwned
  Pop $0
  ${If} $0 != "1"
    MessageBox MB_OK|MB_ICONSTOP "无法确认当前目录属于 LumiField，已阻止卸载以避免误删其它文件。$\r$\n$\r$\n当前路径：$INSTDIR"
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd

Function un.LumiFieldRemoveInstalledFiles
  SetOutPath $TEMP

  Delete "$INSTDIR\${PRODUCT_FILENAME}.exe"
  Delete "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe"
  Delete "$INSTDIR\uninstallerIcon.ico"

  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\dxcompiler.dll"
  Delete "$INSTDIR\dxil.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vulkan-1.dll"

  RMDir "$INSTDIR\locales"
  RMDir "$INSTDIR\resources"
  RMDir "$INSTDIR\swiftshader"

  RMDir "$INSTDIR"
FunctionEnd
!endif
