#!/bin/sh
# The Linux release (docs/desktop.md, Linux): VibeOffice-Linux-x86_64.AppImage. An AppImage is the AppImage project's
# runtime (a static program, pinned here by its checksum) followed by a squashfs of a folder: the app, AppRun (the
# check for WebKitGTK 4.1), the desktop entry and the icon. The app uses the system's WebKitGTK, GTK and libsoup;
# built on the oldest system it is for (Ubuntu 22.04, glibc 2.35: .github/workflows/linux.yml), it starts on every
# newer one. Needs: Rust, the development files of WebKitGTK 4.1, GTK 3 and libsoup 3 (libwebkit2gtk-4.1-dev),
# squashfs-tools, curl.
# Output: desktop/target/dist/VibeOffice-Linux-x86_64.AppImage
set -eu
cd "$(dirname "$0")/.."

# v2026.10.11-02d794 (tools/current-tree-version.sh): the pages show it, the release is tagged with it
VERSION=$(../tools/current-tree-version.sh)
y=$(echo "$VERSION" | cut -c2-5); m=$(echo "$VERSION" | cut -c7-8); d=$(echo "$VERSION" | cut -c10-11)
m=${m#0}; d=${d#0}
TARGET=x86_64-unknown-linux-gnu
WORK=target/linux
APPDIR=$WORK/AppDir
DIST=target/dist
OUT=$DIST/VibeOffice-Linux-x86_64.AppImage

VO_VERSION=$VERSION TAURI_CONFIG="{\"version\":\"$y.$m.$d\"}" CARGO_PROFILE_RELEASE_STRIP=symbols \
  cargo build --release --locked --target $TARGET

rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$DIST"
cp "target/$TARGET/release/vibeoffice" "$APPDIR/usr/bin/vibeoffice"
cp linux/AppRun "$APPDIR/AppRun"
chmod 755 "$APPDIR/AppRun" "$APPDIR/usr/bin/vibeoffice"
cp linux/vibeoffice.desktop "$APPDIR/vibeoffice.desktop"
cp ../public/icons/icon.svg "$APPDIR/vibeoffice.svg"
cp icons/icon.png "$APPDIR/.DirIcon"

# the runtime: github.com/AppImage/type2-runtime, release 20251108 (MIT; it has libfuse, squashfuse, zstd, zlib and
# musl inside: listed in the open source licenses, desktop/licenses/appimage-runtime.txt)
RUNTIME=$WORK/runtime-x86_64-20251108
RUNTIME_SHA256=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d
if ! echo "$RUNTIME_SHA256  $RUNTIME" | sha256sum -c --status 2> /dev/null; then
  curl -fsSL -o "$RUNTIME.part" https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64
  echo "$RUNTIME_SHA256  $RUNTIME.part" | sha256sum -c --status || { echo "the AppImage runtime's checksum doesn't match" >&2; exit 1; }
  mv "$RUNTIME.part" "$RUNTIME"
fi

rm -f "$WORK/app.squashfs"
mksquashfs "$APPDIR" "$WORK/app.squashfs" -all-root -noappend -comp zstd -quiet -no-progress
cat "$RUNTIME" "$WORK/app.squashfs" > "$OUT.part"
chmod 755 "$OUT.part"
mv "$OUT.part" "$OUT"
ls -l "$OUT"
