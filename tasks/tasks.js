"use strict";

(() => {
  const tasksListEl = document.getElementById("tasks-list");
  const countBadgeEl = document.getElementById("tasks-count-badge");
  const addForm = document.getElementById("add-task-form");
  const titleInput = document.getElementById("task-title-input");
  const deadlineInput = document.getElementById("task-deadline-input");
  const sizeSelect = document.getElementById("task-size-select");
  const closeBtn = document.getElementById("close-btn");

  function formatDeadline(deadlineStr) {
    if (!deadlineStr) return null;
    const d = new Date(deadlineStr);
    if (isNaN(d.getTime())) return null;

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);

    const diffMs = target.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: "waiting for you", isWaiting: true };
    }
    if (diffDays === 0) {
      return { text: "Due today", isWaiting: false };
    }
    if (diffDays === 1) {
      return { text: "Due tomorrow", isWaiting: false };
    }
    return {
      text: `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      isWaiting: false,
    };
  }

  function renderTasks(tasks) {
    if (!tasksListEl) return;
    tasksListEl.innerHTML = "";

    const openTasks = (tasks || []).filter((t) => t && !t.completed);
    if (countBadgeEl) {
      countBadgeEl.textContent = String(openTasks.length);
    }

    if (openTasks.length === 0) {
      tasksListEl.innerHTML = `
        <div class="tasks-empty">
          No tasks yet. Take a breath, or add something whenever you feel ready. 🌿
        </div>
      `;
      return;
    }

    for (const task of openTasks) {
      const itemEl = document.createElement("div");
      itemEl.className = "task-item";

      const contentEl = document.createElement("div");
      contentEl.className = "task-item-content";

      const titleEl = document.createElement("div");
      titleEl.className = "task-item-title";
      titleEl.textContent = task.title || "Untitled task";
      contentEl.appendChild(titleEl);

      const metaEl = document.createElement("div");
      metaEl.className = "task-item-meta";

      // Size badge
      const size = task.size || "Small";
      const sizeClass = size === "Big" ? "size-big" : size === "Medium" ? "size-medium" : "size-small";
      const minutes = task.minutes || (size === "Big" ? 120 : size === "Medium" ? 45 : 15);
      const sizeBadge = document.createElement("span");
      sizeBadge.className = `size-badge ${sizeClass}`;
      sizeBadge.textContent = `${size} (${minutes}m)`;
      metaEl.appendChild(sizeBadge);

      // Deadline badge
      const deadlineInfo = formatDeadline(task.deadline || task.dueDate);
      if (deadlineInfo) {
        const deadlineBadge = document.createElement("span");
        deadlineBadge.className = `deadline-badge ${deadlineInfo.isWaiting ? "waiting" : ""}`;
        deadlineBadge.textContent = deadlineInfo.text;
        metaEl.appendChild(deadlineBadge);
      }

      contentEl.appendChild(metaEl);
      itemEl.appendChild(contentEl);

      // Delete button
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "task-delete-btn";
      deleteBtn.title = "Delete task";
      deleteBtn.setAttribute("aria-label", `Delete task: ${task.title}`);
      deleteBtn.innerHTML = "🗑️";
      deleteBtn.addEventListener("click", async () => {
        if (window.electronAPI?.plannerTaskDelete) {
          try {
            await window.electronAPI.plannerTaskDelete(task.id);
            await refreshTasks();
          } catch (_) {}
        }
      });

      itemEl.appendChild(deleteBtn);
      tasksListEl.appendChild(itemEl);
    }
  }

  async function refreshTasks() {
    if (window.electronAPI?.plannerTasksGet) {
      try {
        const tasks = await window.electronAPI.plannerTasksGet();
        renderTasks(tasks);
      } catch (_) {
        renderTasks([]);
      }
    }
  }

  if (addForm) {
    addForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = titleInput ? titleInput.value.trim() : "";
      if (!title) return;

      const deadline = deadlineInput && deadlineInput.value ? deadlineInput.value : null;
      const size = sizeSelect ? sizeSelect.value : "Small";

      if (window.electronAPI?.plannerTaskAdd) {
        try {
          await window.electronAPI.plannerTaskAdd({ title, deadline, size });
          if (titleInput) titleInput.value = "";
          if (deadlineInput) deadlineInput.value = "";
          await refreshTasks();
        } catch (_) {}
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      window.close();
    });
  }

  refreshTasks();
})();
