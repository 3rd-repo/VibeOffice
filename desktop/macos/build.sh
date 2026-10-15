#!/bin/sh
# The macOS release, built on a Mac (Xcode's command line tools; Rust with aarch64-apple-darwin and
# x86_64-apple-darwin): one universal binary, bundled as VibeOffice.app twice over, as the identities in the
# keychain allow (docs/desktop.md, macOS):
#   - none: the app signed ad hoc, for trying it on this Mac and the smoke run in CI;
#   - Developer ID Application: VibeOffice-macOS.dmg, signed, notarized and stapled
#     (needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH, an App Store Connect API key, for notarytool);
#   - Apple Distribution and Mac Installer Distribution: VibeOffice-macOS-AppStore.pkg for App Store Connect
#     (needs MACOS_PROVISION_PROFILE, the profile's path; APPLE_TEAM_ID if the identity's name doesn't carry it).
# The identities are found by name; MACOS_DEVELOPER_ID, MACOS_APPSTORE_ID and MACOS_INSTALLER_ID choose others.
# Output: desktop/target/dist/ (VibeOffice.app is the direct edition: ad hoc, or Developer ID once signed)
set -eu
cd "$(dirname "$0")/.."

# v2026.10.11-02d794 (tools/current-tree-version.sh) for the pages; the bundle's version is 2026.10.11, its build
# number the commit's UTC time (2026.1011.1530: numbers without leading zeros, rising with every commit)
VERSION=$(../tools/current-tree-version.sh)
SHORT=$(echo "$VERSION" | cut -c2-11 | awk -F. '{ printf "%d.%d.%d", $1, $2, $3 }')
BUILD=$(TZ=UTC git log -1 --format=%cd --date=format-local:'%Y %m%d %H%M' | awk '{ printf "%d.%d.%d", $1, $2, $3 }')
DIST=target/dist

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  VO_VERSION=$VERSION TAURI_CONFIG="{\"version\":\"$SHORT\"}" cargo build --release --locked --target $target
done
rm -rf "$DIST"
mkdir -p "$DIST"
lipo -create -output target/vibeoffice-universal \
  target/aarch64-apple-darwin/release/vibeoffice target/x86_64-apple-darwin/release/vibeoffice

# bundle <folder> <appstore|direct>: VibeOffice.app in it
bundle() {
  app="$1/VibeOffice.app"
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp target/vibeoffice-universal "$app/Contents/MacOS/vibeoffice"
  cp icons/icon.icns "$app/Contents/Resources/icon.icns"
  sed -e "s/@VERSION@/$SHORT/" -e "s/@BUILD@/$BUILD/" -e "s/@DISTRIBUTION@/$2/" macos/Info.plist > "$app/Contents/Info.plist"
  plutil -lint "$app/Contents/Info.plist" > /dev/null
  printf 'APPL????' > "$app/Contents/PkgInfo"
}

# the first identity in the keychains whose name starts with one of the given prefixes
identity() {
  security find-identity -v | sed -n 's/^ *[0-9]*) [0-9A-F]* "\(.*\)"$/\1/p' | while read -r name; do
    for prefix in "$@"; do
      case $name in "$prefix"*) echo "$name"; exit 0 ;; esac
    done
  done | head -1
}
DEVELOPER_ID=${MACOS_DEVELOPER_ID:-$(identity 'Developer ID Application: ')}
APPSTORE_ID=${MACOS_APPSTORE_ID:-$(identity 'Apple Distribution: ' '3rd Party Mac Developer Application: ')}
INSTALLER_ID=${MACOS_INSTALLER_ID:-$(identity 'Mac Installer Distribution: ' '3rd Party Mac Developer Installer: ')}

# The direct edition: the DMG
bundle "$DIST" direct
APP="$DIST/VibeOffice.app"
if [ -z "$DEVELOPER_ID" ]; then
  echo "No Developer ID Application identity: VibeOffice.app is signed ad hoc, no DMG" >&2
  codesign --force --sign - --entitlements macos/direct.entitlements "$APP"
else
  codesign --force --timestamp --options runtime --entitlements macos/direct.entitlements --sign "$DEVELOPER_ID" "$APP"
  codesign --verify --strict --verbose=2 "$APP"
  DMG="$DIST/VibeOffice-macOS.dmg"   # one name for every version, as the Windows zip
  stage=$(mktemp -d)
  cp -R "$APP" "$stage/"
  ln -s /Applications "$stage/Applications"
  # hdiutil sometimes finds the new image busy on CI machines: try again
  n=0
  until hdiutil create -volname VibeOffice -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$DMG"; do
    n=$((n + 1))
    [ $n -lt 5 ] || exit 1
    sleep 5
  done
  rm -rf "$stage"
  codesign --force --timestamp --sign "$DEVELOPER_ID" "$DMG"
  : "${ASC_KEY_PATH:?the App Store Connect API key (.p8) to notarize with}" "${ASC_KEY_ID:?}" "${ASC_ISSUER_ID:?}"
  out=$(xcrun notarytool submit "$DMG" --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" \
    --wait --output-format json) || true
  echo "$out"
  status=$(echo "$out" | plutil -extract status raw -o - - 2> /dev/null || echo "no answer")
  if [ "$status" != Accepted ]; then
    echo "Notarization: $status" >&2
    xcrun notarytool log "$(echo "$out" | plutil -extract id raw -o - -)" \
      --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" >&2 || true
    exit 1
  fi
  xcrun stapler staple "$DMG"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"
fi

# The App Store edition: the installer package App Store Connect takes
if [ -n "$APPSTORE_ID" ] && [ -n "$INSTALLER_ID" ] && [ -n "${MACOS_PROVISION_PROFILE:-}" ]; then
  TEAM=${APPLE_TEAM_ID:-$(echo "$APPSTORE_ID" | sed -n 's/.*(\([A-Z0-9]*\))$/\1/p')}
  [ -n "$TEAM" ] || { echo "No team ID: set APPLE_TEAM_ID" >&2; exit 1; }
  bundle "$DIST/appstore" appstore
  STORE_APP="$DIST/appstore/VibeOffice.app"
  cp "$MACOS_PROVISION_PROFILE" "$STORE_APP/Contents/embedded.provisionprofile"
  sed "s/@TEAM@/$TEAM/g" macos/appstore.entitlements > target/appstore.entitlements
  codesign --force --timestamp --entitlements target/appstore.entitlements --sign "$APPSTORE_ID" "$STORE_APP"
  codesign --verify --strict --verbose=2 "$STORE_APP"
  productbuild --component "$STORE_APP" /Applications --sign "$INSTALLER_ID" "$DIST/VibeOffice-macOS-AppStore.pkg"
else
  echo "No App Store identities or provisioning profile: no App Store package" >&2
fi

ls -l "$DIST"
