**Windows** (x64): `VibeOffice-Windows-x64.zip` holds `VibeOfficeSetup.exe`, which installs VibeOffice for you, without administrator rights: desktop and Start menu shortcuts, Open with and Default apps for .docx, .xlsx and .pptx, and Uninstall in Apps & features. It needs the Microsoft Edge WebView2 runtime, which Windows 10 and 11 include.

**macOS** (13 Ventura or later, Apple silicon and Intel): open `VibeOffice-macOS.dmg` and drag VibeOffice to Applications. It is signed and notarized by Apple; .docx, .xlsx and .pptx files list it under Open With.

**Linux** (x86_64: Ubuntu 22.04 or later, Debian 12 or later, Fedora): `VibeOffice-Linux-x86_64.AppImage` runs without installing: allow it to run as a program (its Properties, or `chmod +x`) and open it. It uses the system's WebKitGTK 4.1, and says how to install it where it is missing (`sudo apt install libwebkit2gtk-4.1-0`, `sudo dnf install webkit2gtk4.1`).

A release may hold only some of these while the others are being built.
