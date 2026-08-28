' Windows desktop launcher for omp-web: double-click to start without a
' console window (WScript runs this with no visible window).
' Requires the ompweb package installed globally (npm install -g @37chengshan/ompweb).
' The plain `ompweb` CLI is unchanged.
Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
' 0 = hidden window; the desktop launcher opens the browser itself.
shell.Run "ompweb-desktop --port 30177", 0, False
