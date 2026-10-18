#!/bin/bash
# Inside a container of one Linux system (.github/workflows/linux.yml): first without WebKitGTK 4.1, where the AppImage
# must not start and must name this system's install command (AppRun); then, with WebKitGTK 4.1 installed, the smoke
# run (smoke.sh). Debian, Ubuntu and Fedora.
#   docker run --privileged -v <repository>:/repo:ro -v <folder>:/out <image> \
#     /repo/desktop/linux/on-system.sh /repo/desktop/target/dist/VibeOffice-Linux-x86_64.AppImage /out
set -eu
app=$1
out=$2
mkdir -p "$out"
export APPIMAGE_EXTRACT_AND_RUN=1   # a container has no FUSE

# bash alone until the packages are in: a bare system may lack sed, grep or awk
. /etc/os-release
case " $ID ${ID_LIKE:-} " in
  *" debian "* | *" ubuntu "*)
    expect="sudo apt install libwebkit2gtk-4.1-0"
    install() { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "$@" > /dev/null; }
    packages="libwebkit2gtk-4.1-0 xvfb x11-utils imagemagick fonts-dejavu-core" ;;
  *" fedora "*)
    expect="sudo dnf install webkit2gtk4.1"
    install() { dnf install -y -q "$@" > /dev/null; }
    packages="webkit2gtk4.1 xorg-x11-server-Xvfb xwininfo ImageMagick dejavu-sans-fonts util-linux" ;;
  *) echo "::error::not a system this checks: $ID"; exit 1 ;;
esac
echo "$PRETTY_NAME"

if "$app" > "$out/without-webkit.log" 2>&1; then
  echo "::error::the AppImage started without WebKitGTK 4.1"
  exit 1
fi
said=$(< "$out/without-webkit.log")
echo "$said"
[[ $said == *"$expect"* ]] || { echo "::error::without WebKitGTK 4.1 it didn't say: $expect"; exit 1; }

install $packages
exec "$(dirname "$0")/smoke.sh" "$app" "$out"
