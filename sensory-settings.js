"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_SETTINGS = Object.freeze({
  quietMode: false,
  calmMotion: false,
  softColors: false,
});

class SensorySettings {
  constructor(options = {}) {
    this.customStoragePath = options.storagePath || null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.listeners = new Set();
    this.loadSettings();
  }

  getDefaultStoragePath() {
    if (this.customStoragePath) return this.customStoragePath;
    try {
      const electron = require("electron");
      const app = electron.app || electron.remote?.app;
      if (app && typeof app.getPath === "function") {
        return path.join(app.getPath("userData"), "settings.json");
      }
    } catch (_) {}

    const appData =
      process.env.APPDATA ||
      (process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : path.join(os.homedir(), ".config"));
    const furryPath = path.join(appData, "Furry Dev", "settings.json");
    if (fs.existsSync(furryPath)) return furryPath;
    const legacyPath = path.join(appData, "Comnyang Dev", "settings.json");
    if (fs.existsSync(legacyPath)) return legacyPath;
    return furryPath;
  }

  setStoragePath(filePath) {
    this.customStoragePath = filePath;
    this.loadSettings();
  }

  loadSettings() {
    try {
      const filePath = this.getDefaultStoragePath();
      if (filePath && fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        const json = JSON.parse(raw);
        if (json && typeof json === "object") {
          const sensory = json.sensorySettings && typeof json.sensorySettings === "object"
            ? json.sensorySettings
            : json;

          this.settings = {
            quietMode: typeof sensory.quietMode === "boolean" ? sensory.quietMode : DEFAULT_SETTINGS.quietMode,
            calmMotion: typeof sensory.calmMotion === "boolean" ? sensory.calmMotion : DEFAULT_SETTINGS.calmMotion,
            softColors: typeof sensory.softColors === "boolean" ? sensory.softColors : DEFAULT_SETTINGS.softColors,
          };
          return this.getSettings();
        }
      }
    } catch (e) {
      console.warn("[SensorySettings] Failed to load settings:", e?.message);
    }
    this.settings = { ...DEFAULT_SETTINGS };
    return this.getSettings();
  }

  saveSettings() {
    try {
      const filePath = this.getDefaultStoragePath();
      if (!filePath) return false;
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let existing = {};
      if (fs.existsSync(filePath)) {
        try {
          existing = JSON.parse(fs.readFileSync(filePath, "utf8")) || {};
        } catch (_) {}
      }

      // Store both top-level keys and nested sensorySettings for robust compatibility
      existing.quietMode = this.settings.quietMode;
      existing.calmMotion = this.settings.calmMotion;
      existing.softColors = this.settings.softColors;
      existing.sensorySettings = { ...this.settings };

      fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf8");
      return true;
    } catch (e) {
      console.warn("[SensorySettings] Failed to save settings:", e?.message);
      return false;
    }
  }

  getSettings() {
    return { ...this.settings };
  }

  isQuietMode() {
    return Boolean(this.settings.quietMode);
  }

  isCalmMotion() {
    return Boolean(this.settings.calmMotion);
  }

  isSoftColors() {
    return Boolean(this.settings.softColors);
  }

  updateSettings(updates = {}) {
    if (!updates || typeof updates !== "object") {
      return this.getSettings();
    }

    let changed = false;
    for (const key of ["quietMode", "calmMotion", "softColors"]) {
      if (typeof updates[key] === "boolean" && this.settings[key] !== updates[key]) {
        this.settings[key] = updates[key];
        changed = true;
      }
    }

    if (changed) {
      this.saveSettings();
      this.notifyListeners();
    }

    return this.getSettings();
  }

  onSettingsChange(callback) {
    if (typeof callback === "function") {
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }
    return () => {};
  }

  onChange(callback) {
    return this.onSettingsChange(callback);
  }

  setSettings(updates = {}) {
    return this.updateSettings(updates);
  }

  setQuietMode(val) {
    return this.updateSettings({ quietMode: Boolean(val) });
  }

  setCalmMotion(val) {
    return this.updateSettings({ calmMotion: Boolean(val) });
  }

  setSoftColors(val) {
    return this.updateSettings({ softColors: Boolean(val) });
  }

  notifyListeners() {
    const current = this.getSettings();
    for (const cb of this.listeners) {
      try {
        cb(current);
      } catch (err) {
        console.error("[SensorySettings] Listener error:", err);
      }
    }
  }

  resetForTesting() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.listeners.clear();
  }
}

const singleton = new SensorySettings();
singleton.SensorySettings = SensorySettings;
singleton.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

module.exports = singleton;
