; Custom NSIS install hooks for Folio.
;
; Tauri's built-in file-association macro (APP_ASSOCIATE, in FileAssociation.nsh)
; always points a file type's DefaultIcon at the app's own executable:
;   "$INSTDIR\${MAINBINARYNAME}.exe,0"
; There is no tauri.conf.json option to change that per association (open
; feature request: https://github.com/tauri-apps/tauri/issues/13302), so this
; hook runs right after the default install section and overwrites the
; DefaultIcon value for the "Folio.pdf" ProgID with our own icon instead.
;
; pdf-file-icon.ico is copied into $INSTDIR via bundle.resources in
; tauri.conf.json, so it sits right next to Folio.exe after install.
;
; SHCTX already resolves to the correct hive (HKCU\Software\Classes for
; installMode "currentUser", HKLM\Software\Classes for "perMachine") because
; it was set earlier in the same install section - same hive the default
; association registration itself used, so this stays correct either way.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\Folio.pdf\DefaultIcon" "" "$INSTDIR\pdf-file-icon.ico,0"

  ; Windows can keep a user's existing default-app choice under the generic
  ; Applications\folio.exe ProgID instead of Folio.pdf. Keep that registration
  ; pointed at the installed binary and give it the same document icon so an
  ; upgrade from a development build does not retain the app icon for PDFs.
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$INSTDIR\pdf-file-icon.ico,0"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  ; Ask Explorer to drop its cached icon for this association so the change
  ; shows up without a logoff/reboot. System.dll ships with the NSIS build
  ; tauri-bundler uses, but if a build ever complains about a missing plugin,
  ; this line (only this line) can just be deleted - the icon will still be
  ; correct after the next Explorer restart or logon.
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove only the application registration owned by this installation.
  ReadRegStr $0 SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
    DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  ${EndIf}
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
