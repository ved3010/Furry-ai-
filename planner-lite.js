"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const TASK_SIZES = {
  SMALL: "Small",
  MEDIUM: "Medium",
  BIG: "Big",
};

const SIZE_MINUTES = {
  Small: 15,
  Medium: 45,
  Big: 120,
};

const DAILY_CAPACITIES = {
  1: 10,
  2: 30,
  3: 60,
  4: 90,
  5: 120,
};

const FORBIDDEN_WORDS = ["overdue", "late", "behind", "failed"];

function getDefaultTasksPath() {
  try {
    const electron = require("electron");
    const app = electron.app || electron.remote?.app;
    if (app && typeof app.getPath === "function") {
      return path.join(app.getPath("userData"), "agent", "tasks.json");
    }
  } catch (_) {}

  const home = os.homedir();
  let baseDir;
  if (process.platform === "win32") {
    baseDir = process.env.APPDATA ? path.join(process.env.APPDATA, "furry") : path.join(home, "AppData", "Roaming", "furry");
  } else if (process.platform === "darwin") {
    baseDir = path.join(home, "Library", "Application Support", "furry");
  } else {
    baseDir = process.env.XDG_CONFIG_HOME || path.join(home, ".config", "furry");
  }
  return path.join(baseDir, "agent", "tasks.json");
}

function getDefaultPlannerSettingsPath() {
  try {
    const electron = require("electron");
    const app = electron.app || electron.remote?.app;
    if (app && typeof app.getPath === "function") {
      return path.join(app.getPath("userData"), "planner-settings.json");
    }
  } catch (_) {}

  const home = os.homedir();
  let baseDir;
  if (process.platform === "win32") {
    baseDir = process.env.APPDATA ? path.join(process.env.APPDATA, "furry") : path.join(home, "AppData", "Roaming", "furry");
  } else if (process.platform === "darwin") {
    baseDir = path.join(home, "Library", "Application Support", "furry");
  } else {
    baseDir = process.env.XDG_CONFIG_HOME || path.join(home, ".config", "furry");
  }
  return path.join(baseDir, "planner-settings.json");
}

function checkNoForbiddenWords(text) {
  if (!text || typeof text !== "string") return true;
  const lower = text.toLowerCase();
  for (const word of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(lower)) {
      return false;
    }
  }
  return true;
}

function sanitizeForbiddenWords(text) {
  if (!text || typeof text !== "string") return "";
  let s = text;
  s = s.replace(/\boverdue\b/gi, "waiting for you");
  s = s.replace(/\blate\b/gi, "waiting");
  s = s.replace(/\bbehind\b/gi, "in progress");
  s = s.replace(/\bfailed\b/gi, "needs attention");
  return s;
}

function normalizeTaskSize(size, isClassroom = false) {
  if (!size || typeof size !== "string") {
    return isClassroom ? TASK_SIZES.MEDIUM : TASK_SIZES.SMALL;
  }
  const s = size.trim().toLowerCase();
  if (s.startsWith("small") || s === "15" || s === "15m" || s === "15 min") return TASK_SIZES.SMALL;
  if (s.startsWith("medium") || s === "45" || s === "45m" || s === "45 min") return TASK_SIZES.MEDIUM;
  if (s.startsWith("big") || s === "120" || s === "120m" || s === "120 min") return TASK_SIZES.BIG;
  return isClassroom ? TASK_SIZES.MEDIUM : TASK_SIZES.SMALL;
}

function getDeadlineTimestamp(task) {
  const d = task.deadline || task.dueDate;
  if (!d) return Number.MAX_SAFE_INTEGER;
  const ts = new Date(d).getTime();
  return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
}

function compareDeadline(a, b) {
  const tsA = getDeadlineTimestamp(a);
  const tsB = getDeadlineTimestamp(b);
  if (tsA !== tsB) return tsA - tsB;
  return (a.createdAt || "").localeCompare(b.createdAt || "") || (a.id || "").localeCompare(b.id || "");
}

function formatDeadlineDate(deadline, now = new Date()) {
  if (!deadline) return "";
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return "";

  const nowDate = new Date(now);
  nowDate.setHours(0, 0, 0, 0);
  const targetDate = new Date(d);
  targetDate.setHours(0, 0, 0, 0);

  const diffMs = targetDate.getTime() - nowDate.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    // Missed deadline: NEVER say overdue or late! Say 'waiting for you'
    return "waiting for you";
  }
  if (diffDays === 0) {
    return "Due today";
  }
  if (diffDays === 1) {
    return "Due tomorrow";
  }
  return `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

class PlannerLite {
  constructor(options = {}) {
    this.storagePath = options.storagePath || getDefaultTasksPath();
    this.settingsPath = options.settingsPath || getDefaultPlannerSettingsPath();
    this.timeProvider = options.timeProvider || null;
    this.cachedTasks = null;
    this.lastWarningDate = null;
    this.loadSettings();
  }

  now() {
    if (typeof this.timeProvider === "function") {
      return this.timeProvider();
    }
    return new Date();
  }

  setStoragePath(tasksPath, settingsPath) {
    this.storagePath = tasksPath;
    if (settingsPath) this.settingsPath = settingsPath;
    this.cachedTasks = null;
    this.loadSettings();
  }

  loadSettings() {
    try {
      if (this.settingsPath && fs.existsSync(this.settingsPath)) {
        const data = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
        if (typeof data.lastHeavyWarningDate === "string") {
          this.lastWarningDate = data.lastHeavyWarningDate;
        }
      }
    } catch (_) {}
  }

  saveSettings() {
    try {
      if (!this.settingsPath) return;
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.settingsPath,
        JSON.stringify({ lastHeavyWarningDate: this.lastWarningDate }, null, 2),
        "utf8"
      );
    } catch (_) {}
  }

  loadTasks() {
    try {
      if (this.storagePath && fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, "utf8");
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          this.cachedTasks = list.map((item) => this.normalizeTask(item));
          return this.cachedTasks;
        }
      }
    } catch (_) {}
    this.cachedTasks = [];
    return this.cachedTasks;
  }

  saveTasks(list) {
    try {
      if (!this.storagePath) return;
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const items = (Array.isArray(list) ? list : this.cachedTasks || []).map((t) => this.normalizeTask(t));
      this.cachedTasks = items;
      fs.writeFileSync(this.storagePath, JSON.stringify(items, null, 2), "utf8");
    } catch (e) {
      console.warn("[PlannerLite] Failed to save tasks:", e?.message);
    }
  }

  normalizeTask(item) {
    if (!item || typeof item !== "object") return null;
    const isClassroom = Boolean(item.classroomId || (item.source && String(item.source).includes("Classroom")));
    const size = normalizeTaskSize(item.size, isClassroom);
    const deadline = item.deadline || item.dueDate || null;
    const rawTitle = String(item.title || "Untitled task").trim();
    const title = sanitizeForbiddenWords(rawTitle);
    const extraInfo = typeof item.extraInfo === "string" ? sanitizeForbiddenWords(item.extraInfo.trim()) : "";
    const notify = typeof item.notify === "boolean" ? item.notify : Boolean(deadline);

    return {
      id: item.id || `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      title,
      deadline: deadline ? String(deadline).trim() : null,
      size,
      minutes: SIZE_MINUTES[size] || 15,
      extraInfo,
      notify,
      lastNotifiedDate: item.lastNotifiedDate || null,
      completed: Boolean(item.completed),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
      classroomId: item.classroomId || null,
      link: item.link || null,
    };
  }

  getOpenTasks() {
    const all = this.loadTasks();
    return all.filter((t) => t && !t.completed);
  }

  addTask({ title, deadline = null, size = TASK_SIZES.SMALL, extraInfo = "", notify = null }) {
    const rawTitle = String(title || "").trim();
    if (!rawTitle) return null;
    const cleanTitle = sanitizeForbiddenWords(rawTitle);
    const normalizedSize = normalizeTaskSize(size);
    const all = this.loadTasks();

    const task = {
      id: `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      title: cleanTitle,
      deadline: deadline ? String(deadline).trim() : null,
      size: normalizedSize,
      minutes: SIZE_MINUTES[normalizedSize],
      extraInfo: extraInfo ? sanitizeForbiddenWords(String(extraInfo).trim()) : "",
      notify: typeof notify === "boolean" ? notify : Boolean(deadline),
      lastNotifiedDate: null,
      completed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    all.push(task);
    this.saveTasks(all);
    return task;
  }

  updateTask(id, updates = {}) {
    const all = this.loadTasks();
    const task = all.find((t) => t.id === id);
    if (!task) return null;

    if (typeof updates.title === "string" && updates.title.trim()) {
      task.title = sanitizeForbiddenWords(updates.title.trim());
    }
    if (typeof updates.deadline !== "undefined") {
      task.deadline = updates.deadline ? String(updates.deadline).trim() : null;
    }
    if (typeof updates.size === "string") {
      task.size = normalizeTaskSize(updates.size);
      task.minutes = SIZE_MINUTES[task.size];
    }
    if (typeof updates.extraInfo !== "undefined") {
      task.extraInfo = updates.extraInfo ? sanitizeForbiddenWords(String(updates.extraInfo).trim()) : "";
    }
    if (typeof updates.notify !== "undefined") {
      task.notify = Boolean(updates.notify);
    }
    if (typeof updates.completed === "boolean") {
      task.completed = updates.completed;
    }
    task.updatedAt = new Date().toISOString();

    this.saveTasks(all);
    return task;
  }

  deleteTask(id) {
    const all = this.loadTasks();
    const filtered = all.filter((t) => t.id !== id);
    if (filtered.length !== all.length) {
      this.saveTasks(filtered);
      return true;
    }
    return false;
  }

  /**
   * Pick ONE task according to energy level rules:
   * - Energy 1: smallest task, or 'Rest is fine today' if there is no small one
   * - Energy 2: a Small task
   * - Energy 3: a Medium task or the most urgent Small one
   * - Energy 4: the most urgent task up to Medium
   * - Energy 5: the most urgent or biggest task
   * If two tasks fit equally, choose the earlier deadline.
   */
  pickTask(energyLevel = 3, tasksList = null) {
    const openTasks = (tasksList || this.getOpenTasks()).filter((t) => t && !t.completed);
    const level = Math.max(1, Math.min(5, Number(energyLevel) || 3));

    if (openTasks.length === 0) {
      return {
        task: null,
        isRestFine: true,
        message: "Rest is fine today",
        energyLevel: level,
      };
    }

    const smallTasks = openTasks.filter((t) => t.size === TASK_SIZES.SMALL).sort(compareDeadline);
    const mediumTasks = openTasks.filter((t) => t.size === TASK_SIZES.MEDIUM).sort(compareDeadline);
    const bigTasks = openTasks.filter((t) => t.size === TASK_SIZES.BIG).sort(compareDeadline);

    let picked = null;

    if (level === 1) {
      // Energy 1 gives the smallest task, or 'Rest is fine today' if there is no small one
      if (smallTasks.length > 0) {
        picked = smallTasks[0];
        return {
          task: picked,
          isRestFine: false,
          message: null,
          energyLevel: level,
        };
      }
      return {
        task: null,
        isRestFine: true,
        message: "Rest is fine today",
        energyLevel: level,
      };
    }

    if (level === 2) {
      // Energy 2 gives a Small task
      if (smallTasks.length > 0) {
        picked = smallTasks[0];
      } else {
        // Fallback if no small tasks: pick smallest available with earlier deadline
        picked = mediumTasks.length > 0 ? mediumTasks[0] : (bigTasks[0] || null);
      }
      return {
        task: picked,
        isRestFine: !picked,
        message: picked ? null : "Rest is fine today",
        energyLevel: level,
      };
    }

    if (level === 3) {
      // Energy 3 gives a Medium task or the most urgent Small one
      const bestMedium = mediumTasks[0] || null;
      const mostUrgentSmall = smallTasks[0] || null;

      if (bestMedium && mostUrgentSmall) {
        const smallHasDeadline = getDeadlineTimestamp(mostUrgentSmall) < Number.MAX_SAFE_INTEGER;
        const medHasDeadline = getDeadlineTimestamp(bestMedium) < Number.MAX_SAFE_INTEGER;

        if (smallHasDeadline && (!medHasDeadline || getDeadlineTimestamp(mostUrgentSmall) < getDeadlineTimestamp(bestMedium))) {
          // Small task has an earlier deadline
          picked = mostUrgentSmall;
        } else {
          // Medium task has equal or earlier deadline, or neither has deadline
          picked = bestMedium;
        }
      } else if (bestMedium) {
        picked = bestMedium;
      } else if (mostUrgentSmall) {
        picked = mostUrgentSmall;
      } else {
        picked = bigTasks[0] || null;
      }

      return {
        task: picked,
        isRestFine: !picked,
        message: picked ? null : "Rest is fine today",
        energyLevel: level,
      };
    }

    if (level === 4) {
      // Energy 4 gives the most urgent task up to Medium
      const upToMedium = [...smallTasks, ...mediumTasks].sort((a, b) => {
        const diff = compareDeadline(a, b);
        if (diff !== 0) return diff;
        // If tied in deadline, prefer Medium for Level 4
        if (a.size !== b.size) {
          return a.size === TASK_SIZES.MEDIUM ? -1 : 1;
        }
        return 0;
      });

      if (upToMedium.length > 0) {
        picked = upToMedium[0];
      } else {
        picked = bigTasks[0] || null;
      }

      return {
        task: picked,
        isRestFine: !picked,
        message: picked ? null : "Rest is fine today",
        energyLevel: level,
      };
    }

    // Energy 5: gives the most urgent or biggest task
    const bestBig = bigTasks[0] || null;
    const mostUrgentOverall = [...openTasks].sort(compareDeadline)[0] || null;

    if (bestBig && mostUrgentOverall) {
      const urgentHasDeadline = getDeadlineTimestamp(mostUrgentOverall) < Number.MAX_SAFE_INTEGER;
      const bigHasDeadline = getDeadlineTimestamp(bestBig) < Number.MAX_SAFE_INTEGER;

      if (urgentHasDeadline && (!bigHasDeadline || getDeadlineTimestamp(mostUrgentOverall) < getDeadlineTimestamp(bestBig))) {
        picked = mostUrgentOverall;
      } else {
        picked = bestBig;
      }
    } else {
      picked = bestBig || mostUrgentOverall || null;
    }

    return {
      task: picked,
      isRestFine: !picked,
      message: picked ? null : "Rest is fine today",
      energyLevel: level,
    };
  }

  /**
   * Heavy week warning:
   * Assume daily capacity of 10, 30, 60, 90 and 120 minutes for energy 1 to 5.
   * Use the last chosen energy for today and level 3 for future days.
   * If the minutes of work left before a deadline are more than the capacity until that deadline:
   * Show: 'Your week looks heavy. Want to ask for a short extension, or make a task smaller?'
   * Show it at most once per day.
   */
  checkHeavyWeek(energyLevel = 3, tasksList = null, options = {}) {
    const now = options.now ? new Date(options.now) : new Date(this.now());
    const force = Boolean(options.force);
    const todayStr = options.todayStr || now.toISOString().split("T")[0];

    // Show at most once per day
    if (!force && this.lastWarningDate === todayStr) {
      return {
        warn: false,
        reason: "already_shown_today",
        date: todayStr,
      };
    }

    const openTasks = (tasksList || this.getOpenTasks()).filter((t) => t && !t.completed);
    const tasksWithDeadline = openTasks.filter((t) => Boolean(t.deadline || t.dueDate));

    if (tasksWithDeadline.length === 0) {
      return { warn: false, reason: "no_deadlines", date: todayStr };
    }

    const level = Math.max(1, Math.min(5, Number(energyLevel) || 3));
    const todayCapacity = DAILY_CAPACITIES[level] || 60;
    const futureDailyCapacity = DAILY_CAPACITIES[3]; // Level 3 = 60 min

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    // Group tasks by their deadline timestamps
    const uniqueDeadlines = [...new Set(tasksWithDeadline.map((t) => getDeadlineTimestamp(t)))].sort((a, b) => a - b);

    for (const deadlineTs of uniqueDeadlines) {
      if (deadlineTs === Number.MAX_SAFE_INTEGER) continue;

      const deadlineDate = new Date(deadlineTs);
      const startOfDeadline = new Date(deadlineDate);
      startOfDeadline.setHours(0, 0, 0, 0);

      const diffDays = Math.max(0, Math.round((startOfDeadline.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24)));
      const capacityUntilDeadline = todayCapacity + diffDays * futureDailyCapacity;

      // Calculate minutes of open tasks due on or before this deadline
      const workMinutesDue = tasksWithDeadline
        .filter((t) => getDeadlineTimestamp(t) <= deadlineTs)
        .reduce((acc, t) => acc + (SIZE_MINUTES[t.size] || 15), 0);

      if (workMinutesDue > capacityUntilDeadline) {
        if (!options.dryRun) {
          this.lastWarningDate = todayStr;
          this.saveSettings();
        }
        return {
          warn: true,
          message: "Your week looks heavy. Want to ask for a short extension, or make a task smaller?",
          date: todayStr,
          workMinutes: workMinutesDue,
          capacity: capacityUntilDeadline,
          daysUntil: diffDays,
        };
      }
    }

    return { warn: false, date: todayStr };
  }

  checkDueTasksForNotification(now = new Date(), tasksList = null) {
    const todayStr = (now instanceof Date ? now : new Date(now)).toISOString().split("T")[0];
    const openTasks = (tasksList || this.getOpenTasks()).filter((t) => t && !t.completed && t.notify !== false && Boolean(t.deadline || t.dueDate));
    const notifications = [];

    for (const task of openTasks) {
      if (task.lastNotifiedDate === todayStr) continue;
      const d = new Date(task.deadline || task.dueDate);
      if (isNaN(d.getTime())) continue;

      const nowDate = new Date(now);
      nowDate.setHours(0, 0, 0, 0);
      const targetDate = new Date(d);
      targetDate.setHours(0, 0, 0, 0);

      const diffMs = targetDate.getTime() - nowDate.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        task.lastNotifiedDate = todayStr;
        notifications.push({
          id: task.id,
          title: task.title,
          deadline: task.deadline || task.dueDate,
          diffDays,
          message: `🐾 Friendly reminder: "${task.title}" is due today! Take a gentle breath, no rush.`,
        });
      } else if (diffDays < 0) {
        task.lastNotifiedDate = todayStr;
        notifications.push({
          id: task.id,
          title: task.title,
          deadline: task.deadline || task.dueDate,
          diffDays,
          message: `🐾 Gentle reminder: "${task.title}" is waiting for you whenever you are ready!`,
        });
      }
    }

    if (notifications.length > 0 && !tasksList) {
      this.saveTasks();
    }
    return notifications;
  }
}

function parseDeadlineFromText(text, now = new Date()) {
  if (!text || typeof text !== "string") return { deadline: null, matchedPhrase: "" };
  const s = text.toLowerCase();
  const base = new Date(now);

  const pad = (n) => String(n).padStart(2, "0");
  const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // 1. "today", "tonight", "this evening"
  const todayMatch = /\b(?:due|by|before|on)?\s*(today|tonight|this evening)\b/i.exec(text);
  if (todayMatch) {
    return { deadline: toYMD(base), matchedPhrase: todayMatch[0] };
  }

  // 2. "day after tomorrow"
  const dayAfterMatch = /\b(?:due|by|before|on)?\s*(the\s+)?day after tomorrow\b/i.exec(text);
  if (dayAfterMatch) {
    const target = new Date(base);
    target.setDate(target.getDate() + 2);
    return { deadline: toYMD(target), matchedPhrase: dayAfterMatch[0] };
  }

  // 3. "tomorrow", "tmrw"
  const tmrwMatch = /\b(?:due|by|before|on)?\s*(tomorrow|tmrw)\b/i.exec(text);
  if (tmrwMatch) {
    const target = new Date(base);
    target.setDate(target.getDate() + 1);
    return { deadline: toYMD(target), matchedPhrase: tmrwMatch[0] };
  }

  // 4. "in X days"
  const inDaysMatch = /\b(?:in\s+)(\d{1,2})\s+days?\b/i.exec(text);
  if (inDaysMatch) {
    const days = parseInt(inDaysMatch[1], 10);
    const target = new Date(base);
    target.setDate(target.getDate() + days);
    return { deadline: toYMD(target), matchedPhrase: inDaysMatch[0] };
  }

  // 5. Days of week: monday, tuesday, etc.
  const daysOfWeek = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dowRegex = new RegExp(`\\b(?:due|by|before|on|next)?\\s*(next\\s+)?(${daysOfWeek.join("|")})\\b`, "i");
  const dowMatch = dowRegex.exec(text);
  if (dowMatch) {
    const targetDayName = dowMatch[2].toLowerCase();
    const targetDayIdx = daysOfWeek.indexOf(targetDayName);
    const currentDayIdx = base.getDay();
    let diff = (targetDayIdx - currentDayIdx + 7) % 7;
    if (diff === 0 || dowMatch[1]) diff += 7; // next week if already today or 'next' specified
    const target = new Date(base);
    target.setDate(target.getDate() + diff);
    return { deadline: toYMD(target), matchedPhrase: dowMatch[0] };
  }

  // 6. Explicit dates: YYYY-MM-DD
  const isoMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (isoMatch) {
    return { deadline: isoMatch[1], matchedPhrase: isoMatch[0] };
  }

  // 7. Month name + day: e.g. "Nov 5", "Nov 5th", "November 5", "Oct 31"
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthRegex = new RegExp(`\\b(?:due|by|before|on)?\\s*(${months.join("|")})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i");
  const monthMatch = monthRegex.exec(text);
  if (monthMatch) {
    const mIdx = months.findIndex((m) => monthMatch[1].toLowerCase().startsWith(m));
    const day = parseInt(monthMatch[2], 10);
    const year = base.getFullYear();
    const target = new Date(year, mIdx, day);
    if (target.getTime() < base.getTime() - 86400000 * 30) {
      target.setFullYear(year + 1);
    }
    return { deadline: toYMD(target), matchedPhrase: monthMatch[0] };
  }

  return { deadline: null, matchedPhrase: "" };
}

function inferTaskSize(title, fullText = "") {
  const combined = `${title} ${fullText}`.toLowerCase();
  if (/\b(?:big|huge|massive|large|120\s*m(?:in)?|essay|term\s*paper|project|presentation|thesis|dissertation|exam|final|report)\b/i.test(combined)) {
    return TASK_SIZES.BIG;
  }
  if (/\b(?:small|tiny|quick|15\s*m(?:in)?|email|mail|message|call|download|print|upload|sign|submit\s*form|check|reply|grocer(?:y|ies)|buy|errand|chore)\b/i.test(combined)) {
    return TASK_SIZES.SMALL;
  }
  return TASK_SIZES.MEDIUM;
}

function cleanTaskTitle(raw) {
  if (!raw || typeof raw !== "string") return "";
  let text = raw.trim();
  if (text.startsWith("[Classroom]") || text.startsWith("[")) return text;

  // Strip question sentences and clauses
  text = text.replace(/(?:^|[,.!?\n])\s*(?:what (?:should|can|do) i do\??|how (?:can|do) i\b[^,.!?]*\??|can you help\??|what to do\??)\s*[,.!?]?/gi, " ");

  // Strip venting / emotional clauses
  const ventingPattern = /(?:^|[,.!?\n])\s*(?:i(?:'m| am)? (?:too |so |very )?(?:stressed|overwhelmed|tired|exhausted|anxious|panicking|burnt out|sad|depressed|nervous)|there(?:'s| is) (?:so |too )?much (?:workload|work|pressure|stuff)|i have (?:so |too )?much (?:work|to do)|i don't know what to do)\s*[,.!?\s]*/gi;
  text = text.replace(ventingPattern, " ").trim();

  // If there are multiple sentences left, find the sentence that actually contains the work/task
  const sentences = text.split(/\s*[.!?]+\s*/).map(s => s.trim().replace(/^[,,\s;]+|[,,\s;]+$/g, "")).filter(Boolean);
  if (sentences.length > 1) {
    const taskSentence = sentences.find(s => /(?:interview|submission|homework|assignment|review|exam|test|quiz|project|presentation|lab|paper|essay|meeting|study|math|discrete|chapter|lecture|problem|task)\b/i.test(s));
    if (taskSentence) {
      text = taskSentence;
    } else {
      text = sentences[sentences.length - 1];
    }
  }

  // Iteratively strip conversational leading filler words
  let prev;
  do {
    prev = text;
    text = text
      .replace(/^[-*•]\s*/, "")
      .replace(/^[\d+]+[\.\)]\s*/, "")
      .replace(/^[,,\s;]+|[,,\s;]+$/g, "")
      .replace(/^and\s+/i, "")
      .replace(/^(?:like\s+(?:one\s+)?|also\s+|maybe\s+|plus\s+|just\s+)/i, "")
      .replace(/^(?:i\s+(?:have|got|need|want|ought)\s+(?:to\s+)?(?:do\s+|finish\s+|complete\s+)?(?:a\s+|an\s+|the\s+)?)/i, "")
      .replace(/^(?:there\s+is\s+(?:a\s+|an\s+|the\s+)?)/i, "")
      .replace(/^(?:one\s+)/i, "")
      .replace(/\s+/g, " ")
      .replace(/^[,,\s;]+|[,,\s;]+$/g, "")
      .replace(/[.!?]+$/, "")
      .trim();
  } while (text !== prev);

  if (text.length < 2) return "";
  if (/^(?:what|how|why|can you|should i|i am|stressed|help|workload|please)\b/i.test(text) && !/(?:interview|submission|homework|assignment|review|exam|test|math|project|lab|paper|study)\b/i.test(text)) {
    return "";
  }

  return text;
}

function extractTasksFromChat(text, now = new Date()) {
  if (!text || typeof text !== "string") return [];
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Ignore general conversational questions or meta commands
  if (/^(?:help me|how (?:do|can|to)|what (?:is|should|are)|can you (?:help|explain|talk|tell)|make that|tell me)\b/i.test(trimmed)) {
    if (!/\b(?:add|save|create|store|put|keep track of)\s+(?:a\s+)?(?:new\s+)?tasks?\b/i.test(trimmed)) {
      return [];
    }
  }

  // Must have clear task intent:
  // - Starts with add/save/store task, remind me to
  // - Starts with "tasks:", "to-do:", "assignments:", "here are my tasks", "my tasks are"
  // - Or starts with "I need to / have to / want to finish/do..."
  // - Or contains a deadline like "due tomorrow / by Friday" AND looks like a task item
  // - Or has numbered list items (1. ..., 2. ...)
  const hasTaskPrefix = /^(?:(?:please\s+)?(?:add|save|create|store|keep track of|remind me to)\b|(?:tasks?|to-?dos?|assignments?)\s*[:\-]|(?:here\s+are\s+(?:my\s+)?tasks|my\s+tasks\s+(?:are|is))|i\s+(?:need|have|want|got)\s+to\s+(?:do|finish|complete|submit|write|read|work on))\b/i.test(trimmed);
  const hasNumberedList = /(?:^|\n)\s*[1-9][\.\)]\s+/.test(trimmed);
  const { deadline: testDeadline } = parseDeadlineFromText(trimmed, now);
  const hasDeadlineAndAction = Boolean(testDeadline) && /(?:finish|do|submit|write|read|work on|buy|call|study|review|send|prepare|turn in|complete|essay|hw|homework|assignment|project)\b/i.test(trimmed);

  if (!hasTaskPrefix && !hasNumberedList && !hasDeadlineAndAction) {
    return [];
  }

  // Remove generic chat wrappers
  let cleaned = trimmed
    .replace(/^(?:i (?:need|have|want|ought) to (?:do |finish |complete )?|my (?:tasks?|to-?do|assignments?) (?:are|is)?|please (?:add|save|create|store)|(?:add|save|create|store)\s+(?:task\s+)?|here are (?:my )?(?:tasks|to-?dos?)|tasks?|to-?do|remind me to|can you (?:save|add|keep track of))\s*[:\-]?\s*/i, "")
    .trim();

  // Split lines or delimiters
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let rawList = [];

  for (const line of lines) {
    if (/\b[1-9][\.\)]\s+/.test(line)) {
      const parts = line.split(/\b[1-9][\.\)]\s+/).map((s) => s.trim()).filter(Boolean);
      rawList.push(...parts);
    } else if (line.includes(",") && lines.length === 1) {
      const parts = line.split(",").map((s) => s.trim().replace(/^and\s+/i, "")).filter(Boolean);
      rawList.push(...parts);
    } else if (/\band\b/i.test(line) && lines.length === 1) {
      const parts = line.split(/\band\b/i).map((s) => s.trim().replace(/^[,\s;]+|[,\s;]+$/g, "")).filter(Boolean);
      rawList.push(...parts);
    } else {
      rawList.push(line);
    }
  }

  const results = [];

  for (const item of rawList) {
    if (!item || item.length < 2) continue;

    // Check for optional extra info like "(notes: ...)" or "notes: ..." or in brackets
    let extraInfo = "";
    let mainText = item;

    const notesMatch = /(?:\(|\b)(?:notes?|info|details?):\s*([^)]+)(?:\)|$)/i.exec(item);
    if (notesMatch) {
      extraInfo = notesMatch[1].trim();
      mainText = item.replace(notesMatch[0], "").trim();
    }

    // Parse deadline
    const { deadline, matchedPhrase } = parseDeadlineFromText(mainText, now);
    let title = mainText;
    if (matchedPhrase) {
      title = title.replace(matchedPhrase, " ").replace(/\s+/g, " ").trim();
      // Clean trailing punctuation or prepositions
      title = title.replace(/\b(?:by|due|before|on)$/i, "").trim();
    }

    // Clean leading bullets, conversational phrasing, and emotional venting
    title = cleanTaskTitle(title);

    if (!title) continue;

    const size = inferTaskSize(title, item);
    results.push({
      title: sanitizeForbiddenWords(title),
      deadline: deadline || null,
      size,
      extraInfo: sanitizeForbiddenWords(extraInfo),
      notify: Boolean(deadline),
    });
  }

  return results;
}

const defaultInstance = new PlannerLite();

module.exports = {
  PlannerLite,
  TASK_SIZES,
  SIZE_MINUTES,
  DAILY_CAPACITIES,
  FORBIDDEN_WORDS,
  checkNoForbiddenWords,
  sanitizeForbiddenWords,
  formatDeadlineDate,
  parseDeadlineFromText,
  cleanTaskTitle,
  inferTaskSize,
  extractTasksFromChat,
  getInstance: () => defaultInstance,
  getOpenTasks: () => defaultInstance.getOpenTasks(),
  addTask: (data) => defaultInstance.addTask(data),
  updateTask: (id, updates) => defaultInstance.updateTask(id, updates),
  deleteTask: (id) => defaultInstance.deleteTask(id),
  pickTask: (level, tasks) => defaultInstance.pickTask(level, tasks),
  checkHeavyWeek: (level, tasks, options) => defaultInstance.checkHeavyWeek(level, tasks, options),
  checkDueTasksForNotification: (now, tasks) => defaultInstance.checkDueTasksForNotification(now, tasks),
};

