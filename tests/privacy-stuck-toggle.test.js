"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const stuckDetector = require("../stuck-detector");
const { GentleCheckIn, STAGES } = require("../gentle-checkin");

test("privacy-stuck-toggle: Stuck detection On/Off toggle completely stops state changes and check-ins", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "furry-privacy-test-"));
  const tmpSettingsPath = path.join(tmpDir, "settings.json");
  stuckDetector.setStoragePath(tmpSettingsPath);

  // Set initial state
  stuckDetector.setEnabled(true);
  assert.equal(stuckDetector.isEnabled(), true, "Should initially be enabled");

  // Track check-in bubbles
  let pawBubbleShown = false;
  let promptBubbleShown = false;
  let bubbleHidden = false;

  const gentleCheckIn = new GentleCheckIn({
    stuckDetector,
    onShowPawBubble: () => {
      pawBubbleShown = true;
    },
    onShowPromptBubble: () => {
      promptBubbleShown = true;
    },
    onHideBubble: () => {
      bubbleHidden = true;
    },
    isDemoMode: () => true,
  });

  await t.test("1. Turning detection off disables detector and resets state to active", () => {
    stuckDetector._setTestState({
      currentState: stuckDetector.STATES.STUCK,
      currentApp: "Code.exe",
      currentAppType: "work app",
    });

    let stateNotifications = [];
    const unsubscribe = stuckDetector.onStateChange((state, meta) => {
      stateNotifications.push({ state, meta });
    });

    stuckDetector.setEnabled(false);
    assert.equal(stuckDetector.isEnabled(), false, "Stuck detector should report disabled");
    assert.equal(stuckDetector.getState(), stuckDetector.STATES.ACTIVE, "State must reset to active immediately");
    assert.equal(gentleCheckIn.isEnabled(), false, "Gentle check-in should report disabled");

    unsubscribe();
  });

  await t.test("2. While disabled, stuck detector stops all state changes", () => {
    let stateChanges = [];
    const unsubscribe = stuckDetector.onStateChange((state) => {
      stateChanges.push(state);
    });

    // Simulate 30 minutes of complete inactivity in a work app
    const now = Date.now();
    stuckDetector._setTestState({
      currentState: stuckDetector.STATES.ACTIVE,
      lastActivityTime: now - 30 * 60 * 1000,
      lastKeyTime: now - 30 * 60 * 1000,
      currentApp: "Code.exe",
      currentAppType: "work app",
      isDemoMode: true,
    });

    // Attempt to evaluate state
    const changed = stuckDetector._evaluateState ? stuckDetector._evaluateState() : false;
    assert.equal(changed, false, "evaluateState must return false and not change state");
    assert.equal(stuckDetector.getState(), stuckDetector.STATES.ACTIVE, "State must remain active");
    assert.equal(stateChanges.length, 0, "No state change notifications should be dispatched");

    // Attempt manual modes while disabled
    stuckDetector.setWatchingMode(30);
    assert.equal(stuckDetector.getState(), stuckDetector.STATES.ACTIVE, "Cannot enter watching mode when disabled");

    stuckDetector.setThinkingMode(30);
    assert.equal(stuckDetector.getState(), stuckDetector.STATES.ACTIVE, "Cannot enter thinking mode when disabled");

    unsubscribe();
  });

  await t.test("3. While disabled, gentle check-in stops completely (no bubbles, no prompts)", () => {
    pawBubbleShown = false;
    promptBubbleShown = false;
    bubbleHidden = false;

    // Direct invocation of startPrompt while disabled must do nothing
    gentleCheckIn.startPrompt(true);
    assert.equal(pawBubbleShown, false, "Paw bubble must not show when detection is off");
    assert.equal(promptBubbleShown, false, "Prompt bubble must not show when detection is off");

    // Invoking handleStateChange with stuck state must be ignored
    gentleCheckIn.handleStateChange(stuckDetector.STATES.STUCK);
    assert.equal(pawBubbleShown, false, "handleStateChange(stuck) must not trigger paw bubble");
    assert.equal(promptBubbleShown, false, "handleStateChange(stuck) must not trigger prompt bubble");
    assert.equal(gentleCheckIn.currentStage, STAGES.NONE, "Stage must remain NONE");
  });

  await t.test("4. Turning detection on again restores normal stuck detection and check-ins", () => {
    stuckDetector.setEnabled(true);
    assert.equal(stuckDetector.isEnabled(), true, "Stuck detector should now be enabled");
    assert.equal(gentleCheckIn.isEnabled(), true, "Gentle check-in should now be enabled");

    let stateChanges = [];
    const unsubscribe = stuckDetector.onStateChange((state) => {
      stateChanges.push(state);
    });

    // In demo mode with work app and inactive for > 15s, state should transition to stuck
    const now = Date.now();
    stuckDetector._setTestState({
      currentState: stuckDetector.STATES.ACTIVE,
      lastActivityTime: now - 20 * 1000,
      lastKeyTime: now - 20 * 1000,
      currentApp: "Code.exe",
      currentAppType: "work app",
      isDemoMode: true,
    });

    const changed = stuckDetector._evaluateState ? stuckDetector._evaluateState() : false;
    assert.equal(changed, true, "evaluateState should detect state change when enabled");
    assert.equal(stuckDetector.getState(), stuckDetector.STATES.MAYBE_STUCK, "State should become maybe_stuck");
    assert.ok(stateChanges.includes(stuckDetector.STATES.MAYBE_STUCK), "State listener received maybe_stuck state");

    // Verify gentle check-in triggers when enabled
    pawBubbleShown = false;
    promptBubbleShown = false;
    gentleCheckIn.handleStateChange(stuckDetector.STATES.MAYBE_STUCK);
    assert.equal(promptBubbleShown, true, "Gentle check-in prompt must show when enabled");

    unsubscribe();
  });

  await t.test("5. Setting is persisted locally and survives application restart", () => {
    // Turn off and verify file is written
    stuckDetector.setEnabled(false);
    assert.equal(fs.existsSync(tmpSettingsPath), true, "settings.json should exist");

    const saved = JSON.parse(fs.readFileSync(tmpSettingsPath, "utf8"));
    assert.equal(saved.stuckDetectionEnabled, false, "Saved settings should record stuckDetectionEnabled: false");

    // Simulate restart: set memory variable to true, then call setStoragePath/loadSettings
    stuckDetector.setEnabled(true, false); // do not overwrite disk
    assert.equal(stuckDetector.isEnabled(), true, "Temporarily true in memory");

    // Now reload from disk as on app startup
    stuckDetector.setStoragePath(tmpSettingsPath);
    assert.equal(stuckDetector.isEnabled(), false, "Must restore stuckDetectionEnabled: false from disk after restart");

    // Turn back on and verify disk updates
    stuckDetector.setEnabled(true);
    const savedAfterOn = JSON.parse(fs.readFileSync(tmpSettingsPath, "utf8"));
    assert.equal(savedAfterOn.stuckDetectionEnabled, true, "Saved settings should record stuckDetectionEnabled: true");

    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });
});
