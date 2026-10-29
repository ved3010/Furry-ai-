"use strict";

(() => {
  const bubble = document.getElementById("cat-speech-bubble");
  const bubbleContainer = document.getElementById("cat-speech-bubble-container");
  let purrTimeout = null;
  let activePurrAudio = null;
  let isPromptOpen = false;

  const ENERGY_OPTIONS = [
    { level: 1, name: "Loaf", emoji: "💤", desc: "Curled up, resting" },
    { level: 2, name: "Sleepy", emoji: "🥱", desc: "Yawning, cozy" },
    { level: 3, name: "Chill", emoji: "😸", desc: "Cheerful & steady" },
    { level: 4, name: "Playful", emoji: "⚡", desc: "Energetic & lively" },
    { level: 5, name: "Zoomies", emoji: "💨", desc: "High energy, full sprint" },
  ];

  function setPromptMouseEvents(active) {
    if (window.agentAPI?.setInteractionActive) {
      window.agentAPI.setInteractionActive(active);
    }
    if (window.electronAPI?.setMouseEventsEnabled) {
      window.electronAPI.setMouseEventsEnabled(active);
    }
  }

  let isInteractiveFlow = false;

  function hideCheckInBubble(force = false) {
    if (isInteractiveFlow && !force) {
      return;
    }
    if (
      document.body.dataset.speech === "gentle-paw" ||
      document.body.dataset.speech === "gentle-prompt" ||
      document.body.dataset.speech === "gentle-energy"
    ) {
      delete document.body.dataset.speech;
      if (bubble) {
        bubble.textContent = "";
        bubble.removeAttribute("aria-label");
      }
    }
    if (isPromptOpen) {
      isPromptOpen = false;
      setPromptMouseEvents(false);
    }
    isInteractiveFlow = false;
  }

  function showPawBubble() {
    if (!bubble) return;
    isInteractiveFlow = false;
    if (isPromptOpen) {
      isPromptOpen = false;
      setPromptMouseEvents(false);
    }
    bubble.innerHTML = `<div class="paw-thought-bubble" aria-label="Cat is thinking of you">🐾</div>`;
    bubble.setAttribute("aria-label", "paw");
    document.body.dataset.speech = "gentle-paw";
  }

  function showEnergyPicker(currentLevel) {
    if (!bubble) return;
    isInteractiveFlow = true;
    isPromptOpen = true;

    bubble.innerHTML = `
      <div class="gentle-energy-container">
        <div class="gentle-energy-title">How is your cat energy today?</div>
        <div class="gentle-energy-grid">
          ${ENERGY_OPTIONS.map(
            (opt) => `
            <button type="button" class="gentle-energy-btn ${currentLevel === opt.level ? "selected" : ""}" data-level="${opt.level}" title="${opt.level} ${opt.name} (${opt.desc})">
              <span class="energy-emoji">${opt.emoji}</span>
              <span class="energy-label">${opt.level} ${opt.name}</span>
            </button>
          `
          ).join("")}
        </div>
        <div class="gentle-energy-footer">
          <button type="button" class="gentle-energy-skip" data-action="skip">Skip</button>
        </div>
      </div>
    `;

    bubble.setAttribute("aria-label", "How is your cat energy today?");
    document.body.dataset.speech = "gentle-energy";

    // Enable mouse events so picker buttons are hoverable and clickable
    setPromptMouseEvents(true);

    const energyBtns = bubble.querySelectorAll(".gentle-energy-btn");
    energyBtns.forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const lvl = Number(btn.getAttribute("data-level")) || 3;
        if (window.electronAPI?.energySet) {
          try { await window.electronAPI.energySet(lvl); } catch (_) {}
        }
        goToMainChatWithEnergy(lvl);
      });

      btn.addEventListener("mouseenter", () => {
        setPromptMouseEvents(true);
      });
    });

    const skipBtn = bubble.querySelector(".gentle-energy-skip");
    if (skipBtn) {
      skipBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (window.electronAPI?.energySkip) {
          try { await window.electronAPI.energySkip(); } catch (_) {}
        }
        goToMainChatWithEnergy(3);
      });

      skipBtn.addEventListener("mouseenter", () => {
        setPromptMouseEvents(true);
      });
    }

    if (bubbleContainer) {
      bubbleContainer.addEventListener("mouseenter", () => {
        if (isPromptOpen) setPromptMouseEvents(true);
      });
    }
  }

  // Active Tiny Step AI state in current conversation
  let currentTinyStepState = {
    userWorkText: "",
    energyLevel: 3,
    stepCount: 1,
    lastStepText: "",
  };

  function showWorkInputPrompt(level = 3) {
    if (!bubble) return;
    isPromptOpen = true;

    const num = Number(level) || 3;
    const info = ENERGY_OPTIONS.find((o) => o.level === num) || ENERGY_OPTIONS[2];
    currentTinyStepState.energyLevel = num;
    currentTinyStepState.stepCount = 1;

    bubble.innerHTML = `
      <div class="tiny-step-ai-container" style="max-width: 270px;">
        <div class="gentle-energy-title" style="font-size: 11px; opacity: 0.85; margin-bottom: 2px;">
          ${info.name} ${info.emoji} · Level ${info.level}
        </div>
        <div style="font-size: 13px; font-weight: 700; color: #ffffff; margin-bottom: 2px;">
          What are you working on?
        </div>
        <form class="tiny-step-input-row" id="tiny-step-work-form">
          <input
            type="text"
            id="tiny-step-work-input"
            class="tiny-step-text-input"
            placeholder="e.g. math homework, history essay..."
            maxlength="200"
            autocomplete="off"
            required
          />
          <button type="submit" class="gentle-checkin-btn btn-yes btn-accent" style="min-width: 54px; height: 32px; padding: 0 10px;">
            Send
          </button>
        </form>
      </div>
    `;

    bubble.setAttribute("aria-label", `Level ${info.level} ${info.name}. What are you working on?`);
    document.body.dataset.speech = "gentle-prompt";
    setPromptMouseEvents(true);

    const form = bubble.querySelector("#tiny-step-work-form");
    const input = bubble.querySelector("#tiny-step-work-input");

    if (input) {
      requestAnimationFrame(() => input.focus());
      input.addEventListener("mouseenter", () => setPromptMouseEvents(true));
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = input ? input.value.trim() : "";
        if (!text) return;
        currentTinyStepState.userWorkText = text;
        currentTinyStepState.stepCount = 1;

        // Show generating state
        renderStepLoading();
        await requestAndRenderTinyStep({ text, energyLevel: num, isSmaller: false, stepNumber: 1 });
      });
    }
  }

  function renderStepLoading() {
    if (!bubble) return;
    bubble.innerHTML = `
      <div class="tiny-step-ai-container" style="max-width: 270px; text-align: center; padding: 10px 0;">
        <div style="font-size: 13px; color: #ffffff; opacity: 0.9;">
          🐾 Thinking of a gentle tiny step for you...
        </div>
      </div>
    `;
    setPromptMouseEvents(true);
  }

  async function requestAndRenderTinyStep({ text, energyLevel, isSmaller = false, stepNumber = 1 }) {
    let result = null;
    try {
      if (window.electronAPI?.tinyStepAiGenerate) {
        result = await window.electronAPI.tinyStepAiGenerate({
          text,
          energyLevel,
          isSmaller,
          stepNumber,
        });
      }
    } catch (err) {
      console.warn("[gentle-checkin-ui] TinyStepAI IPC error:", err);
    }

    if (!result) {
      result = {
        isSafetyResponse: false,
        step: "Take a deep breath and start with just 1 minute on the title or first line.",
      };
    }

    currentTinyStepState.lastStepText = result.step;
    renderTinyStepResult(result);
  }

  function renderTinyStepResult(result) {
    if (!bubble) return;
    isPromptOpen = true;

    // Safety response case
    if (result.isSafetyResponse) {
      bubble.innerHTML = `
        <div class="tiny-step-ai-container" style="max-width: 275px;">
          <div style="font-size: 12.5px; font-weight: 600; line-height: 1.4; color: #ffdede; margin-bottom: 6px;">
            💛 ${result.step}
          </div>
          <div style="text-align: center; margin-top: 4px;">
            <button type="button" class="gentle-checkin-btn btn-yes btn-accent" data-action="close_safety">
              I Understand 🐾
            </button>
          </div>
        </div>
      `;
      bubble.setAttribute("aria-label", result.step);
      document.body.dataset.speech = "gentle-prompt";
      setPromptMouseEvents(true);

      const closeBtn = bubble.querySelector('[data-action="close_safety"]');
      if (closeBtn) {
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          hideCheckInBubble(true);
        });
      }
      return;
    }

    const stepText = String(result.step || "").trim();
    const trickName = result.matchedTrick?.name ? `💡 ${result.matchedTrick.name}` : "";

    bubble.innerHTML = `
      <div class="tiny-step-ai-container" style="max-width: 275px;">
        ${trickName ? `<div style="font-size: 11px; opacity: 0.75; letter-spacing: 0.01em;">${trickName}</div>` : ""}
        <div class="tiny-step-step-card">
          🐾 ${stepText}
        </div>
        <div class="tiny-step-actions-grid">
          <button type="button" class="tiny-step-action-btn btn-done" data-action="done" title="Complete this step">
            ✓ Done
          </button>
          <button type="button" class="tiny-step-action-btn" data-action="smaller" title="Make this step even smaller">
            Make it smaller
          </button>
          <button type="button" class="tiny-step-action-btn" data-action="next" title="Next tiny step">
            Next tiny step
          </button>
          <button type="button" class="tiny-step-action-btn" data-action="rest" title="Silence check-in for 60 minutes">
            I need rest
          </button>
        </div>
      </div>
    `;

    bubble.setAttribute("aria-label", `Tiny step: ${stepText}`);
    document.body.dataset.speech = "gentle-prompt";
    setPromptMouseEvents(true);

    // Bind action buttons: Done, Make it smaller, Next tiny step, I need rest
    const doneBtn = bubble.querySelector('[data-action="done"]');
    if (doneBtn) {
      doneBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Done makes cat purr and asks the AI for the next step
        playPurr();
        currentTinyStepState.stepCount += 1;
        renderStepLoading();
        await requestAndRenderTinyStep({
          text: currentTinyStepState.userWorkText,
          energyLevel: currentTinyStepState.energyLevel,
          isSmaller: false,
          stepNumber: currentTinyStepState.stepCount,
        });
      });
      doneBtn.addEventListener("mouseenter", () => setPromptMouseEvents(true));
    }

    const smallerBtn = bubble.querySelector('[data-action="smaller"]');
    if (smallerBtn) {
      smallerBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Asks for an easier step
        renderStepLoading();
        await requestAndRenderTinyStep({
          text: currentTinyStepState.userWorkText,
          energyLevel: currentTinyStepState.energyLevel,
          isSmaller: true,
          stepNumber: currentTinyStepState.stepCount,
        });
      });
      smallerBtn.addEventListener("mouseenter", () => setPromptMouseEvents(true));
    }

    const nextBtn = bubble.querySelector('[data-action="next"]');
    if (nextBtn) {
      nextBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        currentTinyStepState.stepCount += 1;
        renderStepLoading();
        await requestAndRenderTinyStep({
          text: currentTinyStepState.userWorkText,
          energyLevel: currentTinyStepState.energyLevel,
          isSmaller: false,
          stepNumber: currentTinyStepState.stepCount,
        });
      });
      nextBtn.addEventListener("mouseenter", () => setPromptMouseEvents(true));
    }

    const restBtn = bubble.querySelector('[data-action="rest"]');
    if (restBtn) {
      restBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Closes bubble and silences check-in for 60 minutes
        hideCheckInBubble(true);
        if (window.electronAPI?.gentleCheckInNeedRest) {
          window.electronAPI.gentleCheckInNeedRest();
        } else if (window.electronAPI?.gentleCheckInRespond) {
          window.electronAPI.gentleCheckInRespond("need_rest");
        }
      });
      restBtn.addEventListener("mouseenter", () => setPromptMouseEvents(true));
    }
  }

  function goToMainChatWithEnergy(level) {
    hideCheckInBubble(true);
    if (window.electronAPI?.gentleCheckInRespond) {
      window.electronAPI.gentleCheckInRespond("yes_picked");
    }
    window.dispatchEvent(new CustomEvent("cat-open-chat-energy", { detail: { level } }));
  }

  async function showTinyStepResult(level) {
    goToMainChatWithEnergy(level);
  }

  function showPromptBubble(data) {
    if (!bubble) return;
    isInteractiveFlow = false;
    isPromptOpen = true;
    const text = data?.text || "Mew? Things look quiet. Want one tiny step?";
    const buttons = data?.buttons || [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ];

    bubble.innerHTML = `
      <div class="gentle-checkin-container">
        <div class="gentle-checkin-text">${text}</div>
        <div class="gentle-checkin-buttons">
          ${buttons
            .map(
              (btn) => `
            <button type="button" class="gentle-checkin-btn ${btn.id === "yes" || btn.id === "yes_help_me" ? "btn-yes btn-accent" : "btn-no"}" data-action="${btn.id}">
              ${btn.label}
            </button>
          `
            )
            .join("")}
        </div>
      </div>
    `;

    bubble.setAttribute("aria-label", text);
    document.body.dataset.speech = "gentle-prompt";

    // Enable mouse events so buttons are immediately visible, hoverable, and clickable
    setPromptMouseEvents(true);

    // Bind click events on buttons
    const btnElements = bubble.querySelectorAll(".gentle-checkin-btn");
    btnElements.forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const action = btn.getAttribute("data-action");

        if (action === "yes" || action === "yes_help_me") {
          isInteractiveFlow = true;
          // Inform main process to reset stuck counters without triggering chat yet
          if (window.electronAPI?.gentleCheckInRespond) {
            window.electronAPI.gentleCheckInRespond("yes_picked");
          }

          // Always prompt for energy level when tiny task reminder asks, regardless of previous energy or restart
          showEnergyPicker();
          return;
        }

        hideCheckInBubble(true);
        if (window.electronAPI?.gentleCheckInRespond) {
          window.electronAPI.gentleCheckInRespond(action);
        }
      });

      btn.addEventListener("mouseenter", () => {
        setPromptMouseEvents(true);
      });
    });

    if (bubbleContainer) {
      bubbleContainer.addEventListener("mouseenter", () => {
        if (isPromptOpen) setPromptMouseEvents(true);
      });
    }
  }

  function playPurr() {
    document.body.dataset.purring = "1";
    if (purrTimeout) {
      clearTimeout(purrTimeout);
      purrTimeout = null;
    }

    try {
      if (activePurrAudio) {
        activePurrAudio.pause();
        activePurrAudio.currentTime = 0;
      }
      activePurrAudio = new Audio("../assets/sound/purring.m4a");
      activePurrAudio.volume = 0.15;
      activePurrAudio.play().catch(() => {});
    } catch (_) {}

    purrTimeout = setTimeout(() => {
      delete document.body.dataset.purring;
      if (activePurrAudio) {
        try {
          activePurrAudio.pause();
        } catch (_) {}
        activePurrAudio = null;
      }
    }, 4000);
  }

  // Register Electron IPC listeners
  window.electronAPI?.onGentleCheckInShowPaw?.(() => {
    showPawBubble();
  });

  window.electronAPI?.onGentleCheckInShowPrompt?.((data) => {
    showPromptBubble(data);
  });

  window.electronAPI?.onGentleCheckInShowEnergy?.((data) => {
    showEnergyPicker(data?.currentLevel);
  });

  window.electronAPI?.onGentleCheckInHide?.(() => {
    if (isInteractiveFlow) return;
    hideCheckInBubble();
  });

  window.electronAPI?.onGentleCheckInPurr?.(() => {
    playPurr();
  });

  window.electronAPI?.onGentleCheckInCancel?.(() => {
    hideCheckInBubble(true);
  });
})();
