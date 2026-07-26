; Stitch Manager NSIS installer script
; Build: makensis /DVERSION=1.0.0 installer.nsi

!ifndef VERSION
  !define VERSION "0.0.0-dev"
!endif

!define APP_NAME "Stitch Manager"
!define APP_EXE "stitch-backend.exe"
!define APP_DIR "$LOCALAPPDATA\Programs\StitchManager"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\StitchManager"

Name "${APP_NAME} ${VERSION}"
OutFile "stitch-setup-${VERSION}.exe"
InstallDir "${APP_DIR}"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "MUI2.nsh"

!define MUI_ICON "resources\icons\app-icon.ico"
!define MUI_UNICON "resources\icons\app-icon.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_NAME}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Russian"

Section "Install"
    SetOutPath "$INSTDIR"

    ; Close running instance
    nsExec::ExecToLog 'taskkill /F /IM ${APP_EXE} /T'
    Sleep 1000

    File "python\dist\${APP_EXE}"
    File /nonfatal "resources\icons\app-icon.ico"

    ; Shortcuts
    CreateDirectory "$SMPROGRAMS\${APP_NAME}"
    CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\app-icon.ico"
    CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\app-icon.ico"

    ; Autostart (optional, commented out by default)
    ; WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_NAME}" "$INSTDIR\${APP_EXE}"

    ; Uninstaller registration
    WriteUninstaller "$INSTDIR\uninstall.exe"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\app-icon.ico"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "WhiteBite"
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
    nsExec::ExecToLog 'taskkill /F /IM ${APP_EXE} /T'
    Sleep 1000

    Delete "$INSTDIR\${APP_EXE}"
    Delete "$INSTDIR\app-icon.ico"
    Delete "$INSTDIR\uninstall.exe"
    RMDir "$INSTDIR"

    Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
    RMDir "$SMPROGRAMS\${APP_NAME}"
    Delete "$DESKTOP\${APP_NAME}.lnk"

    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    ; NOTE: user data in %LOCALAPPDATA%\stitch-manager is preserved intentionally
SectionEnd
