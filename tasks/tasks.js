"use strict";

(() => {
  const tasksListEl = document.getElementById("tasks-list");
  const countBadgeEl = document.getElementById("tasks-count-badge");
  const refreshBtn = document.getElementById("refresh-btn");
  const addForm = document.getElementById("add-task-form");
  const titleInput = document.getElementById("task-title-input");
  const deadlineInput = document.getElementById("task-deadline-input");
  const sizeSelect = document.getElementById("task-size-select");
  const notesInput = document.getElementById("task-notes-input");
  const notifyCheckbox = document.getElementById("task-notify-checkbox");
  const closeBtn = document.getElementById("close-btn");

  // Edit Modal Elements
  const editModal = document.getElementById("edit-modal");
  const editForm = document.getElementById("edit-task-form");
  const editIdInput = document.getElementById("edit-task-id");
  const editTitleInput = document.getElementById("edit-title-input");
  const editDeadlineInput = document.getElementById("edit-deadline-input");
  const editSizeSelect = document.getElementById("edit-size-select");
  const editNotesInput = document.getElementById("edit-notes-input");
  const editNotifyCheckbox = document.getElementById("edit-notify-checkbox");
  const modalCloseBtn = document.getElementById("modal-close-btn");
  const modalCancelBtn = document.getElementById("modal-cancel-btn");

  let currentTasks = [];

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
    currentTasks = Array.isArray(tasks) ? tasks : [];
    if (!tasksListEl) return;
    tasksListEl.innerHTML = "";

    const openTasks = currentTasks.filter((t) => t && !t.completed);
    if (countBadgeEl) {
      countBadgeEl.textContent = String(openTasks.length);
    }

    if (openTasks.length === 0) {
      tasksListEl.innerHTML = `
        <div class="tasks-empty">
          No tasks yet. Take a gentle breath, or tell the cat a task in chat! 🌿
        </div>
      `;
      return;
    }

    for (const task of openTasks) {
      const itemEl = document.createElement("div");
      itemEl.className = "task-item";

      const contentEl = document.createElement("div");
      contentEl.className = "task-item-content";

      // Title
      const titleEl = document.createElement("div");
      titleEl.className = "task-item-title";
      titleEl.textContent = task.title || "Untitled task";
      contentEl.appendChild(titleEl);

      // Notes / Extra Info
      if (task.extraInfo) {
        const notesEl = document.createElement("div");
        notesEl.className = "task-item-notes";
        notesEl.textContent = `📝 ${task.extraInfo}`;
        contentEl.appendChild(notesEl);
      }

      // Metadata (Badges)
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

      // Notification badge
      if (task.notify) {
        const notifyBadge = document.createElement("span");
        notifyBadge.className = "notify-badge";
        notifyBadge.title = "Notifications enabled for this task";
        notifyBadge.textContent = "🔔";
        metaEl.appendChild(notifyBadge);
      }

      contentEl.appendChild(metaEl);
      itemEl.appendChild(contentEl);

      // Action Buttons
      const actionsEl = document.createElement("div");
      actionsEl.className = "task-item-actions";

      // Edit Button
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "task-action-btn edit";
      editBtn.title = "Edit task & notes";
      editBtn.setAttribute("aria-label", `Edit task: ${task.title}`);
      editBtn.innerHTML = "✏️";
      editBtn.addEventListener("click", () => {
        openEditModal(task);
      });
      actionsEl.appendChild(editBtn);

      // Delete Button
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "task-action-btn delete";
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
      actionsEl.appendChild(deleteBtn);

      itemEl.appendChild(actionsEl);
      tasksListEl.appendChild(itemEl);
    }
  }

  function openEditModal(task) {
    if (!editModal || !task) return;
    editIdInput.value = task.id;
    editTitleInput.value = task.title || "";
    editDeadlineInput.value = task.deadline || task.dueDate || "";
    editSizeSelect.value = task.size || "Small";
    editNotesInput.value = task.extraInfo || "";
    editNotifyCheckbox.checked = Boolean(task.notify);

    editModal.hidden = false;
    requestAnimationFrame(() => {
      editTitleInput.focus();
    });
  }

  function closeEditModal() {
    if (editModal) {
      editModal.hidden = true;
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

  // Add Form Submit
  if (addForm) {
    addForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = titleInput ? titleInput.value.trim() : "";
      if (!title) return;

      const deadline = deadlineInput && deadlineInput.value ? deadlineInput.value : null;
      const size = sizeSelect ? sizeSelect.value : "Small";
      const extraInfo = notesInput ? notesInput.value.trim() : "";
      const notify = notifyCheckbox ? notifyCheckbox.checked : Boolean(deadline);

      if (window.electronAPI?.plannerTaskAdd) {
        try {
          await window.electronAPI.plannerTaskAdd({ title, deadline, size, extraInfo, notify });
          if (titleInput) titleInput.value = "";
          if (deadlineInput) deadlineInput.value = "";
          if (notesInput) notesInput.value = "";
          await refreshTasks();
        } catch (_) {}
      }
    });
  }

  // Edit Form Submit
  if (editForm) {
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = editIdInput ? editIdInput.value : "";
      if (!id) return;

      const title = editTitleInput ? editTitleInput.value.trim() : "";
      const deadline = editDeadlineInput && editDeadlineInput.value ? editDeadlineInput.value : null;
      const size = editSizeSelect ? editSizeSelect.value : "Small";
      const extraInfo = editNotesInput ? editNotesInput.value.trim() : "";
      const notify = editNotifyCheckbox ? editNotifyCheckbox.checked : false;

      if (window.electronAPI?.plannerTaskUpdate) {
        try {
          await window.electronAPI.plannerTaskUpdate(id, {
            title,
            deadline,
            size,
            extraInfo,
            notify,
          });
          closeEditModal();
          await refreshTasks();
        } catch (_) {}
      }
    });
  }

  // Modal Cancel & Close
  if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeEditModal);
  if (modalCancelBtn) modalCancelBtn.addEventListener("click", closeEditModal);
  if (editModal) {
    editModal.addEventListener("click", (e) => {
      if (e.target === editModal) closeEditModal();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => refreshTasks());
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      window.close();
    });
  }

  // Live Auto-Refresh when tasks are updated (e.g. from chat)
  window.electronAPI?.onPlannerTasksChanged?.(() => {
    refreshTasks();
  });

  refreshTasks();
})();
