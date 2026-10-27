; Explorer right-click entries, per user (installMode currentUser).
; One list drives both install and uninstall, and only these exact keys are ever removed.
; "Player" starts one process per selected file; the running app collects them.

!macro VellovaAdd base id label flag
  WriteRegStr HKCU "Software\Classes\${base}\shell\${id}" "MUIVerb" "${label}"
  WriteRegStr HKCU "Software\Classes\${base}\shell\${id}" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe"'
  WriteRegStr HKCU "Software\Classes\${base}\shell\${id}" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\${base}\shell\${id}\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" ${flag} "%1"'
!macroend

!macro VellovaDel base id label flag
  DeleteRegKey HKCU "Software\Classes\${base}\shell\${id}"
!macroend

!macro VellovaEach op
  !insertmacro ${op} "SystemFileAssociations\.pdf" "Vellova.Rename" "Rename with Vellova" "--rename"
  !insertmacro ${op} "SystemFileAssociations\.xlsx" "Vellova.Rename" "Rename with Vellova" "--rename"
  !insertmacro ${op} "SystemFileAssociations\.csv" "Vellova.Rename" "Rename with Vellova" "--rename"
  !insertmacro ${op} "SystemFileAssociations\.xml" "Vellova.Rename" "Rename with Vellova" "--rename"
  !insertmacro ${op} "SystemFileAssociations\.txt" "Vellova.Rename" "Rename with Vellova" "--rename"
  !insertmacro ${op} "Directory" "Vellova.Rename" "Rename with Vellova" "--rename"
  !insertmacro ${op} "SystemFileAssociations\.xlsx" "Vellova.Split" "Split with Vellova" "--split"
  !insertmacro ${op} "SystemFileAssociations\.xls" "Vellova.Split" "Split with Vellova" "--split"
  !insertmacro ${op} "SystemFileAssociations\.csv" "Vellova.Split" "Split with Vellova" "--split"
  !insertmacro ${op} "Directory" "Vellova.Split" "Split with Vellova" "--split"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro VellovaEach VellovaAdd
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro VellovaEach VellovaDel
!macroend
