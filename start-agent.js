"use strict";

// The legacy voice listener is a Windows PowerShell process. On macOS it
// should fail quietly instead of emitting an unhandled spawn error that makes
// the cat look frozen. Text chat and the rest of the desktop pet do not depend
// on that listener.
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

// Load the agent sidecar before the existing desktop-pet process registers its
// own windows and IPC handlers. The agent communicates with the renderer over
// a loopback-only RPC endpoint so the existing minified preload can stay intact.
require("./agent-main");
require("./main.js");
