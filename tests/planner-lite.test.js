"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  PlannerLite,
  TASK_SIZES,
  SIZE_MINUTES,
  DAILY_CAPACITIES,
  FORBIDDEN_WORDS,
  checkNoForbiddenWords,
  sanitizeForbiddenWords,
  formatDeadlineDate,
} = require("../planner-lite");

function createTestPlanner(mockDateStr = "2026-11-01T10:00:00.000Z") {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "planner-lite-test-"));
  const tasksPath = path.join(tmpDir, "tasks.json");
  const settingsPath = path.join(tmpDir, "settings.json");

  let currentDate = new Date(mockDateStr);

  const planner = new PlannerLite({
    storagePath: tasksPath,
    settingsPath: settingsPath,
    timeProvider: () => new Date(currentDate),
  });

  return {
    planner,
    tmpDir,
    setDate: (dStr) => {
      currentDate = new Date(dStr);
    },
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

// -------------------------------------------------------------
// 1. Pick rules at each energy level
// -------------------------------------------------------------
test("Pick rules: Energy 1 gives the smallest task", () => {
  const { planner, cleanup } = createTestPlanner();
  try {
    const tasks = [
      { id: "1", title: "Write big essay draft", size: "Big", deadline: "2026-11-05" },
      { id: "2", title: "Read Chapter 4", size: "Medium", deadline: "2026-11-04" },
      { id: "3", title: "Email teacher 1 question", size: "Small", deadline: "2026-11-03" },
    ];
    const pick = planner.pickTask(1, tasks);
    assert.equal(pick.isRestFine, false);
    assert.equal(pick.task.id, "3");
    assert.equal(pick.task.size, "Small");
  } finally {
    cleanup();
  }
});

test("Pick rules: Energy 1 gives 'Rest is fine today' when there is no Small task", () => {
  const { planner, cleanup } = createTestPlanner();
  try {
    const tasks = [
      { id: "1", title: "Write big essay draft", size: "Big", deadline: "2026-11-05" },
      { id: "2", title: "Read Chapter 4", size: "Medium", deadline: "2026-11-04" },
    ];
    const pick = planner.pickTask(1, tasks);
    assert.equal(pick.isRestFine, true);
    assert.equal(pick.task, null);
    assert.equal(pick.message, "Rest is fine today");
  } finally {
    cleanup();
  }
});

test("Pick rules: Energy 2 gives a Small task", () => {
  const { planner, cleanup } = createTestPlanner();
  try {
    const tasks = [
      { id: "1", title: "Project outline", size: "Big", deadline: "2026-11-05" },
      { id: "2", title: "Practice quiz", size: "Medium", deadline: "2026-11-03" },
      { id: "3", title: "Download notes", size: "Small", deadline: "2026-11-04" },
    ];
    const pick = planner.pickTask(2, tasks);
    assert.equal(pick.task.id, "3");
    assert.equal(pick.task.size, "Small");
  } finally {
    cleanup();
  }
});

test("Pick rules: Energy 3 gives a Medium task or the most urgent Small one", () => {
  const { planner, cleanup } = createTestPlanner();
  try {
    // Case A: Small task is more urgent than Medium task
    const tasksA = [
      { id: "1", title: "Math problem set", size: "Medium", deadline: "2026-11-05" },
      { id: "2", title: "Sign permission slip", size: "Small", deadline: "2026-11-02" },
    ];
    const pickA = planner.pickTask(3, tasksA);
    assert.equal(pickA.task.id, "2", "Should pick most urgent Small task when deadline is earlier");

    // Case B: Medium task has earlier or equal deadline
    const tasksB = [
      { id: "1", title: "Science lab writeup", size: "Medium", deadline: "2026-11-02" },
      { id: "2", title: "Pack backpack", size: "Small", deadline: "2026-11-04" },
    ];
    const pickB = planner.pickTask(3, tasksB);
    assert.equal(pickB.task.id, "1", "Should pick Medium task when deadline is earlier or equal");
  } finally {
    cleanup();
  }
});

test("Pick rules: Energy 4 gives the most urgent task up to Medium", () => {
  const { planner, cleanup } = createTestPlanner();
  try {
    const tasks = [
      { id: "1", title: "Capstone presentation", size: "Big", deadline: "2026-11-02" },
      { id: "2", title: "History reading", size: "Medium", deadline: "2026-11-03" },
      { id: "3", title: "Check homework portal", size: "Small", deadline: "2026-11-04" },
    ];
    const pick = planner.pickTask(4, tasks);
    assert.equal(pick.task.id, "2", "Should pick most urgent task up to Medium, skipping Big");
  } finally {
    cleanup();
  }
});

test("Pick rules: Energy 5 gives the most urgent or biggest task", () => {
  const { planner, cleanup } = createTestPlanner();
  try {
    // When Big task exists and has urgent deadline
    const tasks = [
      { id: "1", title: "Complete big term paper", size: "Big", deadline: "2026-11-02" },
      { id: "2", title: "Vocab flashcards", size: "Small", deadline: "2026-11-06" },
    ];
    const pick = planner.pickTask(5, tasks);
    assert.equal(pick.task.id, "1", "Should pick big task for Level 5");

    // When a Small task is extremely urgent compared to big task
    const tasksUrgent = [
      { id: "1", title: "Big term project", size: "Big", deadline: "2026-11-10" },
      { id: "2", title: "Submit urgent form", size: "Small", deadline: "2026-11-02" },
    ];
    const pickUrgent = planner.pickTask(5, tasksUrgent);
    assert.equal(pickUrgent.task.id, "2", "Should pick most urgent task even if smaller");
  } finally {
    cleanup();
  }
});

test("Pick rules: Tie-breaker chooses the earlier deadline", () => {
  const { planner, cleanup } = createTestPlanner();
  try {
    const tasks = [
      { id: "1", title: "Task Later", size: "Small", deadline: "2026-11-06" },
      { id: "2", title: "Task Earlier", size: "Small", deadline: "2026-11-03" },
    ];
    const pick = planner.pickTask(2, tasks);
    assert.equal(pick.task.id, "2", "Earlier deadline wins tie-break");
  } finally {
    cleanup();
  }
});

// -------------------------------------------------------------
// 2. Heavy week warning with mocked dates
// -------------------------------------------------------------
test("Heavy week warning: Triggers when work minutes exceed capacity", () => {
  const { planner, cleanup } = createTestPlanner("2026-11-01T08:00:00.000Z");
  try {
    // Today is Nov 1, chosen energy level 2 -> capacity = 30 min today
    // Nov 2 deadline -> 1 future day = +60 min -> total capacity until Nov 2 = 90 min
    // Tasks due Nov 2: two Big tasks (120 min + 120 min = 240 min)
    const tasks = [
      { id: "1", title: "Heavy Essay", size: "Big", deadline: "2026-11-02" },
      { id: "2", title: "Heavy Project", size: "Big", deadline: "2026-11-02" },
    ];

    const result = planner.checkHeavyWeek(2, tasks, {
      now: new Date("2026-11-01T08:00:00.000Z"),
      dryRun: false,
    });

    assert.equal(result.warn, true);
    assert.equal(
      result.message,
      "Your week looks heavy. Want to ask for a short extension, or make a task smaller?"
    );
    assert.ok(result.workMinutes > result.capacity);
  } finally {
    cleanup();
  }
});

test("Heavy week warning: Does NOT trigger when work is within capacity", () => {
  const { planner, cleanup } = createTestPlanner("2026-11-01T08:00:00.000Z");
  try {
    // Level 3 today (60 min) + 2 days until Nov 3 (+120 min) = 180 min capacity
    // Tasks: 1 Medium (45 min) + 1 Small (15 min) = 60 min total
    const tasks = [
      { id: "1", title: "Read Chapter", size: "Medium", deadline: "2026-11-03" },
      { id: "2", title: "Quick note", size: "Small", deadline: "2026-11-03" },
    ];

    const result = planner.checkHeavyWeek(3, tasks, {
      now: new Date("2026-11-01T08:00:00.000Z"),
      dryRun: false,
    });

    assert.equal(result.warn, false);
  } finally {
    cleanup();
  }
});

test("Heavy week warning: Shows at most once per day", () => {
  const { planner, cleanup, setDate } = createTestPlanner("2026-11-01T08:00:00.000Z");
  try {
    const heavyTasks = [
      { id: "1", title: "Massive Task 1", size: "Big", deadline: "2026-11-01" },
      { id: "2", title: "Massive Task 2", size: "Big", deadline: "2026-11-01" },
    ];

    // First check on 2026-11-01: warns and records lastWarningDate
    const res1 = planner.checkHeavyWeek(1, heavyTasks, {
      now: new Date("2026-11-01T08:00:00.000Z"),
      dryRun: false,
    });
    assert.equal(res1.warn, true);

    // Second check on the same day: suppressed
    const res2 = planner.checkHeavyWeek(1, heavyTasks, {
      now: new Date("2026-11-01T15:00:00.000Z"),
      dryRun: false,
    });
    assert.equal(res2.warn, false);
    assert.equal(res2.reason, "already_shown_today");

    // Next day (2026-11-02): can warn again
    setDate("2026-11-02T09:00:00.000Z");
    const nextDayTasks = [
      { id: "3", title: "Next Heavy Task", size: "Big", deadline: "2026-11-02" },
    ];
    const res3 = planner.checkHeavyWeek(1, nextDayTasks, {
      now: new Date("2026-11-02T09:00:00.000Z"),
      dryRun: false,
    });
    assert.equal(res3.warn, true, "Should warn on the next day");
  } finally {
    cleanup();
  }
});

// -------------------------------------------------------------
// 3. Rest suggestion
// -------------------------------------------------------------
test("Rest suggestion: Energy 1 with only Medium/Big tasks suggests rest", () => {
  const { planner, cleanup } = createTestPlanner();
  try {
    const tasks = [
      { id: "1", title: "Big Project", size: "Big" },
      { id: "2", title: "Medium Homework", size: "Medium" },
    ];
    const pick = planner.pickTask(1, tasks);
    assert.equal(pick.isRestFine, true);
    assert.equal(pick.message, "Rest is fine today");
    assert.equal(pick.task, null);
  } finally {
    cleanup();
  }
});

test("Rest suggestion: Empty task list suggests rest", () => {
  const { planner, cleanup } = createTestPlanner();
  try {
    const pick = planner.pickTask(3, []);
    assert.equal(pick.isRestFine, true);
    assert.equal(pick.message, "Rest is fine today");
    assert.equal(pick.task, null);
  } finally {
    cleanup();
  }
});

// -------------------------------------------------------------
// 4. Check that no forbidden words appear in any planner text
// -------------------------------------------------------------
test("No forbidden words: FORBIDDEN_WORDS are detected and sanitized", () => {
  for (const word of FORBIDDEN_WORDS) {
    assert.equal(checkNoForbiddenWords(`This task is ${word}`), false);
  }

  // Sanitizer replaces them gently
  assert.equal(sanitizeForbiddenWords("assignment is overdue"), "assignment is waiting for you");
  assert.equal(sanitizeForbiddenWords("you are late"), "you are waiting");
  assert.equal(sanitizeForbiddenWords("you are behind schedule"), "you are in progress schedule");
  assert.equal(sanitizeForbiddenWords("test failed"), "test needs attention");
});

test("No forbidden words: Missed deadlines format to 'waiting for you'", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  const pastDeadline = "2026-11-01"; // in the past

  const formatted = formatDeadlineDate(pastDeadline, now);
  assert.equal(formatted, "waiting for you");
  assert.equal(checkNoForbiddenWords(formatted), true);
});

test("No forbidden words: Check planner source and UI files for forbidden words and red colors", () => {
  const plannerSource = fs.readFileSync(path.join(__dirname, "..", "planner-lite.js"), "utf8");
  const tasksHtml = fs.readFileSync(path.join(__dirname, "..", "tasks", "index.html"), "utf8");
  const tasksCss = fs.readFileSync(path.join(__dirname, "..", "tasks", "styles.css"), "utf8");
  const tasksJs = fs.readFileSync(path.join(__dirname, "..", "tasks", "tasks.js"), "utf8");

  // In user-facing UI HTML, ensure forbidden words never appear
  for (const word of FORBIDDEN_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    assert.ok(!regex.test(tasksHtml), `Forbidden word '${word}' found in tasks/index.html`);
  }

  // Ensure tasks/styles.css contains no red color definitions
  const redHexPatterns = [/#f00\b/i, /#ff0000\b/i, /#ef4444\b/i, /#dc2626\b/i, /#b91c1c\b/i, /#991b1b\b/i, /rgb\(\s*255\s*,\s*0\s*,\s*0/i];
  for (const pat of redHexPatterns) {
    assert.ok(!pat.test(tasksCss), `Red color matching pattern ${pat} found in tasks/styles.css`);
  }

  // Check the heavy week message
  const heavyMessage = "Your week looks heavy. Want to ask for a short extension, or make a task smaller?";
  assert.equal(checkNoForbiddenWords(heavyMessage), true);

  // Check the rest message
  const restMessage = "Rest is fine today";
  assert.equal(checkNoForbiddenWords(restMessage), true);
});

// -------------------------------------------------------------
// 5. Chat task extraction, editing, and notifications
// -------------------------------------------------------------
test("Chat extraction: Extracts task titles and deadlines from user chat text", () => {
  const { extractTasksFromChat } = require("../planner-lite");
  const mockNow = new Date("2026-10-29T12:00:00.000Z"); // Thursday

  // Case 1: Simple task with "by tomorrow"
  const single = extractTasksFromChat("I need to finish math homework by tomorrow", mockNow);
  assert.equal(single.length, 1);
  assert.equal(single[0].title, "math homework");
  assert.equal(single[0].deadline, "2026-10-30");
  assert.equal(single[0].size, "Medium");

  // Case 2: Multiple tasks with sizes, extra info, and weekday deadline
  const multi = extractTasksFromChat(
    "My tasks are buy groceries, finish history essay due Friday (notes: check rubric), and email teacher",
    mockNow
  );
  assert.equal(multi.length, 3);
  assert.equal(multi[0].title, "buy groceries");
  assert.equal(multi[0].size, "Small");
  assert.equal(multi[1].title, "finish history essay");
  assert.equal(multi[1].deadline, "2026-10-30");
  assert.equal(multi[1].size, "Big");
  assert.equal(multi[1].extraInfo, "check rubric");
  assert.equal(multi[2].title, "email teacher");
  assert.equal(multi[2].size, "Small");
});

test("Task editing: PlannerLite updateTask modifies title, deadline, size, extraInfo, and notify", () => {
  const { planner, cleanup } = createTestPlanner();
  try {
    const task = planner.addTask({
      title: "Initial Draft",
      deadline: "2026-11-01",
      size: "Small",
      extraInfo: "First note",
      notify: true,
    });
    assert.ok(task && task.id);

    // Edit the task
    const updated = planner.updateTask(task.id, {
      title: "Revised Final Paper",
      deadline: "2026-11-04",
      size: "Big",
      extraInfo: "Updated note with references",
      notify: false,
    });

    assert.equal(updated.title, "Revised Final Paper");
    assert.equal(updated.deadline, "2026-11-04");
    assert.equal(updated.size, "Big");
    assert.equal(updated.minutes, 120);
    assert.equal(updated.extraInfo, "Updated note with references");
    assert.equal(updated.notify, false);

    // Check persistence
    const reloaded = planner.getOpenTasks().find((t) => t.id === task.id);
    assert.equal(reloaded.title, "Revised Final Paper");
    assert.equal(reloaded.size, "Big");
  } finally {
    cleanup();
  }
});

test("Notifications: checkDueTasksForNotification triggers gentle notifications for due tasks", () => {
  const { planner, cleanup } = createTestPlanner("2026-11-01T08:00:00.000Z");
  try {
    const tasks = [
      { id: "1", title: "Chemistry Lab", deadline: "2026-11-01", notify: true }, // Due today
      { id: "2", title: "English Poem", deadline: "2026-10-30", notify: true }, // Past (waiting for you)
      { id: "3", title: "Future Project", deadline: "2026-11-10", notify: true }, // Future, not due yet
      { id: "4", title: "Muted Homework", deadline: "2026-11-01", notify: false }, // Notify off
    ];

    const notifs = planner.checkDueTasksForNotification(new Date("2026-11-01T08:00:00.000Z"), tasks);
    assert.equal(notifs.length, 2);

    // First notif: due today
    assert.equal(notifs[0].id, "1");
    assert.ok(notifs[0].message.includes("due today"));

    // Second notif: past due (never say overdue, say waiting for you)
    assert.equal(notifs[1].id, "2");
    assert.ok(notifs[1].message.includes("waiting for you"));
    assert.equal(checkNoForbiddenWords(notifs[1].message), true);

    // Once notified today, second check on same day should not notify again
    const secondCheck = planner.checkDueTasksForNotification(new Date("2026-11-01T12:00:00.000Z"), tasks);
    assert.equal(secondCheck.length, 0, "Should not notify again on same day");
  } finally {
    cleanup();
  }
});

