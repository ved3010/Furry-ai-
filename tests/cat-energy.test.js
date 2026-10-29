"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  CatEnergy,
  ENERGY_LEVELS,
  DEFAULT_LEVEL,
  REUSE_DURATION_MS,
} = require("../cat-energy");

function createTempStorage() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-energy-test-"));
  const tmpFile = path.join(tmpDir, "settings.json");
  return {
    path: tmpFile,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

test("cat-energy: Saves chosen energy level and timestamp in local memory", () => {
  const storage = createTempStorage();
  try {
    let mockTime = 1000000;
    const catEnergy = new CatEnergy({
      storagePath: storage.path,
      timeProvider: () => mockTime,
    });

    assert.equal(catEnergy.hasRecentLevel(), false);
    assert.equal(catEnergy.shouldShowPicker(), true);

    // Save level 4 (Playful 🐱)
    const saved = catEnergy.save(4);
    assert.equal(saved, 4);
    assert.equal(catEnergy.getEnergyLevel(), 4);

    const record = catEnergy.getEnergyRecord();
    assert.deepEqual(record, { level: 4, timestamp: 1000000 });

    // Verify it was written to local settings file
    assert.ok(fs.existsSync(storage.path));
    const content = JSON.parse(fs.readFileSync(storage.path, "utf8"));
    assert.deepEqual(content.catEnergy, { level: 4, timestamp: 1000000 });

    // Verify loading from file in a new instance
    const freshInstance = new CatEnergy({
      storagePath: storage.path,
      timeProvider: () => mockTime,
    });
    assert.equal(freshInstance.getEnergyLevel(), 4);
    assert.equal(freshInstance.hasRecentLevel(), true);
  } finally {
    storage.cleanup();
  }
});

test("cat-energy: 2-hour reuse logic with mocked time", () => {
  const storage = createTempStorage();
  try {
    let currentTime = 100000000;
    const catEnergy = new CatEnergy({
      storagePath: storage.path,
      timeProvider: () => currentTime,
    });

    // Initial state: no level, show picker
    assert.equal(catEnergy.shouldShowPicker(), true);
    assert.equal(catEnergy.hasRecentLevel(), false);

    // User chooses level 5 (Zoomies ⚡) at t = 100000000
    catEnergy.save(5);
    assert.equal(catEnergy.getEnergyLevel(), 5);
    assert.equal(catEnergy.hasRecentLevel(), true);
    assert.equal(catEnergy.shouldShowPicker(), false);

    // Advance by 1 hour (3,600,000 ms) -> within 2 hours
    currentTime += 1 * 60 * 60 * 1000;
    assert.equal(catEnergy.hasRecentLevel(), true, "Should reuse level within 2 hours");
    assert.equal(catEnergy.shouldShowPicker(), false, "Picker must be skipped within 2 hours");
    assert.equal(catEnergy.getEnergyLevel(), 5, "Reuses level 5");

    // Advance by another 59 minutes (total 1 hour 59 mins) -> still within 2 hours
    currentTime += 59 * 60 * 1000;
    assert.equal(catEnergy.hasRecentLevel(), true, "Still valid at 1h 59m");
    assert.equal(catEnergy.shouldShowPicker(), false);

    // Advance by 2 minutes (total 2 hours 1 min > 2 hours) -> expired!
    currentTime += 2 * 60 * 1000;
    assert.equal(catEnergy.hasRecentLevel(), false, "Must expire after 2 hours");
    assert.equal(catEnergy.shouldShowPicker(), true, "Picker must be shown again after 2 hours");
  } finally {
    storage.cleanup();
  }
});

test("cat-energy: Skip option defaults to level 3 (Chill 😺) and saves with current time", () => {
  const storage = createTempStorage();
  try {
    let currentTime = 5000000;
    const catEnergy = new CatEnergy({
      storagePath: storage.path,
      timeProvider: () => currentTime,
    });

    let callbackFired = false;
    let chosenLevel = null;
    catEnergy.onEnergySelected((lvl) => {
      callbackFired = true;
      chosenLevel = lvl;
    });

    const level = catEnergy.skip();
    assert.equal(level, 3, "Skip must use default level 3");
    assert.equal(catEnergy.getEnergyLevel(), 3);
    assert.equal(callbackFired, true);
    assert.equal(chosenLevel, 3);

    const record = catEnergy.getEnergyRecord();
    assert.deepEqual(record, { level: 3, timestamp: 5000000 });

    const info = catEnergy.getEnergyInfo(3);
    assert.equal(info.name, "Chill");
    assert.equal(info.emoji, "😸");

    // Verification: within 2 hours after skipping, it is now recent
    assert.equal(catEnergy.hasRecentLevel(), true);
  } finally {
    storage.cleanup();
  }
});

test("cat-energy: onEnergySelected callback notifies subscribers", () => {
  const storage = createTempStorage();
  try {
    const catEnergy = new CatEnergy({ storagePath: storage.path });
    const received = [];

    const unsubscribe = catEnergy.onEnergySelected((lvl, info) => {
      received.push({ lvl, name: info.name });
    });

    catEnergy.save(1); // Loaf 🍞
    catEnergy.save(2); // Sleepy 😴

    assert.equal(received.length, 2);
    assert.deepEqual(received[0], { lvl: 1, name: "Loaf" });
    assert.deepEqual(received[1], { lvl: 2, name: "Sleepy" });

    unsubscribe();
    catEnergy.save(4);
    assert.equal(received.length, 2, "Unsubscribed listener should not receive updates");
  } finally {
    storage.cleanup();
  }
});

test("cat-energy: All 5 energy levels have valid names, emojis, and positive non-shame descriptions", () => {
  assert.equal(ENERGY_LEVELS.length, 5);
  const levels = ENERGY_LEVELS.map((e) => e.level);
  assert.deepEqual(levels, [1, 2, 3, 4, 5]);

  const shameWords = ["lazy", "bad", "slow", "fail", "procrastinat", "waste", "shame", "worthless"];
  for (const item of ENERGY_LEVELS) {
    assert.ok(item.name);
    assert.ok(item.emoji);
    assert.ok(item.subtitle);
    const combined = `${item.name} ${item.subtitle}`.toLowerCase();
    for (const shame of shameWords) {
      assert.equal(combined.includes(shame), false, `Level ${item.level} must not contain shame word '${shame}'`);
    }
  }
});

test("cat-energy: isTaskPrioritizationRequest detects task-related prompts", () => {
  const { isTaskPrioritizationRequest } = require("../cat-energy");
  assert.equal(isTaskPrioritizationRequest("tasks: finish homework, clean desk, buy milk"), true);
  assert.equal(isTaskPrioritizationRequest("here are my tasks: math, physics, coding"), true);
  assert.equal(isTaskPrioritizationRequest("can you prioritize my tasks?"), true);
  assert.equal(isTaskPrioritizationRequest("what should I do first?"), true);
  assert.equal(isTaskPrioritizationRequest("1. Finish report\n2. Call client\n3. Walk dog"), true);
  assert.equal(isTaskPrioritizationRequest("hello cat how are you"), false);
  assert.equal(isTaskPrioritizationRequest("play some music on spotify"), false);
});

test("cat-energy: prioritizeTasks tailors task order and tiny step to energy level", () => {
  const { prioritizeTasks } = require("../cat-energy");
  const taskPrompt = "tasks:\n- Write a comprehensive 50-page thesis document\n- Drink a glass of water\n- Clean the entire garage and organize tools";

  // Level 1: Loaf 💤 (ultra-low friction: easiest/shortest first)
  const loafResult = prioritizeTasks(taskPrompt, 1);
  assert.ok(loafResult.reply.includes("Loaf"));
  assert.ok(loafResult.reply.includes("💤"));
  assert.equal(loafResult.prioritized[0], "Drink a glass of water", "Loaf mode must pick the lowest friction task first");
  assert.ok(loafResult.strategy.tinyStep.includes("2 minutes"), "Loaf mode must suggest a 2-minute micro step");

  // Level 4: Playful ⚡ (high momentum: challenging task first)
  const playfulResult = prioritizeTasks(taskPrompt, 4);
  assert.ok(playfulResult.reply.includes("Playful"));
  assert.ok(playfulResult.reply.includes("⚡"));
  assert.equal(playfulResult.prioritized[0], "Write a comprehensive 50-page thesis document", "Playful mode must tackle the big challenge first");
  assert.ok(playfulResult.strategy.tinyStep.includes("power sprint") || playfulResult.strategy.tinyStep.includes("25-minute"));

  // Level 5: Zoomies 💨 (maximum speed & blitz)
  const zoomiesResult = prioritizeTasks(taskPrompt, 5);
  assert.ok(zoomiesResult.reply.includes("Zoomies"));
  assert.ok(zoomiesResult.reply.includes("💨"));
  assert.equal(zoomiesResult.prioritized[0], "Write a comprehensive 50-page thesis document");
  assert.ok(zoomiesResult.strategy.tinyStep.includes("challenge timer") || zoomiesResult.strategy.tinyStep.includes("15-minute"));
});

test("cat-energy: prioritizes student actual tasks without generic 'open file' placeholders", () => {
  const { isTaskPrioritizationRequest, prioritizeTasks } = require("../cat-energy");
  const studentInput = "finish math assignment 3, write history essay, chemistry lab report";

  assert.equal(isTaskPrioritizationRequest(studentInput), true);

  const result = prioritizeTasks(studentInput, 1);
  assert.equal(result.prioritized.length, 3);
  assert.ok(result.prioritized.includes("finish math assignment 3"));
  assert.ok(result.prioritized.includes("write history essay"));
  assert.ok(result.prioritized.includes("chemistry lab report"));

  // Check that reply contains actual tasks
  assert.ok(result.reply.includes("finish math assignment 3"));
  assert.ok(result.reply.includes("write history essay"));
  assert.ok(result.reply.includes("chemistry lab report"));

  // Crucial requirement: NEVER say generic "open file" or "open tab"
  assert.equal(result.reply.toLowerCase().includes("open file"), false);
  assert.equal(result.reply.toLowerCase().includes("open tab"), false);
  assert.equal(result.reply.toLowerCase().includes("opening or preparing"), false);

  // Must reference the actual student task in the tiny step
  assert.ok(result.strategy.tinyStep.includes(result.prioritized[0]));
});

test("cat-energy: sanitizes conversational clutter and emotional phrases, provides soothing response without repeating answered questions", () => {
  const { prioritizeTasks } = require("../cat-energy");
  const studentInput = "discrcte maths project review, tommorow i have operating system assesment, club web dev interview i am feelong s stressed";

  const result = prioritizeTasks(studentInput, 1); // Loaf Mode
  assert.equal(result.prioritized.length, 3);

  // 1. Task names must be clean, devoid of "tommorow i have" or "i am feelong s stressed"
  assert.equal(result.prioritized.some((t) => t.toLowerCase().includes("tommorow")), false, "Must strip 'tommorow i have'");
  assert.equal(result.prioritized.some((t) => t.toLowerCase().includes("feelong")), false, "Must strip 'feelong s stressed'");
  assert.equal(result.prioritized.some((t) => t.toLowerCase().includes("i am")), false, "Must strip 'i am feelong s stressed'");

  // 2. Acronyms & typos polished: "OS" or "Operating System assessment"
  assert.ok(result.prioritized.some((t) => /operating system assessment/i.test(t)), "Must have clean Operating System assessment");
  assert.ok(result.prioritized.some((t) => /club web dev interview/i.test(t)), "Must have clean Club Web Dev Interview");
  assert.ok(result.prioritized.some((t) => /discrete maths project review/i.test(t)), "Must have clean Discrete Maths Project Review");

  // 3. Soothing language for stressed/drained student
  assert.ok(result.reply.toLowerCase().includes("gentle") || result.reply.toLowerCase().includes("zero pressure") || result.reply.toLowerCase().includes("breath"));

  // 4. Do NOT ask repetitive questions about timing (user already mentioned tomorrow)
  assert.equal(result.reply.includes("Which of these is scheduled first"), false, "Must not ask about schedule when tomorrow is already stated");
});

