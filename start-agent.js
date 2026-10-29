"use strict";

const fs = require("fs");
const path = require("path");

// Load .env automatically if present
try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (_) {}

const { app, BrowserWindow, screen } = require("electron");

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
        }
      }
    } catch (e) {
      console.error("[start-agent] failed to open editor:", e);
    }
  }, 1000);
});
