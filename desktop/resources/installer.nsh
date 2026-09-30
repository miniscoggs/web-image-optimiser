; electron-builder's include for the windows installer. it lists the app in explorer's open with
; menu for each input format, through a progid of its own in the extension's OpenWithProgids,
; and leaves the format's default app alone. electron-builder's fileAssociations would also set
; the extension's default, and leave it naming a removed progid after an uninstall

!macro wioAssociate EXT NAME
  WriteRegStr SHELL_CONTEXT "Software\Classes\${APP_ID}.${EXT}" "" "${NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${APP_ID}.${EXT}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${APP_ID}.${EXT}\shell\open\command" "" '"$appExe" "%1"'
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${APP_ID}.${EXT}"
!macroend

!macro wioUnassociate EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${APP_ID}.${EXT}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${APP_ID}.${EXT}"
!macroend

!macro customInstall
  !insertmacro wioAssociate png "PNG image"
  !insertmacro wioAssociate jpg "JPEG image"
  !insertmacro wioAssociate jpeg "JPEG image"
  !insertmacro wioAssociate webp "WebP image"
  !insertmacro wioAssociate avif "AVIF image"
  !insertmacro wioAssociate svg "SVG image"
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)" ; SHCNE_ASSOCCHANGED, so explorer rereads them
!macroend

!macro customUnInstall
  !insertmacro wioUnassociate png
  !insertmacro wioUnassociate jpg
  !insertmacro wioUnassociate jpeg
  !insertmacro wioUnassociate webp
  !insertmacro wioUnassociate avif
  !insertmacro wioUnassociate svg
!macroend
