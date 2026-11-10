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
  ; Rename takes any file (it can rename by file name), so its entry is on every file type
  !insertmacro ${op} "*" "Vellova.Rename" "Rename with Vellova" "--rename"
  !insertmacro ${op} "Directory" "Vellova.Rename" "Rename with Vellova" "--rename"
  !insertmacro ${op} "SystemFileAssociations\.xlsx" "Vellova.Split" "Split with Vellova" "--split"
  !insertmacro ${op} "SystemFileAssociations\.xls" "Vellova.Split" "Split with Vellova" "--split"
  !insertmacro ${op} "SystemFileAssociations\.csv" "Vellova.Split" "Split with Vellova" "--split"
  !insertmacro ${op} "Directory" "Vellova.Split" "Split with Vellova" "--split"
!macroend

; Keys that versions up to 0.3.0 wrote for Rename, one per file type. An update removes them
; (the entry on every file replaces them, and both would show twice); so does an uninstall.
!macro VellovaRetired
  !insertmacro VellovaDel "SystemFileAssociations\.pdf" "Vellova.Rename" "" ""
  !insertmacro VellovaDel "SystemFileAssociations\.xlsx" "Vellova.Rename" "" ""
  !insertmacro VellovaDel "SystemFileAssociations\.csv" "Vellova.Rename" "" ""
  !insertmacro VellovaDel "SystemFileAssociations\.xml" "Vellova.Rename" "" ""
  !insertmacro VellovaDel "SystemFileAssociations\.txt" "Vellova.Rename" "" ""
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro VellovaRetired
  !insertmacro VellovaEach VellovaAdd
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro VellovaRetired
  !insertmacro VellovaEach VellovaDel
!macroend
