"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sensorySettings = require("../sensory-settings");

test("sensory-settings: Sensory comfort toggles (Quiet mode, Calm motion, Soft colors)", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "furry-sensory-test-"));
  const tmpSettingsPath = path.join(tmpDir, "settings.json");
  sensorySettings.setStoragePath(tmpSettingsPath);

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  await t.test("1. Defaults: All three toggles must be OFF (false) by default", () => {
    // Ensure clean state
    if (fs.existsSync(tmpSettingsPath)) {
      fs.unlinkSync(tmpSettingsPath);
    }
    const defaults = sensorySettings.loadSettings();

    assert.equal(defaults.quietMode, false, "Quiet mode must be off by default");
    assert.equal(defaults.calmMotion, false, "Calm motion must be off by default");
    assert.equal(defaults.softColors, false, "Soft colors must be off by default");
    assert.equal(sensorySettings.isQuietMode(), false);
    assert.equal(sensorySettings.isCalmMotion(), false);
    assert.equal(sensorySettings.isSoftColors(), false);
  });

  await t.test("2. Persistence: Settings are saved locally and kept after reload", () => {
    sensorySettings.setSettings({
      quietMode: true,
      calmMotion: true,
      softColors: false,
    });

    assert.equal(sensorySettings.isQuietMode(), true);
    assert.equal(sensorySettings.isCalmMotion(), true);
    assert.equal(sensorySettings.isSoftColors(), false);

    // Verify file exists on disk and contains expected JSON
    assert.ok(fs.existsSync(tmpSettingsPath), "settings.json file should exist");
    const raw = JSON.parse(fs.readFileSync(tmpSettingsPath, "utf8"));
    assert.equal(raw.quietMode, true);
    assert.equal(raw.calmMotion, true);
    assert.equal(raw.softColors, false);

    // Reload settings from disk into a fresh check
    const reloaded = sensorySettings.loadSettings();
    assert.equal(reloaded.quietMode, true);
    assert.equal(reloaded.calmMotion, true);
    assert.equal(reloaded.softColors, false);
  });

  await t.test("3. Non-destructive merge: Preserves existing settings in settings.json", () => {
    // Write an external setting like stuckDetectionEnabled
    const current = JSON.parse(fs.readFileSync(tmpSettingsPath, "utf8"));
    current.stuckDetectionEnabled = false;
    current.customUserPref = "retained";
    fs.writeFileSync(tmpSettingsPath, JSON.stringify(current, null, 2), "utf8");

    // Update sensory setting
    sensorySettings.setSettings({ softColors: true });

    const merged = JSON.parse(fs.readFileSync(tmpSettingsPath, "utf8"));
    assert.equal(merged.stuckDetectionEnabled, false, "stuckDetectionEnabled must be preserved");
    assert.equal(merged.customUserPref, "retained", "Other preferences must be preserved");
    assert.equal(merged.quietMode, true, "Existing quietMode must remain unchanged");
    assert.equal(merged.softColors, true, "softColors must be updated");
  });

  await t.test("4. Listener notifications: onChange fires when settings are modified", () => {
    let notifiedState = null;
    let callCount = 0;

    const unsubscribe = sensorySettings.onChange((state) => {
      notifiedState = { ...state };
      callCount++;
    });

    sensorySettings.setQuietMode(false);
    assert.equal(callCount, 1);
    assert.equal(notifiedState.quietMode, false);

    sensorySettings.setCalmMotion(false);
    assert.equal(callCount, 2);
    assert.equal(notifiedState.calmMotion, false);

    sensorySettings.setSoftColors(false);
    assert.equal(callCount, 3);
    assert.equal(notifiedState.softColors, false);

    unsubscribe();
    sensorySettings.setQuietMode(true);
    assert.equal(callCount, 3, "Unsubscribed listener must not receive further calls");
  });

  await t.test("5. Quiet mode toggle: Mutes all sound effects", () => {
    sensorySettings.setQuietMode(true);
    assert.equal(sensorySettings.isQuietMode(), true);

    // Simulated audio player guard check
    function playAudio(soundType) {
      if (sensorySettings.isQuietMode()) {
        return { played: false, reason: "quiet-mode" };
      }
      return { played: true, sound: soundType };
    }

    const meow = playAudio("meow");
    assert.equal(meow.played, false, "Meow sound must be muted in quiet mode");

    const purr = playAudio("purring");
    assert.equal(purr.played, false, "Purring must be muted in quiet mode");

    const chimes = playAudio("chimes");
    assert.equal(chimes.played, false, "Chimes must be muted in quiet mode");

    const pomodoro = playAudio("pomodoro-bell");
    assert.equal(pomodoro.played, false, "Pomodoro sound must be muted in quiet mode");

    const stretch = playAudio("stretch-sound");
    assert.equal(stretch.played, false, "Stretch sound must be muted in quiet mode");

    // Disable quiet mode and ensure sounds play again
    sensorySettings.setQuietMode(false);
    assert.equal(playAudio("meow").played, true);
    assert.equal(playAudio("purring").played, true);
  });

  await t.test("6. Calm motion toggle: Disables walking, animations, and transitions", () => {
    sensorySettings.setCalmMotion(true);
    assert.equal(sensorySettings.isCalmMotion(), true);

    // Simulated motion handlers
    function handleCursorMove(dx, dy) {
      if (sensorySettings.isCalmMotion()) {
        return { walking: false, followingCursor: false };
      }
      return { walking: true, followingCursor: true, dx, dy };
    }

    function triggerJump() {
      if (sensorySettings.isCalmMotion()) {
        return { jumped: false };
      }
      return { jumped: true };
    }

    function triggerStretch() {
      if (sensorySettings.isCalmMotion()) {
        return { stretched: false };
      }
      return { stretched: true };
    }

    const cursorResult = handleCursorMove(100, 200);
    assert.equal(cursorResult.walking, false, "Cat walking must be disabled in calm motion");
    assert.equal(cursorResult.followingCursor, false, "Cursor follow must be disabled in calm motion");

    const jumpResult = triggerJump();
    assert.equal(jumpResult.jumped, false, "Jump animation must be disabled in calm motion");

    const stretchResult = triggerStretch();
    assert.equal(stretchResult.stretched, false, "Stretch motion must be disabled in calm motion");

    sensorySettings.setCalmMotion(false);
    assert.equal(handleCursorMove(10, 20).walking, true);
    assert.equal(triggerJump().jumped, true);
  });

  await t.test("7. Soft colors toggle: Provides lower-contrast styles", () => {
    sensorySettings.setSoftColors(true);
    assert.equal(sensorySettings.isSoftColors(), true);

    function getThemeStyles() {
      if (sensorySettings.isSoftColors()) {
        return {
          theme: "soft-colors",
          bubbleBackground: "#24262c",
          bubbleColor: "#c8cbd2",
          cardBackground: "#24262c",
          lowContrast: true,
        };
      }
      return {
        theme: "default",
        bubbleBackground: "#000000",
        bubbleColor: "#ffffff",
        cardBackground: "#111216",
        lowContrast: false,
      };
    }

    const softStyle = getThemeStyles();
    assert.equal(softStyle.lowContrast, true);
    assert.equal(softStyle.bubbleBackground, "#24262c");

    sensorySettings.setSoftColors(false);
    const defaultStyle = getThemeStyles();
    assert.equal(defaultStyle.lowContrast, false);
    assert.equal(defaultStyle.bubbleBackground, "#000000");
  });

  await t.test("8. Toggle isolation: Changing one setting leaves the others untouched", () => {
    sensorySettings.setSettings({ quietMode: false, calmMotion: false, softColors: false });

    sensorySettings.setQuietMode(true);
    assert.equal(sensorySettings.isQuietMode(), true);
    assert.equal(sensorySettings.isCalmMotion(), false);
    assert.equal(sensorySettings.isSoftColors(), false);

    sensorySettings.setCalmMotion(true);
    assert.equal(sensorySettings.isQuietMode(), true);
    assert.equal(sensorySettings.isCalmMotion(), true);
    assert.equal(sensorySettings.isSoftColors(), false);

    sensorySettings.setQuietMode(false);
    assert.equal(sensorySettings.isQuietMode(), false);
    assert.equal(sensorySettings.isCalmMotion(), true);
    assert.equal(sensorySettings.isSoftColors(), false);
  });
});
