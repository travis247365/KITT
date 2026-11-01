#!/bin/sh
# One-time Xcode setup. Needs your Mac password, so run it yourself in Terminal:
#   sh ~/dev/kitt/scripts/xcode-first-run.sh
# (1) points the command line tools at Xcode, (2) accepts the Xcode licence, (3) installs the system components Xcode 27.1 needs
# (the installed CoreSimulator is older than this Xcode's, which is what currently breaks simulator and device-destination builds).
# Accepting the licence also un-breaks /usr/bin/git, gh and the python launchd jobs that died on the unaccepted licence.
set -e
X=/Applications/Xcode.app/Contents/Developer
[ -d "$X" ] || { echo "Xcode is not in /Applications"; exit 1; }
sudo xcode-select -s "$X"
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
if xcodebuild -checkFirstLaunchStatus; then echo; echo "Xcode is ready: $(xcodebuild -version | head -1)"; else echo "First-launch check still failing; paste this output to Claude."; exit 1; fi
