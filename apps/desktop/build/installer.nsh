; Installatore di Cuelith (decisione 0018).
;
; - La lingua scelta all'inizio (italiano o inglese) viene scritta in resources\install-lang.txt:
;   al primo avvio Cuelith parte in quella lingua. Dopo, vale la scelta fatta nelle Impostazioni.
; - Se Cuelith e' gia' installato la prima pagina lo dice: e' un aggiornamento, non una nuova
;   installazione. Cartella, collegamenti e impostazioni restano quelli di prima.

; Cambia il testo di un elemento della pagina di benvenuto (1201 titolo, 1202 testo).
!macro CuelithSetText ID TEXT
  FindWindow $R9 "#32770" "" $HWNDPARENT
  GetDlgItem $R8 $R9 ${ID}
  SendMessage $R8 ${WM_SETTEXT} 0 "STR:${TEXT}"
!macroend

; Era gia' installato? Si controlla all'avvio (anche nelle installazioni silenziose), in entrambe le
; sezioni del registro: l'installazione per l'utente e quella per tutti li' lasciano la cartella.
!ifndef BUILD_UNINSTALLER
  Var CuelithUpdate
!endif

!macro customInit
  StrCpy $CuelithUpdate ""
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
  ${If} $0 != ""
    StrCpy $CuelithUpdate "1"
  ${EndIf}
!macroend

!macro customInstall
  ; Scrive se e' un'installazione nuova o un aggiornamento (serve alle prove dell'installatore).
  FileOpen $1 "$INSTDIR\resources\install-kind.txt" w
  ${If} $CuelithUpdate == "1"
    FileWrite $1 "update"
  ${Else}
    FileWrite $1 "new"
  ${EndIf}
  FileClose $1
  ${If} $LANGUAGE == 1040
    FileOpen $0 "$INSTDIR\resources\install-lang.txt" w
    FileWrite $0 "it"
    FileClose $0
  ${Else}
    FileOpen $0 "$INSTDIR\resources\install-lang.txt" w
    FileWrite $0 "en"
    FileClose $0
  ${EndIf}
!macroend

!macro customWelcomePage
  Function CuelithWelcomeShow
    ${If} $CuelithUpdate == "1"
      ${If} $LANGUAGE == 1040
        !insertmacro CuelithSetText 1201 "Aggiornamento di ${PRODUCT_NAME}"
        !insertmacro CuelithSetText 1202 "${PRODUCT_NAME} è già installato su questo computer: questa procedura lo aggiorna alla versione ${VERSION}.$\r$\n$\r$\nI tuoi show, le impostazioni e i plugin restano dove sono. Chiudi ${PRODUCT_NAME} prima di continuare.$\r$\n$\r$\nFai clic su Avanti per continuare."
      ${Else}
        !insertmacro CuelithSetText 1201 "Updating ${PRODUCT_NAME}"
        !insertmacro CuelithSetText 1202 "${PRODUCT_NAME} is already installed on this computer: this will update it to version ${VERSION}.$\r$\n$\r$\nYour shows, settings and plugins stay where they are. Close ${PRODUCT_NAME} before you continue.$\r$\n$\r$\nClick Next to continue."
      ${EndIf}
    ${EndIf}
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW CuelithWelcomeShow
  !insertmacro MUI_PAGE_WELCOME
!macroend
