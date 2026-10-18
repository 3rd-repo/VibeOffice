# dmgbuild's settings for VibeOffice-macOS.dmg (desktop/macos/build.sh, docs/desktop.md): the app and an Applications
# link side by side on the background tools/dmg-background.mjs draws from these numbers (window_rect's size, the two
# icon_locations), with an arrow from one to the other and Scout pointing along it. Paths are from desktop/.
#   dmgbuild -s macos/dmg-settings.py -D app=target/dist/VibeOffice.app VibeOffice target/dist/VibeOffice-macOS.dmg
files = [defines['app']]
symlinks = {'Applications': '/Applications'}
hide_extensions = ['VibeOffice.app']
icon = 'icons/icon.icns'   # the volume's, on the desktop and in Finder's sidebar
format = 'UDZO'
filesystem = 'HFS+'

# background.png and background@2x.png, joined into one HiDPI TIFF by dmgbuild (tiffutil); Finder draws the icons'
# names in black on any background picture, in Dark Mode too, so the picture stays light under them
background = 'macos/dmg/background.png'
window_rect = ((200, 120), (660, 400))
icon_size = 128
text_size = 13
icon_locations = {'VibeOffice.app': (165, 170), 'Applications': (495, 170)}
