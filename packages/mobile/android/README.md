# Lfcode Android companion

V1 Android companion for the desktop mobile gateway. It intentionally has no cloud relay or desktop-side filesystem access.

For a local debug build on this machine:

```powershell
$env:ANDROID_HOME='C:\Users\liangfeng\AppData\Local\Android\Sdk'
.\gradlew.bat :app:assembleDebug
```

The source checkout path contains Chinese characters. APK assembly works there, but current AGP unit-test workers cannot load test classes from that path even with `android.overridePathCheck=true`. Run unit tests through a temporary ASCII drive mapping, then remove it:

```powershell
subst M: 'C:\算法\小应用\知识库\10_Projects\Lfcode'
Push-Location M:\packages\mobile\android
$env:ANDROID_HOME='C:\Users\liangfeng\AppData\Local\Android\Sdk'
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
Pop-Location
subst M: /D
```

The gateway remains disabled until desktop-side pairing, TLS, and remote-access settings are enabled.
