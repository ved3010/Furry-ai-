"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TinyStepAI,
  COPING_LIBRARY,
  TELE_MANAS_HELPLINE,
  TELE_MANAS_MESSAGE,
  STEP_SIZE_GUIDE,
  DEFAULT_OFFLINE_STEPS,
  checkDistress,
  matchCopingTrick,
  buildTinyStepPrompt,
  sanitizeTinyStepResponse,
} = require("../tiny-step-ai");

test("TinyStepAI: Coping library has 12 to 15 short coping tricks with keywords", () => {
  assert.ok(COPING_LIBRARY.length >= 12 && COPING_LIBRARY.length <= 15, `Expected 12-15 tricks, got ${COPING_LIBRARY.length}`);
  for (const trick of COPING_LIBRARY) {
    assert.ok(typeof trick.name === "string" && trick.name.length > 0);
    assert.ok(typeof trick.tip === "string" && trick.tip.length > 0);
    assert.ok(Array.isArray(trick.keywords) && trick.keywords.length > 0);
  }
});

test("TinyStepAI: Keyword matching correctly selects appropriate trick (RAG)", () => {
  const essayMatch = matchCopingTrick("I have a huge history essay draft due tomorrow");
  assert.ok(essayMatch.name === "Write a bad first draft" || essayMatch.name === "Just open the file");

  const tiredMatch = matchCopingTrick("My eyes hurt and I am so dry and tired");
  assert.equal(tiredMatch.name, "Drink water & reset");

  const mathMatch = matchCopingTrick("Stuck on my calculus math homework problems");
  assert.equal(mathMatch.name, "Solve example or problem #1");
});

test("TinyStepAI: Privacy verification - prompt contains ONLY user text, energy level and matched trick", () => {
  const matched = matchCopingTrick("math homework");
  const messages = buildTinyStepPrompt({
    userText: "math homework",
    energyLevel: 3,
    matchedTrick: matched,
  });

  const system = messages[0].content;
  const user = messages[1].content;

  // Contains user text
  assert.equal(user, "math homework");
  // Contains level and trick
  assert.ok(system.includes("Level 3"));
  assert.ok(system.includes(matched.name));
  // Does NOT leak window titles, app names, or activity data
  assert.ok(!system.includes("Code.exe"));
  assert.ok(!system.includes("Spotify"));
  assert.ok(!system.includes("Chrome"));
  assert.ok(!system.includes("windowTitle"));
});

test("TinyStepAI: Safety rule - deep distress or self-harm triggers caring message with Tele-MANAS helpline 14416", async () => {
  const distressTexts = [
    "I want to end my life",
    "I feel like killing myself right now",
    "I can't take it anymore, feeling suicidal",
    "thinking about self harm",
  ];

  const ai = new TinyStepAI();

  for (const text of distressTexts) {
    assert.equal(checkDistress(text), true);
    const result = await ai.getTinyStep({ text, energyLevel: 3 });
    assert.equal(result.isSafetyResponse, true);
    assert.ok(result.step.includes("14416"));
    assert.ok(result.step.includes("Tele-MANAS"));
    assert.ok(!result.step.includes("task")); // No task step given
  }
});

test("TinyStepAI: One-step output and no shame words in response", async () => {
  const mockModelClient = {
    requestModel: async () => ({
      choices: [
        {
          message: {
            content: "You should not be lazy. Just open the math file and read question one.",
          },
        },
      ],
    }),
  };

  const ai = new TinyStepAI({
    modelClient: mockModelClient,
  });

  const result = await ai.getTinyStep({ text: "math homework", energyLevel: 3 });
  assert.equal(result.isSafetyResponse, false);

  // Check shame words 'lazy' and 'should' are stripped
  assert.ok(!result.step.toLowerCase().includes("lazy"));
  assert.ok(!result.step.toLowerCase().includes("should"));
  assert.ok(result.step.includes("open the math file"));
});

test("TinyStepAI: Step size by energy level (1 = 1m/rest, 2 = 2m, 3 = 5m, 4 = 10m, 5 = 15-20m)", () => {
  assert.ok(STEP_SIZE_GUIDE[1].includes("1 minute"));
  assert.ok(STEP_SIZE_GUIDE[2].includes("2 minutes"));
  assert.ok(STEP_SIZE_GUIDE[3].includes("5 minutes"));
  assert.ok(STEP_SIZE_GUIDE[4].includes("10 minutes"));
  assert.ok(STEP_SIZE_GUIDE[5].includes("15 to 20 minutes") || STEP_SIZE_GUIDE[5].includes("15-20"));
});

test("TinyStepAI: 'Make it smaller' option asks for an easier step", async () => {
  let receivedSmaller = false;
  const mockModelClient = {
    requestModel: async (params) => {
      const sys = params.messages[0].content;
      if (sys.includes("Make it smaller")) {
        receivedSmaller = true;
      }
      return {
        choices: [{ message: { content: "Just write down the very first digit on page 1." } }],
      };
    },
  };

  const ai = new TinyStepAI({
    modelClient: mockModelClient,
  });

  const result = await ai.getTinyStep({
    text: "calculus set",
    energyLevel: 3,
    isSmaller: true,
  });

  assert.equal(receivedSmaller, true);
  assert.equal(result.isSmaller, true);
  assert.ok(result.step.includes("first digit"));
});

test("TinyStepAI: Offline fallback works seamlessly when model call fails or has no internet", async () => {
  const failingClient = {
    requestModel: async () => {
      throw new Error("Network error: ERR_INTERNET_DISCONNECTED");
    },
  };

  const ai = new TinyStepAI({
    modelClient: failingClient,
  });

  for (let lvl = 1; lvl <= 5; lvl++) {
    const result = await ai.getTinyStep({ text: "read biology chapter", energyLevel: lvl });
    assert.equal(result.isSafetyResponse, false);
    assert.ok(typeof result.step === "string" && result.step.length > 5);
    // Verify fallback step matches level expectations
    assert.equal(result.step, DEFAULT_OFFLINE_STEPS[lvl].step);
  }
});
