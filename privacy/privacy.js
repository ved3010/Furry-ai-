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

  // Sensory Comfort Elements
  const quietToggle = document.getElementById("quiet-mode-toggle");
  const quietBadge = document.getElementById("quiet-status-badge");
  const calmToggle = document.getElementById("calm-motion-toggle");
  const calmBadge = document.getElementById("calm-motion-status-badge");
  const softToggle = document.getElementById("soft-colors-toggle");
  const softBadge = document.getElementById("soft-colors-status-badge");

  function updateSensoryUI(settings) {
    if (!settings || typeof settings !== "object") return;

    if (quietToggle) quietToggle.checked = Boolean(settings.quietMode);
    if (quietBadge) {
      const on = Boolean(settings.quietMode);
      quietBadge.textContent = on ? "On" : "Off";
      quietBadge.className = `status-badge ${on ? "on" : "off"}`;
    }

    if (calmToggle) calmToggle.checked = Boolean(settings.calmMotion);
    if (calmBadge) {
      const on = Boolean(settings.calmMotion);
      calmBadge.textContent = on ? "On" : "Off";
      calmBadge.className = `status-badge ${on ? "on" : "off"}`;
    }

    if (softToggle) softToggle.checked = Boolean(settings.softColors);
    if (softBadge) {
      const on = Boolean(settings.softColors);
      softBadge.textContent = on ? "On" : "Off";
      softBadge.className = `status-badge ${on ? "on" : "off"}`;
    }

    // Apply or remove soft-colors styling class on Privacy panel body
    document.body.classList.toggle("soft-colors", Boolean(settings.softColors));
  }

  // Initial Sensory Settings fetch
  if (window.electronAPI && typeof window.electronAPI.sensorySettingsGet === "function") {
    try {
      const initialSensory = await window.electronAPI.sensorySettingsGet();
      updateSensoryUI(initialSensory);
    } catch (err) {
      console.warn("[Privacy] Failed to fetch sensory settings:", err);
    }
  }

  // Sensory toggle change listeners
  async function saveSensoryChange(key, value) {
    if (window.electronAPI && typeof window.electronAPI.sensorySettingsSet === "function") {
      try {
        const updated = await window.electronAPI.sensorySettingsSet({ [key]: value });
        updateSensoryUI(updated);
      } catch (err) {
        console.error(`[Privacy] Failed to save sensory setting ${key}:`, err);
      }
    }
  }

  if (quietToggle) {
    quietToggle.addEventListener("change", () => saveSensoryChange("quietMode", quietToggle.checked));
  }
  if (calmToggle) {
    calmToggle.addEventListener("change", () => saveSensoryChange("calmMotion", calmToggle.checked));
  }
  if (softToggle) {
    softToggle.addEventListener("change", () => saveSensoryChange("softColors", softToggle.checked));
  }

  // Listen for sensory settings changes from main/tray/other windows
  if (window.electronAPI && typeof window.electronAPI.onSensorySettingsChanged === "function") {
    window.electronAPI.onSensorySettingsChanged((settings) => {
      updateSensoryUI(settings);
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
