"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const toggle = document.getElementById("stuck-detection-toggle");
  const badge = document.getElementById("stuck-status-badge");
  const closeBtn = document.getElementById("close-btn");

  function updateStatusUI(enabled) {
    const isEnabled = Boolean(enabled);
    if (toggle) {
      toggle.checked = isEnabled;
    }
    if (badge) {
      badge.textContent = isEnabled ? "On" : "Off";
      badge.classList.remove("on", "off");
      badge.classList.add(isEnabled ? "on" : "off");
    }
  }

  // Initial status fetch
  if (window.electronAPI && typeof window.electronAPI.stuckDetectionGet === "function") {
    try {
      const current = await window.electronAPI.stuckDetectionGet();
      updateStatusUI(current);
    } catch (err) {
      console.warn("[Privacy] Failed to fetch stuck detection status:", err);
    }
  }

  // Handle user toggle
  if (toggle) {
    toggle.addEventListener("change", async () => {
      const nextState = toggle.checked;
      updateStatusUI(nextState);
      if (window.electronAPI && typeof window.electronAPI.stuckDetectionSet === "function") {
        try {
          const result = await window.electronAPI.stuckDetectionSet(nextState);
          updateStatusUI(result);
        } catch (err) {
          console.error("[Privacy] Failed to save stuck detection setting:", err);
          // Rollback on error
          updateStatusUI(!nextState);
        }
      }
    });
  }

  // Listen for changes from tray menu or other windows
  if (window.electronAPI && typeof window.electronAPI.onStuckDetectionChanged === "function") {
    window.electronAPI.onStuckDetectionChanged((enabled) => {
      updateStatusUI(enabled);
    });
  }

  // Close handlers
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      window.close();
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      window.close();
    }
  });
});
