#!/bin/sh
# Builds and signs android/ClipFetch.apk (run from the android/ folder in Git Bash).
#
# Uses the JDK and Android SDK that Bubblewrap installs in ~/.bubblewrap.
# The keystore password is read from SIGNING-KEY-README.txt (never committed),
# or from the CF_KS_PASS environment variable.
#
# For an update: bump appVersionCode/appVersionName in twa-manifest.json and
# versionCode/versionName in app/build.gradle first.

set -e
cd "$(dirname "$0")"

export JAVA_HOME="${JAVA_HOME:-$HOME/.bubblewrap/jdk/jdk-17.0.11+9}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/.bubblewrap/android_sdk}"
BUILD_TOOLS="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"

if [ -z "$CF_KS_PASS" ]; then
  CF_KS_PASS=$(grep "Keystore password" SIGNING-KEY-README.txt | awk '{print $3}')
fi
export CF_KS_PASS

echo "Building..."
./gradlew.bat assembleRelease --no-daemon --console=plain -q "-Dorg.gradle.jvmargs=-Xmx768m"

echo "Signing..."
"$BUILD_TOOLS/zipalign.exe" -f -p 4 app/build/outputs/apk/release/app-release-unsigned.apk app-release-aligned.apk
"$JAVA_HOME/bin/java" -jar "$BUILD_TOOLS/lib/apksigner.jar" sign \
  --ks clipfetch-release.keystore --ks-key-alias clipfetch \
  --ks-pass env:CF_KS_PASS --key-pass env:CF_KS_PASS \
  --out ClipFetch.apk app-release-aligned.apk
rm -f app-release-aligned.apk ClipFetch.apk.idsig

"$JAVA_HOME/bin/java" -jar "$BUILD_TOOLS/lib/apksigner.jar" verify ClipFetch.apk
echo "Done: $(pwd)/ClipFetch.apk"
