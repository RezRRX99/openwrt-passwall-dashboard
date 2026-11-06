#!/bin/bash
# Builds the Android app into www/dash/router-dashboard.apk.
#
#   ANDROID_HOME=/path/to/sdk bash android/build.sh
#
# Needs the Android SDK (build-tools and one platform) and a JDK. Runs on Linux, macOS and Git
# Bash on Windows. The first run makes a signing key in ~/.android, outside this repo. Android
# refuses an update signed with another key, so keep that file: without it, a new build means
# uninstalling the app first.

set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)

# Git Bash runs Windows tools, which need Windows paths.
native() {
	if command -v cygpath >/dev/null; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

SDK=${ANDROID_HOME:?Set ANDROID_HOME to your Android SDK}
if command -v cygpath >/dev/null; then SDK=$(cygpath -u "$SDK"); fi
TOOLS=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
PLATFORM=$(ls -d "$SDK"/platforms/android-[0-9][0-9] | sort -V | tail -1)/android.jar
AAPT=$TOOLS/aapt2
ZIPALIGN=$TOOLS/zipalign
[ -f "$AAPT" ] || AAPT=$AAPT.exe
[ -f "$ZIPALIGN" ] || ZIPALIGN=$ZIPALIGN.exe
KEY=$HOME/.android/router-dash.jks
PASS=$HOME/.android/router-dash.pass
OUT=$ROOT/www/dash/router-dashboard.apk
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

if [ ! -f "$KEY" ]; then
	mkdir -p "$HOME/.android"
	openssl rand -hex 24 | tr -d '\r\n' > "$PASS"
	chmod 600 "$PASS"
	keytool -genkeypair -keystore "$KEY" -storepass "$(cat "$PASS")" -alias router -keyalg EC -groupname secp256r1 \
		-validity 10000 -dname 'CN=Router Dashboard' 2>/dev/null
fi

mkdir "$WORK/res" "$WORK/classes"
cp -r "$ROOT/android/res/." "$WORK/res/"
mkdir -p "$WORK/res/drawable-nodpi" "$WORK/res/mipmap-nodpi"
cp "$ROOT/www/dash/icon-maskable.png" "$WORK/res/drawable-nodpi/ic_foreground.png"
cp "$ROOT/www/dash/icon-192.png" "$WORK/res/mipmap-nodpi/ic_launcher.png"

cd "$WORK"
"$AAPT" compile --dir res -o res.zip
"$AAPT" link -o app.apk -I "$(native "$PLATFORM")" --manifest "$(native "$ROOT/android/AndroidManifest.xml")" res.zip
javac -encoding UTF-8 --release 8 -Xlint:-options -classpath "$(native "$PLATFORM")" -d classes "$(native "$ROOT/android/src/com/routerdash/MainActivity.java")"
java -cp "$(native "$TOOLS/lib/d8.jar")" com.android.tools.r8.D8 --release --min-api 24 --lib "$(native "$PLATFORM")" --output . $(find classes -name '*.class')
if command -v zip >/dev/null; then
	zip -q app.apk classes.dex
else
	powershell.exe -NoProfile -Command "Add-Type -A System.IO.Compression.FileSystem; \$z=[IO.Compression.ZipFile]::Open('app.apk','Update'); [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(\$z,'classes.dex','classes.dex'); \$z.Dispose()"
fi
"$ZIPALIGN" -f 4 app.apk aligned.apk
java -jar "$(native "$TOOLS/lib/apksigner.jar")" sign --ks "$(native "$KEY")" --ks-pass "pass:$(cat "$PASS")" --out "$(native "$OUT")" aligned.apk
rm -f "$OUT.idsig"
ls -la "$OUT"
