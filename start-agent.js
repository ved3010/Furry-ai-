"use strict";

const { app, BrowserWindow, screen } = require("electron");
const path = require("path");

if (process.platform === "darwin") {
  const childProcess = require("child_process");
  const nativeSpawn = childProcess.spawn;
  childProcess.spawn = (command, args, options) => {
    if (String(command).toLowerCase() === "powershell.exe") {
      return nativeSpawn("/usr/bin/true", [], options);
    }
    return nativeSpawn(command, args, options);
  };
}

// Load sidecar & main desktop-pet logic
require("./agent-main");
require("./main.js");

app.whenReady().then(() => {
  setTimeout(() => {
    try {
      let editorWin = null;
      if (process.env.OPEN_EDITOR === "1") {
        // Create editor window if explicitly requested
        editorWin = new BrowserWindow({
          width: 900,
          height: 720,
          title: "Comnyang Dev - Desktop Companion & Pattern Editor",
          backgroundColor: "#1e1e1e",
          icon: path.join(__dirname, "assets", "comnyang-logo.png"),
          webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        editorWin.setMenu(null);
        editorWin.loadFile(path.join(__dirname, "editor", "index.html"));
        editorWin.show();
        editorWin.focus();
        editorWin.moveTop();
        console.log("[Comnyang] Editor window opened!");
      }

      // Also ensure the desktop pet has taskbar enabled and is centered
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed() && win !== editorWin) {
          try { win.setSkipTaskbar(false); } catch (_) {}
          try { win.show(); } catch (_) {}
          try { win.focus(); } catch (_) {}
          try { win.setAlwaysOnTop(true, "screen-saver"); } catch (_) {}
          try { win.webContents.send("cat-open-chat"); } catch (_) {}
        }
      }
    } catch (e) {
      console.error("[start-agent] failed to open editor:", e);
    }
  }, 1000);
});
