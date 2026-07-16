!macro customInstall
  DetailPrint "Installing Lfcode CLI shims"
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i("ELECTRON_RUN_AS_NODE", "1").r0'
  ${if} $installMode == "all"
    nsExec::ExecToLog '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\cli\install-cli.cjs" install --scope machine --binary "$INSTDIR\resources\cli\lfcode.exe"'
  ${else}
    nsExec::ExecToLog '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\cli\install-cli.cjs" install --scope user --binary "$INSTDIR\resources\cli\lfcode.exe"'
  ${endIf}
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i("ELECTRON_RUN_AS_NODE", "").r0'
!macroend

!macro customUnInstall
  DetailPrint "Removing Lfcode CLI shims"
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i("ELECTRON_RUN_AS_NODE", "1").r0'
  ${if} $installMode == "all"
    nsExec::ExecToLog '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\cli\install-cli.cjs" uninstall --scope machine'
  ${else}
    nsExec::ExecToLog '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\cli\install-cli.cjs" uninstall --scope user'
  ${endIf}
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i("ELECTRON_RUN_AS_NODE", "").r0'
!macroend
