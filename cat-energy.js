"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const REUSE_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_LEVEL = 3;

const ENERGY_LEVELS = [
  { level: 1, name: "Loaf", emoji: "💤", subtitle: "curled up, resting", label: "Loaf", description: "curled up, resting" },
  { level: 2, name: "Sleepy", emoji: "🥱", subtitle: "yawning, cozy", label: "Sleepy", description: "yawning, cozy" },
  { level: 3, name: "Chill", emoji: "😸", subtitle: "cheerful & steady", label: "Chill", description: "cheerful & steady" },
  { level: 4, name: "Playful", emoji: "⚡", subtitle: "energetic & lively", label: "Playful", description: "energetic & lively" },
  { level: 5, name: "Zoomies", emoji: "💨", subtitle: "high energy, full sprint", label: "Zoomies", description: "high energy, full sprint" },
];

function getDefaultStoragePath() {
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

class CatEnergy {
  constructor(options = {}) {
    this.storagePath = options.storagePath || getDefaultStoragePath();
    this.timeProvider = options.timeProvider || null;
    this._mockedNow = null;
    this.listeners = new Set();
    this.currentData = null; // { level: number, timestamp: number }
    this.load();
  }

  now() {
    if (typeof this._mockedNow === "number") {
      return this._mockedNow;
    }
    if (typeof this.timeProvider === "function") {
      return this.timeProvider();
    }
    return Date.now();
  }

  setMockedTime(timestamp) {
    this._mockedNow = timestamp;
  }

  advanceMockedTime(ms) {
    if (typeof this._mockedNow !== "number") {
      this._mockedNow = Date.now();
    }
    this._mockedNow += ms;
  }

  load() {
    try {
      if (this.storagePath && fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, "utf8");
        const json = JSON.parse(raw);
        if (json && typeof json.catEnergy === "object" && json.catEnergy !== null) {
          const rawLevel = json.catEnergy.level;
          const parsed = typeof rawLevel === "number" ? rawLevel : Number.parseInt(rawLevel, 10);
          const timestamp = json.catEnergy.timestamp;
          if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 && typeof timestamp === "number") {
            this.currentData = { level: parsed, timestamp };
            return this.currentData;
          }
        }
      }
    } catch (_) {}
    return null;
  }

  save(level, timestamp = this.now()) {
    const parsed = typeof level === "number" ? level : Number.parseInt(level, 10);
    const validLevel = Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : DEFAULT_LEVEL;
    this.currentData = { level: validLevel, timestamp };

    try {
      if (this.storagePath) {
        const dir = path.dirname(this.storagePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        let settings = {};
        if (fs.existsSync(this.storagePath)) {
          try {
            settings = JSON.parse(fs.readFileSync(this.storagePath, "utf8")) || {};
          } catch (_) {
            settings = {};
          }
        }
        settings.catEnergy = {
          level: validLevel,
          timestamp,
        };
        fs.writeFileSync(this.storagePath, JSON.stringify(settings, null, 2), "utf8");
      }
    } catch (err) {
      console.warn("[CatEnergy] Could not save energy level locally:", err.message);
    }

    const info = this.getEnergyInfo(validLevel);
    console.log(`[CatEnergy] Chosen energy level: ${validLevel} (${info.name} ${info.emoji})`);

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(validLevel, info);
      } catch (err) {
        console.error("[CatEnergy] Listener error:", err);
      }
    }

    return validLevel;
  }

  getEnergyInfo(level = this.getEnergyLevel()) {
    const found = ENERGY_LEVELS.find((l) => l.level === level);
    return found || ENERGY_LEVELS[2]; // Default to level 3 (Chill)
  }

  getEnergyLevel() {
    if (this.currentData && typeof this.currentData.level === "number") {
      return this.currentData.level;
    }
    const loaded = this.load();
    if (loaded && typeof loaded.level === "number") {
      return loaded.level;
    }
    return DEFAULT_LEVEL;
  }

  getEnergyRecord() {
    return this.currentData ? { ...this.currentData } : null;
  }

  hasRecentLevel() {
    if (!this.currentData || typeof this.currentData.timestamp !== "number") {
      return false;
    }
    const elapsed = this.now() - this.currentData.timestamp;
    return elapsed >= 0 && elapsed < REUSE_DURATION_MS;
  }

  shouldShowPicker() {
    return !this.hasRecentLevel();
  }

  skip() {
    console.log(`[CatEnergy] Energy picker skipped. Using default level: ${DEFAULT_LEVEL} (Chill 😸)`);
    return this.save(DEFAULT_LEVEL);
  }

  onEnergySelected(callback) {
    if (typeof callback === "function") {
      this.listeners.add(callback);
      return () => {
        this.listeners.delete(callback);
      };
    }
    return () => {};
  }
}

function generateConcreteTinyStep(taskName, energyLevel = DEFAULT_LEVEL) {
  const task = String(taskName || "").trim();
  const lower = task.toLowerCase();
  const lvl = Number(energyLevel) || DEFAULT_LEVEL;

  // 1. Math / Calculations / Problem Sets / Algorithms / Science
  if (/(?:math|calculus|algebra|physics|stats|statistics|dsa|leetcode|algorithm|problem|exercise|questions?|equation)\b/i.test(lower)) {
    if (lvl === 1) return `Solve just **Question #1** of "${task}"—write down only the given problem statement on paper (spend just **2 minutes**). Once you write it, you're done! 🍞`;
    if (lvl === 2) return `Solve **Question #1** of "${task}" at an easy, calm pace in a **10-minute gentle block**. 🥱`;
    if (lvl === 3) return `Tackle **the first 2 problems** of "${task}" with **20 minutes** of steady focus. 😸`;
    if (lvl === 4) return `Jump into **"${task}"** for a **25-minute power sprint** and crush the toughest problem first! ⚡`;
    return `Set a **15-minute challenge timer** and see how many problems of **"${task}"** you can solve before it rings! 💨`;
  }

  // 2. Writing / Essays / Reports / Documentation / Thesis
  if (/(?:essay|report|paper|thesis|write|draft|article|summary|doc|notes)\b/i.test(lower)) {
    if (lvl === 1) return `Spend just **2 minutes** writing down the title and the first opening sentence for "${task}". Then pause and rest! 🍞`;
    if (lvl === 2) return `Do a **10-minute gentle block** outlining 3 bullet points for "${task}". 🥱`;
    if (lvl === 3) return `Focus on writing the intro and first section of **"${task}"** for **20 minutes**. 😸`;
    if (lvl === 4) return `Jump straight into **"${task}"** for a **25-minute power sprint**—draft the core argument with zero self-editing! ⚡`;
    return `Set a **15-minute challenge timer** and speed-draft as much of **"${task}"** as you can! 💨`;
  }

  // 3. Reading / Chapters / Studying / Review / Slides
  if (/(?:read|chapter|book|textbook|study|review|slides?|lecture|revise)\b/i.test(lower)) {
    if (lvl === 1) return `Spend just **2 minutes** reading the heading and the very first paragraph of "${task}". 🍞`;
    if (lvl === 2) return `Do a **10-minute gentle block** reading the chapter introduction and key vocabulary in "${task}". 🥱`;
    if (lvl === 3) return `Focus on reading and taking notes on **"${task}"** for **20 minutes**. 😸`;
    if (lvl === 4) return `Jump straight into **"${task}"** for a **25-minute power sprint**—active recall on the main concepts! ⚡`;
    return `Set a **15-minute challenge timer** and power-read the core concepts of **"${task}"**! 💨`;
  }

  // 4. Coding / Programming / Labs / Projects / Debugging
  if (/(?:code|coding|program|programming|lab|project|dev|build|bug|debug|function|script|git|app)\b/i.test(lower)) {
    if (lvl === 1) return `Spend just **2 minutes** writing a 1-line comment outline or function signature for "${task}". 🍞`;
    if (lvl === 2) return `Do a **10-minute gentle block** writing the first small test or setup for "${task}". 🥱`;
    if (lvl === 3) return `Focus on implementing the next feature in **"${task}"** for **20 minutes**. 😸`;
    if (lvl === 4) return `Jump straight into **"${task}"** for a **25-minute power sprint** and tackle the main logic! ⚡`;
    return `Set a **15-minute challenge timer** and see how much code for **"${task}"** you can write and test! 💨`;
  }

  // 5. Emails / Messages / Submission
  if (/(?:email|mail|message|send|submit|contact|reply|slack)\b/i.test(lower)) {
    if (lvl === 1) return `Spend just **2 minutes** typing a 1-sentence draft outline for "${task}". 🍞`;
    if (lvl === 2) return `Do a **5-minute gentle block** polishing your draft for "${task}". 🥱`;
    if (lvl === 3) return `Review, finalize, and send "${task}" in a **10-minute focus session**. 😸`;
    if (lvl === 4) return `Knock out "${task}" right now in a **25-minute power sprint** session! ⚡`;
    return `Set a **15-minute challenge timer** to draft, review, and send "${task}"! 💨`;
  }

  // 6. Cleaning / Organizing
  if (/(?:clean|tidy|organize|room|desk|laundry|dishes|pack)\b/i.test(lower)) {
    if (lvl === 1) return `Spend just **2 minutes** putting away exactly 3 items for "${task}". 🍞`;
    if (lvl === 2) return `Do a **10-minute gentle block** clearing one small surface for "${task}". 🥱`;
    if (lvl === 3) return `Focus on **"${task}"** for a steady **20 minutes**. 😸`;
    if (lvl === 4) return `Put on upbeat music and do a **25-minute power sprint** on "${task}"! ⚡`;
    return `Set a **15-minute challenge timer** and blitz through as much of "${task}" as possible! 💨`;
  }

  // 7. General fallback (ALWAYS specific to student's task, NEVER generic "open file")
  if (lvl === 1) return `Spend just **2 minutes** taking the very first tiny action on **"${task}"** (write the first word or line). Once you start, you've won! 🍞`;
  if (lvl === 2) return `Do a **10-minute gentle block** on **"${task}"** at an easy, relaxed pace. When done, take a stretch break. 🥱`;
  if (lvl === 3) return `Focus on **"${task}"** for **20 minutes**. Keep it steady and enjoy the progress! 😸`;
  if (lvl === 4) return `Jump straight into **"${task}"** for a **25-minute power sprint**! ⚡`;
  return `Set a **15-minute challenge timer** and see how much of **"${task}"** you can complete before it rings! 💨`;
}

function isTaskPrioritizationRequest(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.trim();
  const lower = t.toLowerCase();
  if (/(?:priorit(?:ize|ise)|priorit(?:y|ies)|what (?:should (?:i|we) |to )?do first|order (?:my|these) tasks|plan (?:my|these) tasks)/i.test(lower)) return true;
  if (/(?:here are (?:my )?tasks|my tasks (?:are|list)|the tasks (?:are|list))\b/i.test(lower)) return true;
  if (/^tasks?\s*[:\-\n]/i.test(lower) || /^to-?do\s*[:\-\n]/i.test(lower)) return true;
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.some((l) => /^(\d+[\.\)]|[-*•])\s+/.test(l))) return true;
  if (lines.length >= 2 && lower.includes("task")) return true;

  if (/^(?:i (?:need|have|want|ought) to|working on|finish|do|start)\b/i.test(lower)) return true;

  // Student task phrases like: "math assignment, physics lab, essay" or "math homework"
  const studentKeywords = /(?:assignment|homework|hw|lab|report|essay|chapter|read|study|exam|quiz|project|code|problem|presentation|lecture|notes|course|math|physics|chemistry|biology|history|english|dsa|test)\b/i;
  if (studentKeywords.test(lower)) {
    if (!/^(?:what|who|where|when|why|how)\s+(?:is|are|was|were)\b/i.test(lower)) {
      return true;
    }
  }

  return false;
}

function cleanTaskItem(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();

  // Strip conversational / temporal / filler prefixes
  s = s.replace(/^(?:(?:and\s+)?(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s+(?:one|task|thing))?\s+(?:is|was)?\s*)/i, "");
  s = s.replace(/^(?:also\s+|and\s+|then\s+)?(?:(?:for\s+)?(?:to-?morrow|tommorow|today|tonight|next\s+week)\s+(?:i\s+have\s+(?:a\s+|an\s+)?|there\s+is\s+(?:a\s+|an\s+)?|i\s+got\s+)?)/i, "");
  s = s.replace(/^(?:due\s+(?:to-?morrow|tommorow|today|soon)\s*:?\s*)/i, "");
  s = s.replace(/^(?:i\s+have\s+(?:to\s+(?:do|finish|prepare|study|review|complete)\s+|a\s+|an\s+)?)/i, "");
  s = s.replace(/^(?:i\s+need\s+to\s+(?:do|finish|prepare|study|review|complete)\s+)/i, "");
  s = s.replace(/^(?:i\s+got\s+(?:a\s+|an\s+)?)/i, "");
  s = s.replace(/^(?:my\s+)/i, "");

  // Strip emotional state / feeling suffixes or parentheticals
  s = s.replace(/(?:,\s*)?(?:and\s+)?(?:(?:i\s+am|i'm|im|i)\s+)?(?:feeling|feelong|feel)?\s*(?:so\s+|very\s+|extremely\s+|really\s+|s\s+)?(?:stressed|drained|tired|exhausted|anxious|overwhelmed|burnt\s*out|sad|scared|nervous|hopeless).*$/i, "");
  s = s.replace(/\s*\((?:i\s+am|feeling|so\s+stressed|tired|drained)[^)]*\)/i, "");

  // Strip trailing conversational clutter like "so can you prioritize", "please help", etc.
  s = s.replace(/(?:,\s*)?(?:so\s+)?(?:can\s+you\s+|please\s+)?(?:help\s+me\s+)?prioritize.*$/i, "");
  s = s.replace(/[,\.;:\-]+$/, "").trim();

  // Acronym and common spelling fixes
  s = s.replace(/\bdiscrcte\b/gi, "Discrete");
  s = s.replace(/\bassesment\b/gi, "assessment");
  s = s.replace(/\bos\b/gi, "OS");

  return s.trim();
}

function extractTaskItems(text) {
  const rawItems = [];
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    let cleaned = line
      .replace(/^(?:i (?:need|have|want|ought) to (?:do |finish |complete )?|my (?:tasks?|to-?do|assignments?) (?:are|is)?|please (?:help me )?(?:plan|prioritize)|here are (?:my )?(?:tasks|to-?dos?)|tasks?|to-?do|prioritize(?: these)?|i will tell you (?:once again )?)\s*[:\-]?\s*/i, "")
      .trim();
    if (!cleaned) continue;

    // Check for conversational ordinals like "the first one is X and the second one is Y third is Z..."
    const ordPattern = /(?:(?:and\s+)?(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s+one)?\s+(?:is|was)?\s*)/gi;
    if (ordPattern.test(cleaned) && lines.length === 1) {
      const parts = cleaned.split(ordPattern).map((s) => s.replace(/(?:,\s*)?(?:so\s+)?can you prioritize.*$/i, "").replace(/^the\s+/i, "").trim()).filter((s) => s.length > 2);
      if (parts.length >= 2) {
        for (const p of parts) {
          const item = cleanTaskItem(p);
          if (item.length > 1) rawItems.push(item);
        }
        continue;
      }
    }

    if (/\b[1-9][\.\)]\s+/.test(cleaned) && lines.length === 1) {
      const parts = cleaned.split(/\b[1-9][\.\)]\s+/).map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        const item = cleanTaskItem(p.replace(/^[,\s;]+|[,\s;]+$/g, "").trim());
        if (item.length > 1) rawItems.push(item);
      }
    } else if (cleaned.includes(",") && lines.length === 1) {
      const parts = cleaned.split(",").map((s) => s.trim().replace(/^and\s+/i, "").replace(/^[,\s;]+|[,\s;]+$/g, "")).filter(Boolean);
      for (const p of parts) {
        const item = cleanTaskItem(p);
        if (item.length > 1) rawItems.push(item);
      }
    } else if (/\band\b/i.test(cleaned) && lines.length === 1 && !cleaned.includes(",")) {
      const parts = cleaned.split(/\band\b/i).map((s) => s.trim().replace(/^[,\s;]+|[,\s;]+$/g, "")).filter(Boolean);
      for (const p of parts) {
        const item = cleanTaskItem(p);
        if (item.length > 1) rawItems.push(item);
      }
    } else {
      const item = cleanTaskItem(cleaned
        .replace(/^[\d+]+[\.\)]\s*/, "")
        .replace(/^[-*•]\s*/, "")
        .replace(/^and\s+/i, "")
        .trim());
      if (item.length > 1) rawItems.push(item);
    }
  }
  return rawItems;
}

function prioritizeTasks(text, energyLevel = DEFAULT_LEVEL) {
  const num = Number(energyLevel) || DEFAULT_LEVEL;
  const info = ENERGY_LEVELS.find((e) => e.level === num) || ENERGY_LEVELS[2];
  const rawItems = extractTaskItems(text);

  if (rawItems.length === 0) {
    return {
      reply: `I'm tuned to your **${info.name} ${info.emoji}** energy!\n\nI couldn't quite catch the specific tasks. Could you tell me your assignments or tasks in a bit more detail (e.g. *Operating Systems review, Discrete Maths project, Web dev interview*)? Also let me know if any have urgent deadlines so I can prioritize them accurately! 🐾`,
      action: null,
      prioritized: [],
    };
  }

  let prioritized = [];
  if (info.level === 1) {
    prioritized = [...rawItems].sort((a, b) => a.length - b.length);
  } else if (info.level === 2) {
    prioritized = [...rawItems].sort((a, b) => a.length - b.length);
  } else if (info.level === 3) {
    prioritized = [...rawItems];
  } else if (info.level === 4) {
    prioritized = [...rawItems].sort((a, b) => b.length - a.length);
  } else {
    prioritized = [...rawItems].sort((a, b) => b.length - a.length);
  }

  const lowerText = String(text || "").toLowerCase();
  const hasTiming = /(?:tomorrow|tommorow|today|tonight|morning|afternoon|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}\/\d{1,2}\b)/i.test(lowerText);
  const hasUrgencyOrImportance = /(?:most\s+important|urgent|priority|crucial|weight|highest|exam|interview|assesment|assessment)/i.test(lowerText);
  const isStressedOrDrained = /(?:stress(?:ed)?|drain(?:ed)?|exhaust(?:ed)?|tired|overwhelm(?:ed)?|anxious|burnt\s*out|can't\s+think|heavy|feelong\s+s\s+stressed)/i.test(lowerText) || info.level <= 2;

  const levelStrategies = {
    1: {
      tag: "💤 Loaf Mode (Ultra-low friction & compassionate rest)",
      guidance: isStressedOrDrained
        ? "Take a slow, gentle breath. 🌿 Feeling drained or stressed is your mind telling you it's carrying a lot. Zero pressure right now! We are starting with the single lightest, lowest-friction task and doing only a 2-minute micro-step. You have full permission to take deep breaths and rest anytime."
        : "I know feeling low energy makes everything feel heavy. Zero pressure right now! We are starting with the single lightest, easiest task and doing only a 2-minute micro-step. You have full permission to take deep breaths and rest anytime.",
      tinyStep: generateConcreteTinyStep(prioritized[0], 1),
    },
    2: {
      tag: "🥱 Sleepy Mode (Gentle pacing & low strain)",
      guidance: isStressedOrDrained
        ? "Take it nice and easy. ☕ Low energy days are completely normal and valid. We are keeping things warm, cozy, and low cognitive load. We'll start with a manageable 10-minute focus block on the clearest task."
        : "Keeping things warm, cozy, and low cognitive load. We'll start with a manageable 10-minute focus block on the clearest task.",
      tinyStep: generateConcreteTinyStep(prioritized[0], 2),
    },
    3: {
      tag: "😸 Chill Mode (Steady, balanced progress)",
      guidance: "Steady, cheerful pace! We'll tackle your tasks in a calm, balanced order with standard 20-minute focus intervals.",
      tinyStep: generateConcreteTinyStep(prioritized[0], 3),
    },
    4: {
      tag: "⚡ Playful Mode (High momentum power sprint)",
      guidance: "You have great energy and momentum! We've placed the biggest challenge right at the top so you can crush it first in an energetic 25-minute power sprint.",
      tinyStep: generateConcreteTinyStep(prioritized[0], 4),
    },
    5: {
      tag: "💨 Zoomies Mode (Full speed blitz)",
      guidance: "Maximum velocity! Blitz through the top challenge against a 15-minute challenge timer, then rapidly knock out your remaining tasks!",
      tinyStep: generateConcreteTinyStep(prioritized[0], 5),
    },
  };

  const strat = levelStrategies[info.level] || levelStrategies[3];
  const listFormatted = prioritized.map((task, idx) => {
    const badge = idx === 0 ? "🎯 **#1 Top Priority**" : idx === 1 ? "⚡ **#2 Next**" : `🐾 **#${idx + 1}**`;
    return `${badge}: ${task}`;
  }).join("\n");

  let clarifyingQuestions = "";
  if (prioritized.length >= 2) {
    const questions = [];
    questions.push("• **Schedule & Timings**: What specific time or deadline tomorrow is each task scheduled for (e.g. morning, 2 PM, midnight)?");
    questions.push("• **Stakes & Weight**: Which of these carries the highest grade percentage, marks, or personal importance for you?");
    questions.push("• **Current Preparation**: Are any of these already partially prepared (notes/code ready), or do you need to start from scratch?");
    questions.push("• **Mental Energy**: Which one feels the most mentally exhausting or stressful for you right now?");

    clarifyingQuestions = `\n\n💡 **Questions to help give you an even more accurate priority order:**\n${questions.join("\n")}\n\n*Tell me any of these details and I will instantly re-adjust and fine-tune your priority ranking to match your day perfectly!* 🐾`;
  }

  const reply = [
    `✨ **Tasks Prioritized for Level ${info.level} ${info.name} ${info.emoji}**`,
    `*${strat.tag}*`,
    "",
    strat.guidance,
    "",
    listFormatted,
    "",
    `🐾 **Your Tiny Step Right Now:**`,
    strat.tinyStep,
    clarifyingQuestions,
  ].filter(Boolean).join("\n");

  return { reply, action: null, prioritized, strategy: strat };
}

// Singleton instance
const defaultInstance = new CatEnergy();

module.exports = {
  CatEnergy,
  ENERGY_LEVELS,
  DEFAULT_LEVEL,
  REUSE_DURATION_MS,
  getInstance: () => defaultInstance,
  getEnergyLevel: () => defaultInstance.getEnergyLevel(),
  getEnergyInfo: (lvl) => defaultInstance.getEnergyInfo(lvl),
  getEnergyRecord: () => defaultInstance.getEnergyRecord(),
  setEnergyLevel: (lvl, ts) => defaultInstance.save(lvl, ts),
  save: (lvl, ts) => defaultInstance.save(lvl, ts),
  hasRecentLevel: () => defaultInstance.hasRecentLevel(),
  shouldShowPicker: () => defaultInstance.shouldShowPicker(),
  skip: () => defaultInstance.skip(),
  onEnergySelected: (cb) => defaultInstance.onEnergySelected(cb),
  isTaskPrioritizationRequest,
  extractTaskItems,
  prioritizeTasks,
  generateConcreteTinyStep,
};
