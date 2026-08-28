#!/bin/bash
# macOS desktop launcher for omp-web: double-click to start without a
# terminal window. Requires the ompweb package installed globally
# (npm install -g @37chengshan/ompweb). The plain `ompweb` CLI is unchanged.
set -e
cd "$(dirname "$0")/../.."

# Hide this Terminal window immediately (no black box).
osascript -e 'tell application "Terminal" to set visible of front window to false' >/dev/null 2>&1 || true

# Start the desktop launcher detached; it opens the browser itself.
nohup ompweb-desktop --port 30177 >/dev/null 2>&1 &
disown 2>/dev/null || true

# Show a notification so the user knows the app started.
osascript -e 'display notification "omp-web started — opening your browser" with title "omp-web"' >/dev/null 2>&1 || true
