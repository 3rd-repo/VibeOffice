#!/bin/bash
# The Linux smoke run (.github/workflows/linux.yml, on each system; by hand on a display): the AppImage alone, then a
# document, a workbook as CSV and Markdown handed to the running app as a file manager does (a second start, which
# gives its files to the first and exits: desktop/src/instance.rs), each in a window of its own, with a screenshot
# after each. It fails unless the Start Center and each file's window show up. Uses $DISPLAY, or starts Xvfb.
# Needs: xwininfo (x11-utils), ImageMagick's import; Xvfb without a display. Where there is no FUSE (a container),
# run it with APPIMAGE_EXTRACT_AND_RUN=1.
#   desktop/linux/smoke.sh <AppImage> <folder for the screenshots and logs>
set -eu
app=$(readlink -f "$1")
mkdir -p "$2"
out=$(cd "$2" && pwd)
root=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$out/files" "$out/home"
cp "$root/tests/quire/lines/linecases.docx" "$out/files/"
printf 'Item,Cost\nRent,900\nFood,250\n' > "$out/files/Budget.csv"
printf '# Notes\n\nHello from the smoke run.\n' > "$out/files/Notes.md"

xvfb=
if [ -z "${DISPLAY:-}" ]; then
  Xvfb :91 -screen 0 1400x900x24 -nolisten tcp > "$out/xvfb.log" 2>&1 &
  xvfb=$!
  export DISPLAY=:91
  sleep 2
fi
# its own Recent Files and instance socket (VIBEOFFICE_HOME); an extracted copy stays while another start runs from it
# (NO_CLEANUP); a display without a GPU draws in software
export VIBEOFFICE_HOME="$out/home" NO_CLEANUP=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 NO_AT_BRIDGE=1

titles() { xwininfo -root -tree 2> /dev/null | sed -n 's/^ *0x[0-9a-f]* "\(.*\)": (.*/\1/p'; }
# until a window's title has $1, at most $2 seconds
wait_for() {
  i=0
  while [ "$i" -lt "$2" ]; do
    titles | grep -qF "$1" && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}

status=0
setsid "$app" > "$out/app.log" 2>&1 &
first=$!
if wait_for "VibeOffice.work" 60; then sleep 4; else echo "::error::no Start Center window (app.log)"; status=1; fi
import -window root "$out/1-start-center.png"
n=2
for pair in linecases.docx:linecases Budget.csv:Budget Notes.md:Notes; do
  file=${pair%%:*}
  "$app" "$out/files/$file" >> "$out/second-starts.log" 2>&1 || true
  if wait_for "${pair#*:}" 45; then sleep 5; else echo "::error::no window for $file"; status=1; fi
  import -window root "$out/$n-$file.png"
  n=$((n + 1))
done
titles | sort -u > "$out/windows.txt"
kill -TERM -- "-$first" 2> /dev/null || kill "$first" 2> /dev/null || true   # setsid: the app and its web views
sleep 2
[ -n "$xvfb" ] && kill "$xvfb" 2> /dev/null
echo "== windows"; cat "$out/windows.txt"
echo "== app.log"; cat "$out/app.log"
exit $status
