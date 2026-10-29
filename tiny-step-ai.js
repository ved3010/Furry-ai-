"use strict";

const fs = require("fs");
const path = require("path");

// Load coping library
let COPING_LIBRARY = [];
try {
  const libPath = path.join(__dirname, "coping-library.json");
  if (fs.existsSync(libPath)) {
    COPING_LIBRARY = JSON.parse(fs.readFileSync(libPath, "utf8"));
  }
} catch (_) {
  COPING_LIBRARY = [];
}

const DISTRESS_KEYWORDS = [
  /\b(kill\s*myself|killing\s*myself|suicide|end\s*my\s*life|want\s*to\s*die|cutting\s*myself|self[\s\-]*harm|hurt\s*myself)\b/i,
  /\b(can['’]?t\s*take\s*it\s*anymore|cannot\s*take\s*it\s*anymore|better\s*off\s*dead|no\s*reason\s*to\s*live|hopeless)\b/i,
  /\b(die|dying|suicidal)\b/i,
];

const SHAME_WORDS = [
  /\blazy\b/i,
  /\blate\b/i,
  /\bshould\b/i,
  /\bshould've\b/i,
  /\bshouldn't\b/i,
  /\bfailure\b/i,
  /\bslacker\b/i,
];

const TELE_MANAS_HELPLINE = "14416";
const TELE_MANAS_MESSAGE = "I hear you, and you are not alone. Please reach out to someone you trust or contact the Tele-MANAS helpline at 14416 (available 24/7, free and confidential) for caring support right now.";

// Step duration expectations by energy level:
// 1 = 1 minute or rest, 2 = 2 minutes, 3 = 5 minutes, 4 = 10 minutes, 5 = 15 to 20 minutes
const STEP_SIZE_GUIDE = {
  1: "1 minute or gentle rest (ultra-small, micro-step, zero cognitive pressure)",
  2: "2 minutes (a quick 2-minute action to break the ice)",
  3: "5 minutes (a gentle 5-minute focused chunk)",
  4: "10 minutes (a 10-minute active momentum block)",
  5: "15 to 20 minutes (a high-energy 15-20 minute power sprint)",
};

const DEFAULT_OFFLINE_STEPS = {
  1: {
    step: "Take a deep breath and rest your eyes for 1 minute. You can pause right now without guilt.",
    trick: "Drink water & reset",
  },
  2: {
    step: "Open the file or notebook and write down the title. That's your entire 2-minute goal for now.",
    trick: "2-minute rule",
  },
  3: {
    step: "Pick just one sentence or the first bullet point to draft. Spend 5 minutes on it and see how it feels.",
    trick: "5-minute timer",
  },
  4: {
    step: "Tackle problem or section #1 for the next 10 minutes with full focus. You'll make great momentum.",
    trick: "Solve example or problem #1",
  },
  5: {
    step: "Sprint through the first core section for 15 minutes against a timer. Ride your zoomies momentum!",
    trick: "Slice in half twice",
  },
};

function checkDistress(text) {
  if (!text || typeof text !== "string") return false;
  return DISTRESS_KEYWORDS.some((regex) => regex.test(text));
}

function matchCopingTrick(text) {
  if (!text || typeof text !== "string" || !Array.isArray(COPING_LIBRARY) || COPING_LIBRARY.length === 0) {
    return COPING_LIBRARY[0] || { name: "2-minute rule", tip: "Commit to working on it for just 2 minutes." };
  }
  const clean = text.toLowerCase();
  let bestTrick = null;
  let bestScore = -1;

  for (const trick of COPING_LIBRARY) {
    let score = 0;
    if (Array.isArray(trick.keywords)) {
      for (const kw of trick.keywords) {
        if (clean.includes(kw.toLowerCase())) {
          score += 2;
        }
      }
    }
    if (clean.includes(trick.name.toLowerCase())) {
      score += 3;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTrick = trick;
    }
  }

  return bestScore > 0 ? bestTrick : (COPING_LIBRARY[0] || { name: "2-minute rule", tip: "Commit to working on it for just 2 minutes." });
}

function buildTinyStepPrompt({ userText, energyLevel = 3, matchedTrick, isSmaller = false, stepNumber = 1 }) {
  const level = Number(energyLevel) || 3;
  const sizeDesc = STEP_SIZE_GUIDE[level] || STEP_SIZE_GUIDE[3];
  const trickInfo = matchedTrick ? `${matchedTrick.name}: "${matchedTrick.tip}"` : "2-minute rule: Start tiny.";

  return [
    {
      role: "system",
      content: [
        "You are a kind, comforting desktop companion cat helping a student overcome feeling stuck or overwhelmed.",
        `The user's energy level is Level ${level}/5. Step size target: ${sizeDesc}.`,
        isSmaller ? "The user requested: 'Make it smaller'. Provide an even tinier, simpler, zero-friction micro-step." : "",
        stepNumber > 1 ? `This is Step #${stepNumber} after completing previous steps.` : "",
        `Matched Coping Trick to incorporate: ${trickInfo}`,
        "RULES:",
        "1. Return exactly ONE tiny step.",
        "2. Keep it to 1 or 2 short sentences total.",
        "3. Tone must be warm, kind, and encouraging.",
        "4. NO bullet points, NO lists, NO numbered items.",
        "5. NEVER use shame words: do NOT use 'lazy', 'late', 'should', 'should have', 'failure', or 'slacker'.",
        "6. Do not include markdown headers or extra conversational filler.",
      ].filter(Boolean).join(" "),
    },
    {
      role: "user",
      content: String(userText || "").trim(),
    },
  ];
}

function sanitizeTinyStepResponse(rawText, energyLevel = 3) {
  if (!rawText || typeof rawText !== "string") {
    return DEFAULT_OFFLINE_STEPS[energyLevel]?.step || DEFAULT_OFFLINE_STEPS[3].step;
  }

  let cleaned = rawText
    .replace(/^["']|["']$/g, "")
    .replace(/^(step\s*\d*[:\s]*|tiny\s*step[:\s]*)/i, "")
    .replace(/^[•\-\*\d\.]+\s*/gm, "")
    .replace(/\n+/g, " ")
    .trim();

  // Strip shame words if model accidentally emitted any
  for (const sw of SHAME_WORDS) {
    cleaned = cleaned.replace(sw, "");
  }
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();

  // Keep at most 2 sentences
  const sentences = cleaned.match(/[^.!?]+[.!?]+|\S+/g) || [cleaned];
  if (sentences.length > 2) {
    cleaned = sentences.slice(0, 2).join(" ").trim();
  }

  return cleaned || (DEFAULT_OFFLINE_STEPS[energyLevel]?.step || DEFAULT_OFFLINE_STEPS[3].step);
}

class TinyStepAI {
  constructor(options = {}) {
    this.modelClient = options.modelClient || null; // e.g. require('./agent-model-client')
    this.configProvider = options.configProvider || (() => ({ baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash-lite", apiKey: "" }));
    this.fetch = options.fetch || null;
  }

  async getTinyStep({ text, energyLevel = 3, isSmaller = false, stepNumber = 1 }) {
    const userText = String(text || "").trim();
    const level = Number(energyLevel) || 3;

    // Safety check: deep distress or self-harm
    if (checkDistress(userText)) {
      return {
        isSafetyResponse: true,
        step: TELE_MANAS_MESSAGE,
        helpline: TELE_MANAS_HELPLINE,
        matchedTrick: null,
      };
    }

    const matchedTrick = matchCopingTrick(userText);
    const messages = buildTinyStepPrompt({ userText, energyLevel: level, matchedTrick, isSmaller, stepNumber });

    // Try model generation
    let modelResult = null;
    const config = typeof this.configProvider === "function" ? this.configProvider() : (this.configProvider || {});

    if (this.modelClient) {
      try {
        const apiKey = config.apiKey || "";
        const baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai";
        const model = config.model || "gemini-3.5-flash-lite";

        if (this.modelClient.requestModel) {
          const res = await this.modelClient.requestModel({
            baseUrl,
            model,
            apiKey,
            messages,
            maxTokens: 120,
            temperature: 0.7,
          }, { fetch: this.fetch });

          const content = res?.choices?.[0]?.message?.content;
          if (content) {
            modelResult = sanitizeTinyStepResponse(content, level);
          }
        }
      } catch (err) {
        console.warn("[TinyStepAI] Model call failed:", err?.message || err);
      }
    }

    // Fallback: If model call failed or not configured, try local Ollama or offline step
    if (!modelResult) {
      if (isSmaller) {
        modelResult = level === 1
          ? "Just close your eyes and breathe gently for 30 seconds. You don't have to do anything right now."
          : `Let's make it even simpler: just write down the single first word or open the page for 1 minute.`;
      } else {
        const fallback = DEFAULT_OFFLINE_STEPS[level] || DEFAULT_OFFLINE_STEPS[3];
        modelResult = fallback.step;
      }
    }

    return {
      isSafetyResponse: false,
      step: modelResult,
      matchedTrick,
      energyLevel: level,
      isSmaller,
      stepNumber,
    };
  }
}

module.exports = {
  TinyStepAI,
  COPING_LIBRARY,
  DISTRESS_KEYWORDS,
  TELE_MANAS_HELPLINE,
  TELE_MANAS_MESSAGE,
  STEP_SIZE_GUIDE,
  DEFAULT_OFFLINE_STEPS,
  checkDistress,
  matchCopingTrick,
  buildTinyStepPrompt,
  sanitizeTinyStepResponse,
};
