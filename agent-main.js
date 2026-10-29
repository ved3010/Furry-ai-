"use strict";

const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { inferShortcut } = require("./agent-shortcuts");
const { normalizeMusicAction, executeMusicAction } = require("./agent-music");
const appLauncher = require("./app-launcher");
const googleClassroom = require("./google-classroom");
const catEnergy = require("./cat-energy");
const {
  app,
  BrowserWindow,
  ipcMain,
  net,
  safeStorage,
  shell,
} = require("electron");

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MAX_HISTORY = 48;
const MAX_MEMORIES = 100;
const MAX_TASKS = 100;
const MAX_CONTEXT_HISTORY = 20;
const MAX_CONTEXT_ENTRY_CHARS = 1_200;
const MAX_CONTEXT_CHARS = 28_000;
const MAX_CONTEXT_MEMORIES = 24;
const MAX_CONTEXT_TASKS = 32;
// Interactions counts thinking tokens against max_output_tokens as well as text.
const GEMINI_TOKEN_BUDGET = 4_096;
const APPROVALS_VERSION = 1;
const pendingPanelBounds = new Map();
const pendingActions = new Map();
const approvalGrants = new Map();
const rpcToken = crypto.randomBytes(32).toString("hex");

let stateLoaded = false;
let config = null;
let apiKeyStatus = "missing";
let history = [];
let memories = [];
let tasks = [];

function getAgentDirectory() {
  const directory = path.join(app.getPath("userData"), "agent");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function getAgentFile(name) {
  return path.join(getAgentDirectory(), name);
}

function readJson(name, fallback) {
  try {
    const file = getAgentFile(name);
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function loadApprovalGrants() {
  approvalGrants.clear();
  const saved = readJson("approvals.json", {});
  if (!saved || saved.version !== APPROVALS_VERSION || !Array.isArray(saved.grants)) return;
  for (const grant of saved.grants) {
    if (!grant || typeof grant !== "object") continue;
    if (typeof grant.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(grant.fingerprint)) continue;
    if (grant.expiresAt && !Number.isFinite(Date.parse(grant.expiresAt))) continue;
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) continue;
    approvalGrants.set(grant.fingerprint, {
      fingerprint: grant.fingerprint,
      scope: normalizeText(grant.scope, 40),
      label: normalizeText(grant.label, 160),
      createdAt: typeof grant.createdAt === "string" ? grant.createdAt : new Date().toISOString(),
      expiresAt: grant.expiresAt || null,
      lastUsedAt: grant.lastUsedAt || null,
    });
  }
}

function saveApprovalGrants() {
  writeJson("approvals.json", {
    version: APPROVALS_VERSION,
    grants: [...approvalGrants.values()],
  });
}

function writeJson(name, value) {
  const file = getAgentFile(name);
  const temporaryFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporaryFile, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
}

function canUseSafeStorage() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function decryptApiKey(record) {
  if (!record || typeof record !== "object") return "";
  if (typeof record.apiKey === "string") return record.apiKey;
  if (!record.apiKeyEncrypted || !canUseSafeStorage()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(record.apiKeyEncrypted, "base64"));
  } catch {
    return "";
  }
}

function normalizeBaseUrl(value) {
  const candidate = String(value || "").trim().replace(/\/+$/, "");
  if (!candidate) return DEFAULT_BASE_URL;
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return DEFAULT_BASE_URL;
    return candidate;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function isLocalEndpoint(value) {
  try {
    const hostname = new URL(normalizeBaseUrl(value)).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function loadEnv() {
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
}
loadEnv();

function loadState() {
  if (stateLoaded) {
    if (!config?.apiKey && canUseSafeStorage()) {
      const savedConfig = readJson("config.json", {});
      const storedApiKey = decryptApiKey(savedConfig);
      if (storedApiKey) {
        config.apiKey = storedApiKey;
        apiKeyStatus = "stored securely";
      }
    }
    return;
  }
  loadEnv();
  const savedConfig = readJson("config.json", {});
  const storedApiKey = decryptApiKey(savedConfig);
  const environmentApiKey = process.env.GEMINI_API_KEY
    || process.env.AGENT_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.GOOGLE_API_KEY
    || "";
  config = {
    baseUrl: normalizeBaseUrl(savedConfig.baseUrl || process.env.AGENT_BASE_URL || DEFAULT_BASE_URL),
    model: String(savedConfig.model || process.env.AGENT_MODEL || DEFAULT_MODEL).trim().slice(0, 120),
    apiKey: storedApiKey || environmentApiKey,
  };
  apiKeyStatus = storedApiKey
    ? (savedConfig.apiKeyEncrypted ? "stored securely" : "stored locally")
    : environmentApiKey
      ? "loaded from environment"
      : savedConfig.apiKeyEncrypted
        ? (canUseSafeStorage() ? "saved key cannot be unlocked in this app session" : "waiting for safeStorage")
        : isLocalEndpoint(config.baseUrl)
          ? "not required for local endpoint"
          : "missing";
  const savedHistory = readJson("history.json", []);
  const savedMemories = readJson("memories.json", []);
  const savedTasks = readJson("tasks.json", []);
  history = Array.isArray(savedHistory) ? savedHistory : [];
  memories = Array.isArray(savedMemories) ? savedMemories : [];
  tasks = Array.isArray(savedTasks) ? savedTasks : [];
  loadApprovalGrants();
  stateLoaded = true;
}

if (app && typeof app.whenReady === "function") {
  app.whenReady().then(() => {
    stateLoaded = false;
    loadState();
  });
}

function saveConfig() {
  const record = {
    baseUrl: config.baseUrl,
    model: config.model,
  };
  if (config.apiKey) {
    if (canUseSafeStorage()) {
      record.apiKeyEncrypted = safeStorage.encryptString(config.apiKey).toString("base64");
    } else {
      record.apiKey = config.apiKey;
    }
  }
  writeJson("config.json", record);
}

function updateConfig(values = {}) {
  loadState();
  const nextBaseUrl = normalizeBaseUrl(values.baseUrl || config.baseUrl);
  const apiKey = typeof values.apiKey === "string" ? values.apiKey.trim() : "";
  const preservedKey = nextBaseUrl === config.baseUrl ? config.apiKey : "";
  config = {
    baseUrl: nextBaseUrl,
    model: normalizeText(values.model || config.model || DEFAULT_MODEL, 120),
    apiKey: values.clearApiKey ? "" : apiKey || preservedKey,
  };
  apiKeyStatus = values.clearApiKey
    ? (isLocalEndpoint(config.baseUrl) ? "not required for local endpoint" : "missing")
    : config.apiKey
      ? (apiKey ? (canUseSafeStorage() ? "stored securely" : "stored locally") : apiKeyStatus)
      : (isLocalEndpoint(config.baseUrl) ? "not required for local endpoint" : "missing");
  saveConfig();
  return getPublicState().config;
}

function getPublicState() {
  loadState();
  return {
    config: {
      baseUrl: config.baseUrl,
      model: config.model,
      apiKeyConfigured: Boolean(config.apiKey) || isLocalEndpoint(config.baseUrl),
      apiKeyStatus: Boolean(config.apiKey) || isLocalEndpoint(config.baseUrl)
        ? (isLocalEndpoint(config.baseUrl) && !config.apiKey ? "not required for local endpoint" : apiKeyStatus)
        : apiKeyStatus,
      encrypted: canUseSafeStorage(),
    },
    history: history.slice(-MAX_HISTORY),
    memories: memories.slice(-MAX_MEMORIES),
    tasks: tasks.slice(-MAX_TASKS),
  };
}

function normalizeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function saveHistory() {
  history = history.slice(-MAX_HISTORY);
  writeJson("history.json", history);
}

function saveMemories() {
  memories = memories.slice(-MAX_MEMORIES);
  writeJson("memories.json", memories);
}

function saveTasks() {
  tasks = tasks.slice(-MAX_TASKS);
  writeJson("tasks.json", tasks);
}

function readAppSettings() {
  try {
    const file = path.join(app.getPath("userData"), "settings.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  } catch {
    return {};
  }
}

function buildSystemPrompt() {
  const appSettings = readAppSettings();
  const userName = normalizeText(appSettings.userName, 24);
  const catName = normalizeText(appSettings.catName, 24) || "Cat";
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  const localDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const reminderList = Array.isArray(appSettings.reminders)
    ? appSettings.reminders.slice(0, 20).map((item) => `${item.time} — ${item.message}`).join("\n")
    : "(none)";
  const memoryList = memories.length
    ? memories.slice(-MAX_CONTEXT_MEMORIES).map((item) => `${normalizeText(item.key, 80)}: ${normalizeText(item.value, 300)}`).join("\n")
    : "(none)";
  const taskList = tasks.length
    ? tasks.filter((item) => !item.completed).slice(-MAX_CONTEXT_TASKS).map((item) => `${normalizeText(item.id, 120)}: ${normalizeText(item.title, 180)}`).join("\n")
    : "(none)";
  const classroomSummary = typeof googleClassroom.getClassroomSummaryText === "function" ? googleClassroom.getClassroomSummaryText() : "";

  let energyLevel = 3;
  let energyInfo = null;
  try {
    energyLevel = catEnergy.getEnergyLevel();
    energyInfo = catEnergy.getEnergyInfo(energyLevel);
  } catch (_) {
    energyLevel = 3;
    energyInfo = { level: 3, name: "Chill", emoji: "😸", subtitle: "cheerful & steady" };
  }
  const energyName = energyInfo?.name || "Chill";
  const energyEmoji = energyInfo?.emoji || "😸";
  const energyDesc = energyInfo?.subtitle || energyInfo?.description || "cheerful & steady";

  return [
    `You are ${catName}, a warm but concise personal desktop cat assistant.`,
    userName ? `The user's name is ${userName}.` : "The user's name is unknown.",
    `The user's local date is ${localDate}; their time zone is ${timeZone}. Use this when interpreting relative dates and times.`,
    `The user's current cat energy level is Level ${energyLevel} (${energyName} ${energyEmoji} — ${energyDesc}).`,
    "You can chat, maintain lightweight memories and tasks, create reminders, and propose safe computer actions.",
    "Understand natural-language questions, follow the conversation, and answer directly before offering optional next steps.",
    "Help with planning, studying, writing, coding explanations, decisions, and breaking work into concrete steps. Ask one concise question when essential details are missing instead of guessing.",
    `TASK PRIORITIZATION BY ENERGY LEVEL (${energyName.toUpperCase()} ${energyEmoji} — LEVEL ${energyLevel}):`,
    `When the user tells, shares, or lists their tasks, assignments, or to-do list:`,
    `1. Acknowledge their exact energy level (Level ${energyLevel}: ${energyName} ${energyEmoji}) up front and adapt your entire response tone accordingly.`,
    `2. CRITICAL TASK CLEANING & EXTRACTION: Cleanly isolate the subject/task name. Strip conversational filler prefixes (e.g. 'tomorrow I have', 'next week', 'I need to', 'due tomorrow', 'I got') and strip emotional remarks (e.g. 'I am feeling so stressed', 'feeling drained'). For example, 'tommorow i have operating system assesment' MUST be cleanly formatted as 'Operating System Assessment' (or 'OS Assessment'). 'discrcte maths project review' must be cleanly formatted as 'Discrete Maths Project Review'. 'club web dev interview i am feelong s stressed' must be cleanly formatted as 'Club Web Dev Interview'. NEVER retain conversational sentences or stress venting inside the task title itself!`,
    `3. Prioritize their actual tasks to match this energy level:`,
    `   - Level 1 (Loaf 💤): Ultra-low friction & compassionate rest mode. The student is feeling overwhelmed, tired, or stressed. Speak in a warm, comforting, soothing voice. Acknowledge their Loaf 💤 energy. Do NOT push for high productivity or pressure them. Prioritize the single easiest, lowest-friction task first. Give explicit permission to rest, take deep breaths, and take breaks. Recommend a micro-step of just 1-2 minutes max.`,
    `   - Level 2 (Sleepy 🥱): Low cognitive load. Gentle, cozy tone. Short gentle 10-minute focus blocks. Pick the clearest, low-strain task. Reassure them that steady, slow progress is completely valid.`,
    `   - Level 3 (Chill 😸): Balanced, steady flow with standard 20-minute focus intervals. Calm, cheerful, orderly guidance.`,
    `   - Level 4 (Playful ⚡): High momentum! Energetic and spirited tone! Tackle the biggest, toughest challenge first in a 25-minute power sprint!`,
    `   - Level 5 (Zoomies 💨): Maximum speed! Full speed blitz tone! Blitz through challenges against a 15-minute challenge timer!`,
    `4. Format clearly with emojis (🎯 **#1 Top Priority**, ⚡ **#2 Next**, 🐾 **Later**).`,
    `5. CRITICAL TINY STEP RULE: NEVER give generic or random advice like 'open file', 'open tab', or 'prepare workspace'. ALWAYS generate a specific, concrete, realistic first action tailored directly to what the #1 task actually is (e.g. for 'Math assignment 3', specify 'Solve problem #1'; for 'History essay', specify 'Write the title and 1 opening thesis sentence'; for 'Physics lab', specify 'Draft the apparatus and hypothesis'; for 'Operating System Assessment', specify 'Review the definition of process scheduling or memory paging for 2 minutes'). Conclude with: 🐾 **Your Tiny Step Right Now:** followed by that concrete first action.`,
    `6. SOOTHING, KIND TONE FOR STRESSED / DRAINED USERS: When the user mentions feeling stressed, drained, overwhelmed, exhausted, or anxious (or when cat energy is Level 1 Loaf 💤 or Level 2 Sleepy 🥱): Speak in the most comforting, gentle, and warm tone. Validate their feelings with soothing reassurance (e.g. 'Take a gentle, slow breath... It's completely okay to feel drained when you have multiple heavy things coming up. We are taking all the pressure off right now.'). Give them explicit permission to rest, and focus on only one tiny, gentle 2-minute step.`,
    `7. CRITICAL: ASK TARGETED QUESTIONS TO REFINE PRIORITY ACCURACY:`,
    `   After providing the prioritized tasks and the concrete tiny step, you MUST ALWAYS conclude with 2 to 3 targeted, specific questions to give an even more accurate, fine-tuned priority ranking tailored to their exact schedule:`,
    `   • Schedule & Exact hours: 'What exact time tomorrow is each task or assessment scheduled or due?'`,
    `   • Weight & Stakes: 'Which of these carries the highest grade percentage, marks, or personal importance for you?'`,
    `   • Preparation status: 'How much prep is already done for each (e.g. starting from scratch, or do you have slides/notes ready)?'`,
    `   • Mental friction: 'Which of these feels most mentally draining or stressful to tackle right now?'`,
    `   Always let the student know: 'Share any of these details with me, and I will instantly re-adjust and fine-tune your priority list with 100% precision! 🐾' (Do not ask about a detail if they already stated it).`,
    "Use stored memories and open tasks only when relevant. Save or change personal data only when the user clearly asks you to do so.",
    "Be warm and human, but do not add cat sounds to every answer. Keep simple answers short and make complex answers well-structured.",
    "You cannot see the screen or read arbitrary local files. However, Google Classroom IS integrated via OAuth with live access to courses and assignments. Use the Google Classroom details provided below to answer questions about subjects, courses, and assignments accurately. When the user asks to check, sync, fetch, or save assignments or deadlines from Google Classroom, propose the action: {\"type\": \"check_classroom\"}.",
    "Unstop browsing and music searches are browser shortcuts, not linked accounts. Search results do not mean a song is playing.",
    "Never claim that an action happened unless the app confirms it.",
    "Return ONLY valid JSON with this exact top-level shape: {\"reply\":\"string\",\"action\":null|{...}}. Escape newlines and quotes correctly. Do not wrap the JSON in Markdown fences.",
    "Allowed actions:",
    '- check_classroom: {type: "check_classroom"}',
    '- create_reminder: {type, time: "HH:MM", message, repeat: "none"|"daily"|"weekdays"|"weekends"|"custom", days: [0-6]}',
    '- remember: {type, key, value}',
    '- forget_memory: {type, key}',
    '- create_task: {type, title}',
    '- complete_task: {type, id}',
    '- list_reminders: {type}',
    '- list_tasks: {type}',
    '- open_url: {type, url}',
    '- open_app: {type, name}',
    '- open_path: {type, path}',
    '- run_command: {type, command}',
    '- music_control: {type, player: "spotify"|"music", command: "pause"|"resume"|"next"|"previous"|"status"}',
    'For a supplied Spotify track URL, music_control also supports {type, player:"spotify", command:"play_track", uri:"spotify:track:<id>"}. Never invent track IDs.',
    "Music controls require approval, an already-open desktop player, and macOS Automation permission.",
    "Do not propose actions for negated instructions, hypotheticals, or quoted text. For multiple steps propose only the first action, and explain the remaining plan.",
    "Only propose run_command when the user clearly asks for a computer command. The app will require confirmation.",
    "For ordinary conversation, set action to null.",
    `Current reminders:\n${reminderList}`,
    `Stored memories:\n${memoryList}`,
    `Open tasks:\n${taskList}`,
    ...(classroomSummary ? [classroomSummary] : []),
  ].join("\n");
}

function buildPromptHistory(userMessage, systemPrompt) {
  const selected = [];
  let size = systemPrompt.length + userMessage.length;
  for (let index = history.length - 1; index >= 0 && selected.length < MAX_CONTEXT_HISTORY; index -= 1) {
    const item = history[index];
    if (!item || !["user", "assistant"].includes(item.role)) continue;
    const content = normalizeText(item.content, MAX_CONTEXT_ENTRY_CHARS);
    if (!content || size + content.length > MAX_CONTEXT_CHARS) continue;
    selected.unshift({ role: item.role, content });
    size += content.length;
  }
  return selected;
}

function getChatEndpoint() {
  return require("./agent-model-client").getChatEndpoint(normalizeBaseUrl(config.baseUrl));
}

function fetchProvider(url, options) {
  // Node's global fetch bypasses Electron/macOS system proxy and PAC settings.
  // Use Chromium for every provider call, without cookies or cached key checks.
  return net.fetch(url, { ...options, credentials: "omit", cache: "no-store", redirect: "error" });
}

async function requestModel(messages, options = {}) {
  if (!config.apiKey && !isLocalEndpoint(config.baseUrl)) {
    const error = new Error("Configure an OpenAI-compatible endpoint and API key first.");
    error.code = "AGENT_NOT_CONFIGURED";
    throw error;
  }

  const client = require("./agent-model-client");
  const model = options.model || config.model || DEFAULT_MODEL;
  if (isGeminiEndpoint(config.baseUrl)) {
    return client.requestGeminiInteraction({
      baseUrl: config.baseUrl,
      model,
      apiKey: config.apiKey,
      messages,
      ...options,
    }, { fetch: fetchProvider });
  }
  return client.requestModel({ endpoint: getChatEndpoint(), model, apiKey: config.apiKey, messages, ...options }, { fetch: fetchProvider });
}

function endpointLabel(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "configured endpoint";
  }
}

function isGeminiEndpoint(value) {
  try {
    return new URL(value).hostname === "generativelanguage.googleapis.com";
  } catch {
    return false;
  }
}

function logModelFailure(operation, error) {
  // Keep diagnostics useful without logging prompts, response bodies, URLs with
  // credentials, or any part of the API key.
  console.warn("[Comnyang] agent model failure", {
    operation,
    code: error?.code || "model-error",
    status: error?.status,
    networkCode: error?.networkCode,
    transport: "chromium",
    model: config?.model || "",
    endpoint: endpointLabel(config?.baseUrl || ""),
  });
}

async function testModelConnection() {
  loadState();
  const configured = Boolean(config.apiKey) || isLocalEndpoint(config.baseUrl);
  if (!configured) {
    return {
      ok: false,
      reason: "AGENT_NOT_CONFIGURED",
      message: apiKeyStatus === "saved key cannot be unlocked in this app session"
        ? "The saved API key could not be unlocked in this app session. Save the key again in Agent settings."
        : "No API key is loaded. Open Agent settings, paste the provider key, and Save.",
      model: config.model,
      endpoint: endpointLabel(config.baseUrl),
      apiKeyStatus,
    };
  }

  const startedAt = Date.now();
  const client = require("./agent-model-client");
  let stage = isGeminiEndpoint(config.baseUrl) ? "model-access" : "generation";
  let modelAccessVerified = false;
  try {
    if (stage === "model-access") {
      // A cheap authenticated read separates network/key/model errors from
      // generation errors. It is never sufficient to report Connected.
      await client.checkModelAccess({
        endpoint: getChatEndpoint(), model: config.model, apiKey: config.apiKey, timeoutMs: 10_000,
      }, { fetch: fetchProvider });
      modelAccessVerified = true;
      stage = "generation";
    }
    // A model-list request only proves that the key can read metadata. Test a
    // real chat completion so billing, quota, model access, and generation
    // settings are verified before telling the user the agent is ready.
    const payload = await requestModel([
      { role: "system", content: "You are a connection check. Reply with exactly OK and nothing else." },
      { role: "user", content: "Reply with exactly OK." },
    ], {
      maxTokens: isGeminiEndpoint(config.baseUrl) ? GEMINI_TOKEN_BUDGET : 256,
      timeoutMs: Math.max(1, client.TOTAL_TIMEOUT_MS - (Date.now() - startedAt)),
    });
    const reply = normalizeText(extractMessageContent(payload), 80);
    return {
      ok: true,
      model: config.model,
      endpoint: endpointLabel(config.baseUrl),
      apiKeyStatus,
      modelAccessVerified,
      transport: "chromium",
      reply,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    logModelFailure("connection-test", error);
    return {
      ok: false,
      reason: error?.code || "model-error",
      networkCode: error?.networkCode,
      stage,
      modelAccessVerified,
      transport: "chromium",
      message: error?.message || "The model connection test failed.",
      elapsedMs: Date.now() - startedAt,
      model: config.model,
      endpoint: endpointLabel(config.baseUrl),
      apiKeyStatus,
    };
  }
}

function extractMessageContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return typeof content === "string" ? content : "";
}

function parseJsonReply(text) {
  const candidates = [String(text || "").trim()];
  const fenced = candidates[0].match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = candidates[0].indexOf("{");
  const end = candidates[0].lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(candidates[0].slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function normalizeAction(value) {
  if (!value || typeof value !== "object") return null;
  const type = normalizeText(value.type, 40);
  if (type === "music_control") return normalizeMusicAction(value);
  if (type === "create_reminder") {
    const match = String(value.time || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    const repeat = ["none", "daily", "weekdays", "weekends", "custom"].includes(value.repeat)
      ? value.repeat
      : "none";
    const days = Array.isArray(value.days)
      ? [...new Set(value.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
      : [];
    const message = normalizeText(value.message, 80);
    if (!message) return null;
    return {
      type,
      time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      message,
      repeat: repeat === "custom" && days.length === 0 ? "none" : repeat,
      days,
    };
  }
  if (type === "remember") {
    const key = normalizeText(value.key, 80);
    const storedValue = normalizeText(value.value, 500);
    return key && storedValue ? { type, key, value: storedValue } : null;
  }
  if (type === "forget_memory") {
    const key = normalizeText(value.key, 80);
    return key ? { type, key } : null;
  }
  if (type === "create_task") {
    const title = normalizeText(value.title, 160);
    return title ? { type, title } : null;
  }
  if (type === "complete_task") {
    const id = normalizeText(value.id, 120);
    return id ? { type, id } : null;
  }
  if (type === "check_classroom" || type === "sync_classroom") return { type: "check_classroom" };
  if (type === "list_reminders" || type === "list_tasks") return { type };
  if (type === "open_url") {
    try {
      const url = new URL(String(value.url || "").trim());
      if (url.username || url.password) return null;
      return ["http:", "https:"].includes(url.protocol) ? { type, url: url.toString() } : null;
    } catch {
      return null;
    }
  }
  if (type === "open_app") {
    const name = normalizeText(value.name, 120);
    return name ? { type, name } : null;
  }
  if (type === "open_path") {
    const target = normalizeText(value.path, 500);
    return target ? { type, path: target } : null;
  }
  if (type === "run_command") {
    const command = normalizeText(value.command, 500);
    return command ? { type, command } : null;
  }
  return null;
}

function formatReminders() {
  const settings = readAppSettings();
  const reminders = Array.isArray(settings.reminders) ? settings.reminders : [];
  if (!reminders.length) return "You don't have any reminders yet.";
  return reminders
    .slice(0, 20)
    .map((item) => `• ${item.time} — ${item.message}${item.enabled === false ? " (disabled)" : ""}`)
    .join("\n");
}

function formatTasks() {
  const openTasks = tasks.filter((item) => !item.completed);
  if (!openTasks.length) return "You don't have any open tasks.";
  return openTasks.map((item) => `• ${item.id}: ${item.title}`).join("\n");
}

function applyInternalAction(action) {
  if (!action) return null;
  if (action.type === "remember") {
    const now = new Date().toISOString();
    const existing = memories.find((item) => item.key.toLowerCase() === action.key.toLowerCase());
    if (existing) {
      existing.value = action.value;
      existing.updatedAt = now;
    } else {
      memories.push({
        id: `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        key: action.key,
        value: action.value,
        createdAt: now,
        updatedAt: now,
      });
    }
    saveMemories();
    return `I'll remember that: ${action.key}.`;
  }
  if (action.type === "forget_memory") {
    const before = memories.length;
    memories = memories.filter((item) => item.key.toLowerCase() !== action.key.toLowerCase());
    saveMemories();
    return before === memories.length ? `I couldn't find a memory called ${action.key}.` : `I forgot ${action.key}.`;
  }
  if (action.type === "create_task") {
    const now = new Date().toISOString();
    const task = {
      id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: action.title,
      completed: false,
      createdAt: now,
    };
    tasks.push(task);
    saveTasks();
    return `Task added: ${task.title}`;
  }
  if (action.type === "complete_task") {
    const task = tasks.find((item) => item.id === action.id || item.title.toLowerCase() === action.id.toLowerCase());
    if (!task) return `I couldn't find an open task matching ${action.id}.`;
    task.completed = true;
    task.completedAt = new Date().toISOString();
    saveTasks();
    return `Task completed: ${task.title}`;
  }
  if (action.type === "list_reminders") return formatReminders();
  if (action.type === "list_tasks") return formatTasks();
  return null;
}

function needsConfirmation(action) {
  return Boolean(action && ["create_reminder", "open_url", "open_app", "open_path", "run_command", "music_control"].includes(action.type));
}

function canonicalAction(action) {
  return JSON.stringify(normalizeAction(action));
}

function approvalSubject(action) {
  // A user approving desktop control of one player should not have to approve
  // pause, resume, next, and status separately. Keep higher-risk actions bound
  // to their exact normalized payload.
  if (action?.type === "music_control") return { type: action.type, player: action.player };
  return normalizeAction(action);
}

function actionFingerprint(action) {
  return crypto.createHash("sha256").update(JSON.stringify(approvalSubject(action))).digest("hex");
}

function hasApprovalGrant(action) {
  if (!needsConfirmation(action)) return false;
  const fingerprint = actionFingerprint(action);
  const grant = approvalGrants.get(fingerprint);
  if (!grant) return false;
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) {
    approvalGrants.delete(fingerprint);
    saveApprovalGrants();
    return false;
  }
  grant.lastUsedAt = new Date().toISOString();
  saveApprovalGrants();
  return true;
}

function rememberApproval(action) {
  const fingerprint = actionFingerprint(action);
  approvalGrants.set(fingerprint, {
    fingerprint,
    scope: action.type === "music_control" ? `music_control:${action.player}` : action.type,
    label: action.type === "music_control" ? `${action.player} desktop controls` : actionDescription(action),
    createdAt: new Date().toISOString(),
    expiresAt: null,
    lastUsedAt: null,
  });
  saveApprovalGrants();
}

function isAutoOpenAction(action) {
  return Boolean(action && ["open_url", "open_app", "open_path"].includes(action.type));
}

function hasExplicitOpenIntent(message) {
  return /^(?:please\s+|can you\s+|could you\s+)?(?:open|launch|start|visit|go to)\b/i.test(String(message || "").trim());
}

function actionDescription(action) {
  if (!action) return "";
  if (action.type === "check_classroom") return "Check Google Classroom for assignments";
  if (action.type === "music_control") return `${action.command.replace(/_/g, " ")} in ${action.player === "spotify" ? "Spotify" : "Music"}${action.uri ? `: ${action.uri}` : ""} (macOS may ask for Automation permission)`;
  if (action.type === "create_reminder") {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const repeat = action.repeat === "custom" ? `on ${action.days.map((day) => dayNames[day]).join(", ")}` : action.repeat === "none" ? "one-time" : action.repeat;
    return `Create a ${repeat} reminder at ${action.time}: “${action.message}”`;
  }
  if (action.type === "open_url") return `Open ${action.url}`;
  if (action.type === "open_app") return `Open the ${action.name} app`;
  if (action.type === "open_path") return `Open ${action.path}`;
  if (action.type === "run_command") return `Run the approved command: ${action.command}`;
  return "Apply this action";
}

function buildAgentReply(userMessage, reply, action, internalResult = null, options = {}) {
  let finalReply = normalizeText(reply, 2_000);
  if (internalResult) finalReply = [finalReply, internalResult].filter(Boolean).join("\n\n");
  finalReply = normalizeText(finalReply, 2_000);
  if (!finalReply) finalReply = "I didn't get a response from the model.";
  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: finalReply });
  saveHistory();
  const autoExecuteAction = Boolean(options.autoExecuteAction);
  const confirmationRequired = !internalResult && !autoExecuteAction && needsConfirmation(action);
  const approvalToken = confirmationRequired ? crypto.randomBytes(24).toString("hex") : "";
  for (const [token, pending] of pendingActions) {
    if (pending.expiresAt < Date.now()) pendingActions.delete(token);
  }
  if (confirmationRequired) pendingActions.set(approvalToken, { action, expiresAt: Date.now() + 60_000 });
  return {
    ok: true,
    reply: finalReply,
    action: internalResult && !autoExecuteAction ? null : action,
    confirmationRequired,
    approvalToken,
    actionDescription: confirmationRequired ? actionDescription(action) : "",
    autoExecuteAction,
  };
}

function buildActionResultReply(userMessage, reply, action, result) {
  if (result?.reason === "renderer-action") {
    return buildAgentReply(userMessage, reply, action, null, { autoExecuteAction: true });
  }
  const response = buildAgentReply(userMessage, reply, action, result?.message || "The action did not complete.");
  if (result && result.ok === false) {
    response.ok = false;
    response.reason = result.reason || "action-error";
    response.message = result.message || "The action did not complete.";
  }
  return response;
}

async function handleCheckClassroom(userMessage = "") {
  loadState();
  if (!googleClassroom.isConnected()) {
    return {
      ok: true,
      message: "Google Classroom is not connected yet. Click Settings ⚙️ to connect, or run 'node connect-classroom.js' in your terminal.",
    };
  }

  try {
    const res = await googleClassroom.fetchAssignments();
    if (!res.ok) {
      if (res.error === "AUTH_EXPIRED") {
        return {
          ok: false,
          message: "Google Classroom authorization has expired. Please reconnect in Settings or run 'node connect-classroom.js'.",
        };
      }
      return {
        ok: false,
        message: `Could not fetch assignments from Google Classroom: ${res.message || res.error}`,
      };
    }

    const courses = res.courses || [];
    const pendingAssignments = res.pendingAssignments || res.assignments || [];
    const submittedAssignments = res.submittedAssignments || [];
    const allAssignments = res.allAssignments || [];
    const totalCount = res.totalCount || allAssignments.length;

    let addedCount = 0;
    const now = new Date().toISOString();
    for (const a of pendingAssignments) {
      const taskTitle = `[Classroom] ${a.courseName}: ${a.title}${a.dueDateFormatted ? ` (${a.dueDateFormatted})` : ""}`;
      const alreadyExists = tasks.some(
        (t) => t.title === taskTitle || t.classroomId === a.id || (t.title.includes(a.title) && !t.completed)
      );
      if (!alreadyExists) {
        tasks.push({
          id: `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          title: taskTitle,
          classroomId: a.id,
          link: a.link,
          dueDate: a.dueDate,
          deadline: a.dueDate,
          size: "Medium",
          completed: false,
          createdAt: now,
        });
        addedCount += 1;
      }
    }
    if (addedCount > 0) {
      saveTasks();
    }

    const query = String(userMessage || "").toLowerCase();

    // 1. If user specifically asks about subjects/courses
    const isSubjectQuery = /\b(subject|subjects|course|courses|class|classes)\b/i.test(query)
      && !/\b(assignment|assignments|homework|task|tasks|deadline|deadlines)\b/i.test(query);

    if (isSubjectQuery) {
      if (courses.length === 0) {
        return {
          ok: true,
          message: "You don't have any active subjects or courses enrolled in Google Classroom right now.",
        };
      }
      const courseListStr = courses.map((c, i) => {
        const details = [c.subject, c.section ? `Sec ${c.section}` : ""].filter(Boolean).join(", ");
        return `${i + 1}. **${c.name}**${details ? ` (${details})` : ""}`;
      }).join("\n");
      return {
        ok: true,
        message: `You have **${courses.length} active subject${courses.length > 1 ? "s" : ""}** in Google Classroom:\n\n${courseListStr}\n\nAcross your subjects, there are ${totalCount} assignments (${pendingAssignments.length} pending, ${submittedAssignments.length} submitted).`,
      };
    }

    // 2. If user asks "how many assignments" or asks to check "all" assignments / overview
    const isAllOrCountQuery = /\b(all|how many|total|count|overview|list all|every|submitted)\b/i.test(query);

    if (isAllOrCountQuery) {
      const lines = [];
      lines.push(`You have **${totalCount} assignment${totalCount === 1 ? "" : "s"}** in total in Google Classroom (${courses.length} subject${courses.length === 1 ? "" : "s"}):\n`);

      if (pendingAssignments.length > 0) {
        lines.push(`📝 **Pending (${pendingAssignments.length}):**`);
        pendingAssignments.forEach((a, i) => {
          const status = a.isOverdue ? "🐾 waiting for you" : a.dueDateFormatted === "No due date" ? "No due date" : `Due ${a.dueDateFormatted}`;
          lines.push(`  ${i + 1}. **${a.title}** (${a.courseName}) — ${status}`);
        });
      } else {
        lines.push(`🎉 **Pending:** None! All caught up.`);
      }

      if (submittedAssignments.length > 0) {
        lines.push(`\n✅ **Completed / Submitted (${submittedAssignments.length}):**`);
        submittedAssignments.slice(0, 5).forEach((a, i) => {
          lines.push(`  ${i + 1}. **${a.title}** (${a.courseName}) — Turned in`);
        });
        if (submittedAssignments.length > 5) {
          lines.push(`  ...and ${submittedAssignments.length - 5} more turned in`);
        }
      }

      if (addedCount > 0) {
        lines.push(`\n🐾 *Saved ${addedCount} pending assignment${addedCount > 1 ? "s" : ""} to your tasks list.*`);
      }

      return {
        ok: true,
        message: lines.join("\n"),
      };
    }

    // 3. Default check / sync assignments query
    if (pendingAssignments.length === 0) {
      const courseSummary = courses.length > 0 ? `across your ${courses.length} subject${courses.length > 1 ? "s" : ""} (${courses.map((c) => c.name).join(", ")})` : "";
      return {
        ok: true,
        message: `I checked your Google Classroom! 🐾 You're all caught up—you have **0 pending assignments** right now${courseSummary ? ` ${courseSummary}` : ""} (${submittedAssignments.length} submitted).`,
      };
    }

    const items = pendingAssignments.map((a, i) => {
      const status = a.isOverdue ? "🐾 waiting for you" : a.dueDateFormatted === "No due date" ? "No due date" : `Due ${a.dueDateFormatted}`;
      return `${i + 1}. **${a.title}** (${a.courseName}) — ${status}`;
    }).join("\n");

    const savedSummary = addedCount > 0
      ? `I've saved ${addedCount} assignment${addedCount > 1 ? "s" : ""} to your tasks list!`
      : `All pending assignments are in your tasks list.`;

    const extraNote = submittedAssignments.length > 0 ? `\n(You also have ${submittedAssignments.length} already submitted.)` : "";

    return {
      ok: true,
      message: `Found **${pendingAssignments.length} pending assignment${pendingAssignments.length > 1 ? "s" : ""}** in Google Classroom:\n\n${items}\n${extraNote}\n\n🐾 ${savedSummary}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Failed to check Google Classroom: ${err.message}`,
    };
  }
}

function isTaskPrioritizationRequest(text) {
  return catEnergy.isTaskPrioritizationRequest(text);
}

function prioritizeTasksLocally(text, energyLevel = 3) {
  const result = catEnergy.prioritizeTasks(text, energyLevel);
  return { reply: result.reply, action: null };
}

function broadcastTasksUpdated() {
  try {
    const { BrowserWindow } = require("electron");
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("planner-tasks-changed");
      }
    });
  } catch (_) {}
}

function notifyCatSpeech(text) {
  try {
    const { BrowserWindow, Notification } = require("electron");
    try {
      if (Notification && typeof Notification.isSupported === "function" && Notification.isSupported()) {
        new Notification({ title: "Comnyang", body: text.replace(/^🐾\s*/, "") }).show();
      }
    } catch (_) {}
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("cat-speech", { text, kind: "reminder", duration: 5200 });
      }
    });
  } catch (_) {}
}

function syncChatTasksToPlanner(userMessage) {
  try {
    const planner = require("./planner-lite");
    const extracted = planner.extractTasksFromChat(userMessage);
    if (!extracted || extracted.length === 0) return [];

    loadState();
    const addedTasks = [];

    for (const item of extracted) {
      const normalizedTitle = item.title.toLowerCase();
      const existing = tasks.find((t) => !t.completed && t.title.toLowerCase() === normalizedTitle);
      if (!existing) {
        const newTask = {
          id: `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          title: item.title,
          deadline: item.deadline || null,
          size: item.size || "Medium",
          extraInfo: item.extraInfo || "",
          notify: typeof item.notify === "boolean" ? item.notify : Boolean(item.deadline),
          lastNotifiedDate: null,
          completed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        tasks.push(newTask);
        addedTasks.push(newTask);
      } else if (item.deadline && !existing.deadline) {
        existing.deadline = item.deadline;
        existing.updatedAt = new Date().toISOString();
        addedTasks.push(existing);
      }
    }

    if (addedTasks.length > 0) {
      saveTasks();
      broadcastTasksUpdated();
      runDueTasksCheck();
    }
    return addedTasks;
  } catch (err) {
    console.warn("[agent-main] Failed to sync chat tasks to planner:", err?.message);
    return [];
  }
}

function runDueTasksCheck() {
  try {
    loadState();
    const planner = require("./planner-lite");
    const dueNotifications = planner.getInstance().checkDueTasksForNotification(new Date(), tasks);
    if (dueNotifications && dueNotifications.length > 0) {
      saveTasks();
      for (const n of dueNotifications) {
        notifyCatSpeech(n.message);
      }
    }
  } catch (_) {}
}

try {
  setInterval(runDueTasksCheck, 60 * 1000);
  setTimeout(runDueTasksCheck, 5000);
} catch (_) {}

async function askModel(prompt) {
  loadState();
  const userMessage = normalizeText(prompt, 2_000);
  if (!userMessage) return { ok: false, reason: "empty" };

  // Sync any tasks/deadlines mentioned by the user to My tasks
  const addedTasks = syncChatTasksToPlanner(userMessage);
  let savedTasksNote = "";
  if (addedTasks.length > 0) {
    const listBullets = addedTasks.map((t) => {
      const dueStr = t.deadline ? ` (Due: ${t.deadline})` : "";
      return `• **${t.title}**${dueStr} · ${t.size}`;
    }).join("\n");
    savedTasksNote = `\n\n🐾 *I stored ${addedTasks.length === 1 ? "this task" : "these tasks"} in your **My tasks** list:*\n${listBullets}`;
  }

  const withNote = (result) => {
    if (savedTasksNote && result?.reply && !result.reply.includes("stored") && !result.reply.includes("My tasks")) {
      return { ...result, reply: result.reply + savedTasksNote };
    }
    return result;
  };

  // Useful local commands still work while the model provider is unavailable.
  const shortcut = inferShortcut(userMessage);
  if (shortcut) {
    const action = normalizeAction(shortcut.action);
    if (action?.type === "check_classroom") {
      const classroomResult = await handleCheckClassroom(userMessage);
      return withNote(buildActionResultReply(userMessage, shortcut.reply, action, classroomResult));
    }
    if (isAutoOpenAction(action)) {
      const result = await executeOpenAction(action);
      return withNote(buildActionResultReply(userMessage, shortcut.reply, action, result));
    }
    const internalResult = applyInternalAction(action);
    if (!internalResult && hasApprovalGrant(action)) {
      return withNote(buildActionResultReply(userMessage, shortcut.reply, action, await executeAction(action, "", "always")));
    }
    return withNote(buildAgentReply(userMessage, shortcut.reply, action, internalResult));
  }

  // Fast local task prioritization if model is not configured
  if (isTaskPrioritizationRequest(userMessage) && !config.apiKey && !isLocalEndpoint(config.baseUrl)) {
    const localResult = prioritizeTasksLocally(userMessage, catEnergy.getEnergyLevel());
    return withNote(buildAgentReply(userMessage, localResult.reply, null));
  }

  const systemPrompt = buildSystemPrompt();
  const messages = [
    { role: "system", content: systemPrompt },
    ...buildPromptHistory(userMessage, systemPrompt),
    { role: "user", content: userMessage },
  ];
  let payload;
  try {
    payload = await requestModel(messages, {
      maxTokens: isGeminiEndpoint(config.baseUrl) ? GEMINI_TOKEN_BUDGET : 1_200,
    });
  } catch (error) {
    if (isTaskPrioritizationRequest(userMessage)) {
      console.warn("[Comnyang] model request failed, falling back to local energy task prioritization:", error?.message);
      const localResult = prioritizeTasksLocally(userMessage, catEnergy.getEnergyLevel());
      return withNote(buildAgentReply(userMessage, localResult.reply, null));
    }
    if ((error?.code === "AGENT_RATE_LIMIT" || error?.code === "AGENT_TIMEOUT")
        && (config.model || "").includes("3.8")
        && isGeminiEndpoint(config.baseUrl)) {
      console.warn(`[Comnyang] falling back from ${config.model} to gemini-3.5-flash-lite due to ${error.code}`);
      payload = await requestModel(messages, {
        model: "gemini-3.5-flash-lite",
        maxTokens: GEMINI_TOKEN_BUDGET,
      });
    } else {
      throw error;
    }
  }
  const rawContent = extractMessageContent(payload);
  const parsed = parseJsonReply(rawContent);
  const reply = normalizeText(parsed?.reply || rawContent, 2_000) || "I didn't get a response from the model.";
  const action = normalizeAction(parsed?.action);
  if (action?.type === "check_classroom") {
    const classroomResult = await handleCheckClassroom(userMessage);
    return withNote(buildActionResultReply(userMessage, reply, action, classroomResult));
  }
  const internalResult = applyInternalAction(action);
  if (isAutoOpenAction(action) && hasExplicitOpenIntent(userMessage)) {
    const result = await executeOpenAction(action);
    return withNote(buildActionResultReply(userMessage, reply, action, result));
  }
  if (!internalResult && hasApprovalGrant(action)) {
    return withNote(buildActionResultReply(userMessage, reply, action, await executeAction(action, "", "always")));
  }
  return withNote(buildAgentReply(userMessage, reply, action, internalResult));
}

function expandUserPath(value) {
  const text = String(value || "").trim();
  const expanded = text.startsWith("~") ? path.join(os.homedir(), text.slice(1)) : text;
  return path.resolve(expanded);
}

function parseCommand(value) {
  const tokens = [];
  const matcher = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g;
  let match;
  while ((match = matcher.exec(String(value || "")))) tokens.push(match[1] || match[2] || match[3]);
  return { command: tokens[0] || "", args: tokens.slice(1) };
}

function getAllowedExecutable(command) {
  const basename = path.basename(command).toLowerCase();
  const allowed = process.platform === "darwin"
    ? { open: "/usr/bin/open", say: "/usr/bin/say" }
    : process.platform === "win32"
      ? { "explorer.exe": `${process.env.WINDIR || "C:\\Windows"}\\explorer.exe` }
      : { "xdg-open": "/usr/bin/xdg-open", "notify-send": "/usr/bin/notify-send" };
  if (!allowed[basename]) return null;
  if (command.includes("/") || command.includes("\\")) return command === allowed[basename] ? command : null;
  return allowed[basename];
}

async function executeOpenAction(normalized) {
  const bounded = (work, timeout = 10_000) => Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("Opening the target took too long."), { code: "OPEN_TIMEOUT" })), timeout)),
  ]);
  if (normalized.type === "open_url") {
    try {
      await bounded(() => appLauncher.openInBrave(normalized.url, shell));
      return { ok: true, message: "Opened the link in Brave." };
    } catch (error) {
      if (error?.code === "OPEN_TIMEOUT") return { ok: false, reason: "open-timeout", message: "The browser took too long to open the link. Check your default browser and try again." };
      return { ok: false, reason: "open-failed", message: "The browser could not open the link. Check your default browser and try again." };
    }
  }
  if (normalized.type === "open_app") {
    if (process.platform === "darwin") {
      return new Promise((resolve) => {
        execFile("/usr/bin/open", ["-a", normalized.name], { timeout: 10_000, shell: false }, (error) => {
          resolve(error ? { ok: false, reason: "open-failed", message: `Could not open ${normalized.name}. Check that it is installed.` }
            : { ok: true, message: `Opened ${normalized.name}` });
        });
      });
    }
    try {
      const result = await bounded(() => appLauncher.openTarget(normalized.name, shell));
      if (result.ok) {
        if (result.mode === "app") {
          return { ok: true, message: `Opened ${result.appName || result.target}.` };
        } else {
          return { ok: true, message: `Opened ${result.target} in Brave.` };
        }
      }
      return { ok: false, reason: "open-failed", message: `Could not open ${normalized.name}.` };
    } catch (error) {
      if (error?.code === "OPEN_TIMEOUT") return { ok: false, reason: "open-timeout", message: "Opening the target took too long." };
      return { ok: false, reason: "open-failed", message: `Could not open ${normalized.name}: ${error?.message || error}` };
    }
  }
  if (normalized.type === "open_path") {
    const target = expandUserPath(normalized.path);
    if (!fs.existsSync(target)) return { ok: false, reason: "not-found", message: `I couldn't find ${target}.` };
    try {
      const error = await bounded(() => shell.openPath(target));
      return error ? { ok: false, reason: "open-failed", message: error } : { ok: true, message: `Opened ${target}` };
    } catch (error) {
      return { ok: false, reason: "open-timeout", message: error?.code === "OPEN_TIMEOUT"
        ? "Opening that file took too long. Check Finder and try again."
        : "The file could not be opened. Check Finder and try again." };
    }
  }
  return { ok: false, reason: "invalid-action", message: "That is not an opening action." };
}

async function executeActionNow(normalized) {
  if (isAutoOpenAction(normalized)) return executeOpenAction(normalized);
  if (normalized.type === "music_control") return executeMusicAction(normalized);
  if (normalized.type === "run_command") {
    const parsed = parseCommand(normalized.command);
    const executable = getAllowedExecutable(parsed.command);
    if (!executable) {
      return { ok: false, reason: "command-not-allowed", message: "That command is not on the cat's safe allowlist." };
    }
    const child = spawn(executable, parsed.args, {
      cwd: os.homedir(),
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();
    return { ok: true, message: `Started ${normalized.command}` };
  }
  if (normalized.type === "create_reminder") {
    return { ok: false, reason: "renderer-action", message: "This reminder must be completed by the desktop UI." };
  }
  return { ok: false, reason: "invalid-action", message: "That action is not available." };
}

async function executeAction(action, approvalToken, decision = "once") {
  loadState();
  const normalized = normalizeAction(action);
  if (!normalized) return { ok: false, reason: "invalid-action" };
  const pending = pendingActions.get(String(approvalToken || ""));
  const tokenIsValid = pending && pending.expiresAt >= Date.now() && canonicalAction(pending.action) === canonicalAction(normalized);
  const grantIsValid = !approvalToken && hasApprovalGrant(normalized);
  if (!tokenIsValid && !grantIsValid) {
    return { ok: false, reason: "approval-required", message: "This action needs a fresh approval from the cat panel." };
  }
  if (tokenIsValid) {
    pendingActions.delete(String(approvalToken));
    if (decision === "always") rememberApproval(normalized);
  }
  return executeActionNow(normalized);
}

function setPanelOpen(event, isOpen) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return { ok: false };
  if (isOpen) {
    if (!pendingPanelBounds.has(window.id)) pendingPanelBounds.set(window.id, window.getBounds());
    const current = window.getBounds();
    const width = Math.max(current.width, 380);
    const height = Math.max(current.height, 560);
    window.setBounds({
      x: Math.round(current.x - (width - current.width) / 2),
      y: Math.max(0, current.y + current.height - height),
      width,
      height,
    });
    window.focus();
    return { ok: true, open: true };
  }
  const original = pendingPanelBounds.get(window.id);
  if (original) {
    window.setBounds(original);
    pendingPanelBounds.delete(window.id);
  }
  return { ok: true, open: false };
}

ipcMain.handle("agent-state-get", () => getPublicState());
ipcMain.handle("agent-config-set", (_event, values = {}) => updateConfig(values));
ipcMain.handle("agent-config-test", () => testModelConnection());
ipcMain.handle("agent-ask", async (_event, prompt) => {
  try {
    return await askModel(prompt);
  } catch (error) {
    logModelFailure("ask", error);
    return {
      ok: false,
      reason: error.code || "model-error",
      message: error.message || "The cat couldn't reach the model.",
    };
  }
});
ipcMain.handle("agent-action-execute", async (_event, payload) => {
  try {
    return await executeAction(payload?.action, payload?.approvalToken, payload?.decision);
  } catch (error) {
    return { ok: false, reason: "action-error", message: error.message || "The action failed." };
  }
});
ipcMain.handle("agent-approvals-clear", () => {
  loadState();
  approvalGrants.clear();
  saveApprovalGrants();
  return { ok: true };
});
ipcMain.handle("agent-history-clear", () => {
  loadState();
  history = [];
  saveHistory();
  return getPublicState();
});
ipcMain.handle("agent-memory-delete", (_event, id) => {
  loadState();
  memories = memories.filter((item) => item.id !== id);
  saveMemories();
  return getPublicState();
});
ipcMain.handle("agent-panel-set-open", setPanelOpen);

try {
  ipcMain.handle("planner-tasks-get", () => {
    loadState();
    const planner = require("./planner-lite");
    return tasks.filter((t) => !t.completed).map((t) => planner.getInstance().normalizeTask(t));
  });

  ipcMain.handle("planner-task-add", (_event, data) => {
    loadState();
    const planner = require("./planner-lite");
    const rawTitle = String(data?.title || "").trim();
    if (!rawTitle) return { ok: false, error: "Empty title" };
    const size = data?.size || "Small";
    const deadline = data?.deadline || null;
    const extraInfo = data?.extraInfo || "";
    const notify = typeof data?.notify === "boolean" ? data.notify : Boolean(deadline);
    const task = {
      id: `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      title: planner.sanitizeForbiddenWords(rawTitle),
      deadline: deadline ? String(deadline).trim() : null,
      size: size,
      extraInfo: extraInfo ? planner.sanitizeForbiddenWords(String(extraInfo).trim()) : "",
      notify,
      lastNotifiedDate: null,
      completed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tasks.push(task);
    saveTasks();
    broadcastTasksUpdated();
    runDueTasksCheck();
    return { ok: true, task: planner.getInstance().normalizeTask(task) };
  });

  ipcMain.handle("planner-task-update", (_event, payload) => {
    loadState();
    const planner = require("./planner-lite");
    const id = payload?.id;
    const updates = payload?.updates || {};
    const task = tasks.find((t) => t.id === id);
    if (!task) return { ok: false, error: "Not found" };

    if (typeof updates.title === "string" && updates.title.trim()) {
      task.title = planner.sanitizeForbiddenWords(updates.title.trim());
    }
    if (typeof updates.deadline !== "undefined") {
      task.deadline = updates.deadline ? String(updates.deadline).trim() : null;
    }
    if (typeof updates.size === "string") {
      task.size = planner.normalizeTaskSize(updates.size);
      task.minutes = planner.SIZE_MINUTES[task.size];
    }
    if (typeof updates.extraInfo !== "undefined") {
      task.extraInfo = updates.extraInfo ? planner.sanitizeForbiddenWords(String(updates.extraInfo).trim()) : "";
    }
    if (typeof updates.notify !== "undefined") {
      task.notify = Boolean(updates.notify);
    }
    if (typeof updates.completed === "boolean") {
      task.completed = updates.completed;
    }
    task.updatedAt = new Date().toISOString();
    saveTasks();
    broadcastTasksUpdated();
    runDueTasksCheck();
    return { ok: true, task: planner.getInstance().normalizeTask(task) };
  });

  ipcMain.handle("planner-task-delete", (_event, id) => {
    loadState();
    const before = tasks.length;
    tasks = tasks.filter((t) => t.id !== id);
    if (tasks.length !== before) {
      saveTasks();
      broadcastTasksUpdated();
      return { ok: true };
    }
    return { ok: false };
  });

  ipcMain.handle("planner-today-pick", (_event, params) => {
    loadState();
    const planner = require("./planner-lite");
    const catEnergy = require("./cat-energy");
    const level = Number(params?.energyLevel) || catEnergy.getEnergyLevel();
    const normalizedTasks = tasks.filter((t) => !t.completed).map((t) => planner.getInstance().normalizeTask(t));
    const pick = planner.pickTask(level, normalizedTasks);
    const heavyWarning = planner.checkHeavyWeek(level, normalizedTasks);
    return {
      ...pick,
      heavyWarning: heavyWarning.warn ? heavyWarning : null,
    };
  });
} catch (_) {}

async function handleRpc(method, payload) {
  if (method === "state-get") return getPublicState();
  if (method === "config-set") {
    return updateConfig(payload && typeof payload === "object" ? payload : {});
  }
  if (method === "config-test") return testModelConnection();
  if (method === "ask") {
    try {
      return await askModel(payload?.prompt);
    } catch (error) {
      logModelFailure("ask", error);
      return {
        ok: false,
        reason: error.code || "model-error",
        message: error.message || "The cat couldn't reach the model.",
      };
    }
  }
  if (method === "action-execute") return executeAction(payload?.action, payload?.approvalToken, payload?.decision);
  if (method === "approvals-clear") {
    loadState();
    approvalGrants.clear();
    saveApprovalGrants();
    return { ok: true };
  }
  if (method === "history-clear") {
    loadState();
    history = [];
    saveHistory();
    return getPublicState();
  }
  if (method === "memory-delete") {
    loadState();
    memories = memories.filter((item) => item.id !== payload?.id);
    saveMemories();
    return getPublicState();
  }
  if (method === "panel-set-open") {
    const window = BrowserWindow.getAllWindows().find((candidate) => {
      if (candidate.isDestroyed()) return false;
      const url = candidate.webContents.getURL();
      return url.includes("renderer/index.html");
    }) || BrowserWindow.getAllWindows()[0];
    if (!window || window.isDestroyed()) return { ok: false };
    return setPanelOpen({ sender: window.webContents }, Boolean(payload?.open));
  }
  return { ok: false, reason: "unknown-method" };
}

const requestedRpcPort = Number(process.env.COMNYANG_AGENT_PORT || 23457);
let rpcPort = requestedRpcPort;
function installRendererToken(window) {
  window.webContents.on("did-finish-load", () => {
    const url = window.webContents.getURL();
    if (!url.includes("renderer/index.html")) return;
    const script = `window.__COMNYANG_AGENT_PORT=${rpcPort};window.__COMNYANG_AGENT_TOKEN=${JSON.stringify(rpcToken)};`;
    window.webContents.executeJavaScript(script).catch(() => {});
  });
}

app.on("browser-window-created", (_event, window) => installRendererToken(window));

const rpcServer = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Comnyang-Agent-Token");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== "POST" || request.url !== "/agent-rpc") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, reason: "not-found" }));
    return;
  }
  if (request.headers["x-comnyang-agent-token"] !== rpcToken) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, reason: "unauthorized" }));
    return;
  }
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 100_000) request.destroy();
  });
  request.on("end", async () => {
    try {
      const input = JSON.parse(body || "{}");
      const result = await handleRpc(input.method, input.payload);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, reason: "rpc-error", message: error.message }));
    }
  });
});
rpcServer.on("error", (error) => {
  console.warn("[Comnyang] agent RPC server unavailable:", error.message);
});
rpcServer.listen(requestedRpcPort, "127.0.0.1", () => {
  const address = rpcServer.address();
  if (address && typeof address === "object") rpcPort = address.port;
  console.log(`[Comnyang] personal agent RPC listening on 127.0.0.1:${rpcPort}`);
});
app.on("will-quit", () => {
  if (rpcServer.listening) rpcServer.close();
});

function getStudentTaskTinyStep(energyLevel = 3) {
  loadState();
  let taskList = [];

  // 1. Check recent conversation history for tasks told by student
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg && msg.role === "user" && catEnergy.isTaskPrioritizationRequest(msg.content)) {
      const extracted = catEnergy.extractTaskItems(msg.content);
      if (extracted.length > 0) {
        taskList = extracted;
        break;
      }
    }
  }

  // 2. Fallback to open tasks in tasks.json
  if (taskList.length === 0 && tasks && tasks.length > 0) {
    taskList = tasks
      .filter((t) => !t.completed)
      .map((t) => t.title.replace(/^\[Classroom\]\s*[^:]+:\s*/i, "").trim());
  }

  const num = Number(energyLevel) || 3;
  const info = catEnergy.getEnergyInfo(num) || { level: 3, name: "Chill", emoji: "😸" };

  if (taskList.length === 0) {
    return {
      hasTasks: false,
      energyInfo: info,
    };
  }

  const result = catEnergy.prioritizeTasks(taskList.join("\n"), num);
  const topTask = result.prioritized[0] || taskList[0];
  const tinyStep = result.strategy?.tinyStep || catEnergy.generateConcreteTinyStep(topTask, num);

  return {
    hasTasks: true,
    topTask,
    tinyStep,
    prioritized: result.prioritized,
    energyInfo: info,
  };
}

let tinyStepAIInstance = null;
function getTinyStepAI() {
  if (!tinyStepAIInstance) {
    try {
      const { TinyStepAI } = require("./tiny-step-ai");
      const modelClient = require("./agent-model-client");
      tinyStepAIInstance = new TinyStepAI({
        modelClient,
        configProvider: () => {
          loadState();
          return {
            baseUrl: config.baseUrl,
            model: config.model,
            apiKey: config.apiKey,
          };
        },
        fetch: (url, opts) => (typeof net !== "undefined" && net && net.fetch ? net.fetch(url, opts) : globalThis.fetch(url, opts)),
      });
    } catch (e) {
      console.warn("[agent-main] Failed to initialize TinyStepAI:", e?.message);
    }
  }
  return tinyStepAIInstance;
}

try {
  ipcMain.handle("student-tiny-step-get", (_e, level) => getStudentTaskTinyStep(level));
} catch (_) {}

try {
  ipcMain.handle("tiny-step-ai-generate", async (_e, params) => {
    const ai = getTinyStepAI();
    if (!ai) {
      const { DEFAULT_OFFLINE_STEPS } = require("./tiny-step-ai");
      const lvl = Number(params?.energyLevel) || 3;
      return {
        isSafetyResponse: false,
        step: DEFAULT_OFFLINE_STEPS[lvl]?.step || DEFAULT_OFFLINE_STEPS[3].step,
        matchedTrick: null,
        energyLevel: lvl,
      };
    }
    return await ai.getTinyStep(params || {});
  });
} catch (_) {}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isTaskPrioritizationRequest,
    prioritizeTasksLocally,
    getStudentTaskTinyStep,
    buildSystemPrompt,
    getTinyStepAI,
  };
}

