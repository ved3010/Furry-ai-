"use strict";

(() => {
  const get = (id) => document.getElementById(id);
  const panel = get("agent-panel");
  const searchForm = get("agent-search-form");
  const searchShell = get("agent-search-shell");
  const searchInput = get("agent-search-input");
  const searchSend = get("agent-search-send");
  const voiceMicButton = get("voice-mic-button");
  const searchToggle = get("agent-search-toggle");
  const searchSettings = get("agent-search-settings");
  const quickCommands = get("agent-quick-commands");
  const quickButtons = [...quickCommands.querySelectorAll("button")];
  const responsePanel = get("agent-response");
  const responseStatus = get("agent-response-status");
  const responseScroll = get("agent-response-scroll");
  const responsePrompt = get("agent-response-prompt");
  const responseText = get("agent-response-text");
  const retryButton = get("agent-response-retry");
  const chatHistoryEl = get("agent-chat-history");
  const settingsPopover = get("agent-settings-popover");
  const configForm = get("agent-config-form");
  const baseUrlInput = get("agent-base-url");
  const modelInput = get("agent-model");
  const apiKeyInput = get("agent-api-key");
  const connectionTest = get("agent-connection-test");
  const configStatus = get("agent-config-status");
  const approval = get("agent-action-confirm");
  const approvalDescription = get("agent-action-description");
  const approveButton = get("agent-action-approve");
  const allowOnceButton = get("agent-action-allow-once");
  const rejectButton = get("agent-action-reject");
  const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
  const GEMINI_MODEL = "gemini-3.5-flash-lite";
  const ASK_TIMEOUT = 90_000;
  const ACTION_TIMEOUT = 20_000;
  const CONFIG_TIMEOUT = 10_000;
  // Leave time for the provider's 55-second deadline to return its own error.
  const CONNECTION_TEST_TIMEOUT = 65_000;

  const chatHistory = [];

  function appendChatHistory(sender, text) {
    if (!text) return;
    chatHistory.push({ sender, text });
    renderChatHistory();
  }

  function renderChatHistory() {
    if (!chatHistoryEl) return;
    if (typeof document.createElement === "function") {
      chatHistoryEl.innerHTML = "";
      for (const msg of chatHistory) {
        const row = document.createElement("div");
        row.className = `chat-msg chat-msg-${msg.sender}`;
        const bubble = document.createElement("div");
        bubble.className = "chat-msg-bubble";
        bubble.textContent = msg.text;
        row.appendChild(bubble);
        chatHistoryEl.appendChild(row);
      }
    } else {
      chatHistoryEl.textContent = chatHistory.map((m) => `${m.sender}: ${m.text}`).join("\n");
    }
  }

  let responseTimer = null;
  let responseVersion = 0;
  let progressTimer = null;
  let operation = 0;
  let busy = false;
  let pendingAction = null;
  let pendingApprovalToken = "";
  let lastPrompt = "";
  let failedPrompt = "";
  let failedAction = null;
  let configBusy = false;
  let configRevision = 0;
  let lastPointer = null;
  let interactionActive = false;

  // Bounds both IPC and HTTP waits. Late IPC replies are ignored by Promise.race;
  // never retry an uncertain IPC failure via a second transport.
  async function bounded(work, timeout, controller) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(work),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            const error = new Error("The agent took too long to respond.");
            error.code = "AGENT_BRIDGE_TIMEOUT";
            reject(error);
            controller?.abort();
          }, timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function waitForRpcToken() {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      function check() {
        if (window.__COMNYANG_AGENT_TOKEN) return resolve(window.__COMNYANG_AGENT_TOKEN);
        if (Date.now() - started >= 2000) return reject(new Error("The agent is not ready. Please retry in a moment."));
        setTimeout(check, 50);
      }
      check();
    });
  }

  async function rpc(method, payload, timeout) {
    const token = await waitForRpcToken();
    const controller = new AbortController();
    return bounded(async () => {
      const port = Number.isInteger(window.__COMNYANG_AGENT_PORT) ? window.__COMNYANG_AGENT_PORT : 23457;
      const response = await fetch(`http://127.0.0.1:${port}/agent-rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Comnyang-Agent-Token": token },
        body: JSON.stringify({ method, payload }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.message || "The cat agent is offline. Please retry.");
      return result;
    }, timeout, controller);
  }

  function callAgent(method, payload, timeout = CONFIG_TIMEOUT) {
    const names = {
      "state-get": "getState",
      "config-set": "updateConfig",
      "config-test": "testConnection",
      ask: "ask",
      "action-execute": "executeAction",
      "approvals-clear": "clearApprovals",
    };
    const name = names[method];
    if (typeof window.agentAPI?.[name] === "function") {
      return bounded(() => method === "state-get"
        ? window.agentAPI[name]()
        : window.agentAPI[name](method === "ask" ? payload.prompt : payload), timeout);
    }
    return rpc(method, payload, timeout);
  }

  function executeApprovedAction(payload) {
    // Only the backend can validate and consume an approval token.
    return callAgent("action-execute", payload, ACTION_TIMEOUT);
  }

  function setSettingsOpen(open, focus = false) {
    settingsPopover.hidden = !open;
    searchSettings.setAttribute("aria-expanded", String(open));
    quickCommands.inert = open;
    responsePanel.inert = open;
    if (focus && !panel.hidden) (open ? apiKeyInput : searchSettings).focus();
    syncInteraction();
  }

  function showBar(focus = false) {
    panel.hidden = false;
    panel.inert = false;
    document.body.removeAttribute("data-agent-search-hidden");
    searchToggle.setAttribute("aria-expanded", "true");
    searchToggle.removeAttribute("data-attention");
    if (searchInput) searchInput.placeholder = "Ask anything...";
    if (responseText.textContent || busy || chatHistory.length > 0) responsePanel.hidden = false;
    if (focus) searchInput.focus();
    syncInteraction();
  }

  function hideBar(focus = false) {
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    panel.hidden = true;
    panel.inert = true;
    document.body.setAttribute("data-agent-search-hidden", "");
    searchToggle.setAttribute("aria-expanded", "false");
    setSettingsOpen(false);
    if (focus) searchToggle.focus();
    syncInteraction();
  }

  function clearResponseTimer() {
    clearTimeout(responseTimer);
    responseTimer = null;
    responseVersion += 1;
  }

  // Agent output has its own scroll area; pet/reminder speech timers cannot erase it.
  // duration=0 is persistent, including failures and approval requests.
  function showResponse(text, { status = "Reply", prompt = lastPrompt, duration = 0 } = {}) {
    clearResponseTimer();
    const version = responseVersion;
    responseText.textContent = String(text || "");
    const cleanPrompt = prompt ? String(prompt).replace(/^(?:You:\s*)+/i, "").trim() : "";
    responsePrompt.textContent = cleanPrompt ? `You: ${cleanPrompt}` : "";
    responsePrompt.hidden = !cleanPrompt;
    responseStatus.textContent = status;
    if (responseScroll) responseScroll.scrollTop = responseScroll.scrollHeight;
    responsePanel.hidden = false;
    retryButton.hidden = !failedPrompt;
    if (panel.hidden) searchToggle.setAttribute("data-attention", "");
    searchToggle.title = `Open AI cat chat — ${status}`;
    if (duration > 0) {
      responseTimer = setTimeout(() => {
        if (version !== responseVersion || busy || pendingAction) return;
        if (responsePanel.contains(document.activeElement)) searchInput.focus();
        responsePanel.hidden = true;
        responseText.textContent = "";
        syncInteraction();
      }, duration);
    }
    syncInteraction();
  }

  function friendlyError(error) {
    const message = String(error?.message || "I couldn't answer that. Please retry.");
    const reason = String(error?.reason || error?.code || error?.name || "");
    if (reason === "AGENT_NOT_CONFIGURED") {
      return /could not be unlocked|cannot be unlocked/i.test(message)
        ? message
        : "Open ⚙ to configure your API endpoint and key, then Retry.";
    }
    if (reason === "AGENT_AUTH") return "The API key was rejected. For Gemini, create an authorization key or restrict the key to the Gemini API, then save and Test again.";
    if (reason === "AGENT_BILLING") return "Gemini can see the project, but generation is blocked by billing or quota. Enable billing for the Google Cloud project used by this key, then click Check API connection again.";
    if (reason === "AGENT_MODEL") return "The model or API endpoint is unavailable. Check the model name and endpoint in settings.";
    if (reason === "AGENT_NETWORK") return message;
    if (reason === "AGENT_BAD_RESPONSE" || reason === "AGENT_EMPTY_RESPONSE") return "The provider connected but returned an unusable answer. Try another chat model or endpoint.";
    if (/abort|timeout|timed.?out/i.test(`${reason} ${message}`)) {
      return "The request was interrupted or took too long. Your prompt is saved — please Retry.";
    }
    if (/high demand|temporarily unavailable|service unavailable|\b503\b|\b429\b/i.test(message)) {
      return "The model is busy right now. Your prompt is saved — retry in a moment.";
    }
    if (reason === "approval-required") return "That permission is no longer active. Retry to approve it again.";
    if (/failed to fetch|fetch failed|network|ECONNREFUSED|no handler registered/i.test(message)) {
      return "I can't reach the agent right now. Your prompt is saved — please Retry.";
    }
    return message;
  }

  function connectionError(error, phase) {
    const reason = String(error?.reason || error?.code || error?.name || "");
    if (reason === "AGENT_BRIDGE_TIMEOUT") {
      return phase === "save"
        ? "Saving settings timed out. Fully quit and reopen the cat, then click Check API connection again."
        : "The cat did not respond to the connection check. Fully quit and reopen it, then click Check API connection again.";
    }
    if (/abort|timeout|timed.?out/i.test(`${reason} ${error?.message || ""}`)) {
      const elapsed = Number.isFinite(error?.elapsedMs) ? ` after ${Math.round(error.elapsedMs / 1000)}s` : "";
      if (error?.modelAccessVerified) {
        return `Google accepted the key for model lookup, but generation timed out${elapsed}. Chat is not ready yet. Click Check API connection to retry; billing and generation access are not confirmed.`;
      }
      if (error?.stage === "model-access") {
        return `Google's key/model lookup timed out${elapsed}, before any generation request. Check your system network or proxy settings, then click Check API connection again.`;
      }
      return `The model provider timed out${elapsed}. The key and generation access are still unverified. Check your network or proxy, then click Check API connection again.`;
    }
    if (reason === "AGENT_NETWORK") {
      if (error?.networkCode && error?.message) return `${error.message} (${error.networkCode})`;
      return "Could not reach the model provider. Check your internet connection, API endpoint, and proxy or firewall, then click Check API connection again.";
    }
    if (["AGENT_RATE_LIMIT", "AGENT_UNAVAILABLE"].includes(reason)) {
      return "The model provider is busy or unavailable. Wait a moment, then click Check API connection again.";
    }
    return friendlyError(error);
  }

  function updateKeyPlaceholder(config) {
    apiKeyInput.placeholder = config?.apiKeyConfigured && config.apiKeyStatus !== "not required for local endpoint"
      ? "Saved key — leave blank to keep it" : "Paste API key";
  }

  function setBusy(value) {
    busy = value;
    // Read-only keeps keyboard focus and the submitted prompt visible during work.
    searchInput.disabled = false;
    searchInput.readOnly = value;
    searchSend.disabled = value;
    if (voiceMicButton) voiceMicButton.disabled = value;
    retryButton.disabled = value;
    quickButtons.forEach((button) => { button.disabled = value; });
    searchShell.classList.toggle("is-busy", value);
    searchForm.setAttribute("aria-busy", String(value));
    searchToggle.toggleAttribute("data-busy", value);
  }

  function beginOperation(label, prompt) {
    const id = ++operation;
    clearInterval(progressTimer);
    failedPrompt = "";
    failedAction = null;
    setBusy(true);
    showResponse("Waiting for the agent…", { status: `${label} · 0s`, prompt });
    window.catPet?.setThinking?.(true);
    const started = Date.now();
    progressTimer = setInterval(() => {
      if (!busy || id !== operation) return;
      const elapsed = Math.floor((Date.now() - started) / 1000);
      responseStatus.textContent = `${label} · ${elapsed}s`;
      searchToggle.title = `Open AI cat chat — ${label.toLowerCase()} · ${elapsed}s`;
      if (elapsed >= 10) responseText.textContent = "Still waiting. You can hide this panel; the result will stay here.";
    }, 1000);
    return id;
  }

  function finishOperation(id) {
    if (id !== operation) return;
    clearInterval(progressTimer);
    progressTimer = null;
    setBusy(false);
    window.catPet?.setThinking?.(false);
  }

  function clearApproval() {
    pendingAction = null;
    pendingApprovalToken = "";
    approval.hidden = true;
  }

  function showFailure(error, prompt, action = null) {
    failedPrompt = prompt;
    searchInput.value = prompt;
    const reason = String(error?.reason || error?.code || "");
    failedAction = action && reason !== "approval-required" ? action : null;
    const uncertain = Boolean(action) && /timeout|abort/i.test(`${error?.code} ${error?.name} ${error?.message}`);
    const failureMsg = uncertain
      ? "I couldn't confirm whether the action finished. Check the result before retrying."
      : friendlyError(error);
    showResponse(failureMsg, { status: "Couldn't finish", prompt });
    retryButton.title = failedAction ? "Retry the action instantly using its saved permission" : "Retry the saved prompt";
    window.catPet?.setThinking?.(false);
  }

  async function runAction(action, token, prompt, decision = "once") {
    clearApproval();
    const id = beginOperation("Working", prompt);
    try {
      let result = await executeApprovedAction({ action, approvalToken: token, decision });
      // renderer-action is returned ONLY after the backend validates the exact
      // action and either a one-time token or a saved grant.
      if (action.type === "create_reminder" && result?.ok === false && result.reason === "renderer-action") {
        const added = await bounded(() => window.electronAPI.reminderAdd(action), ACTION_TIMEOUT);
        result = added?.ok
          ? { ok: true, message: `Reminder set for ${action.time}.` }
          : { ok: false, message: "I couldn't set that reminder. Retry; the cat will keep the saved permission." };
      }
      if (!result?.ok) throw result || new Error("The action returned no result.");
      finishOperation(id);
      showResponse(result.message || "Done.", { status: "Complete", prompt });
      window.catPet?.meow?.();
    } catch (error) {
      finishOperation(id);
      showFailure(error, prompt, action);
    } finally {
      finishOperation(id);
      if (!panel.hidden && [approveButton, allowOnceButton, rejectButton].includes(document.activeElement)) searchInput.focus();
    }
  }

  async function submitQuestion(event) {
    event?.preventDefault();
    const prompt = searchInput.value.trim();
    if (!prompt || busy) return;
    if (panel.hidden) showBar();

    // Commit previous turn into history if present
    const previousReply = responseText.textContent.trim();
    if (lastPrompt && previousReply && !previousReply.startsWith("Waiting") && !previousReply.startsWith("Still waiting")) {
      appendChatHistory("user", lastPrompt);
      appendChatHistory("cat", previousReply);
    }

    lastPrompt = prompt;
    clearApproval();
    setSettingsOpen(false);
    const id = beginOperation("Thinking", prompt);
    try {
      const result = await callAgent("ask", { prompt }, ASK_TIMEOUT);
      if (!result?.ok) throw result || new Error("The agent returned no response. Please Retry.");
      if (result.confirmationRequired && (!result.action || !result.approvalToken)) {
        throw new Error("The agent did not supply a valid approval request. Please Retry.");
      }
      finishOperation(id);
      if (searchInput.value.trim() === prompt || !busy) searchInput.value = "";
      showResponse(result.reply || "Done.", { status: result.confirmationRequired ? "Permission needed" : "Reply" });
      window.catPet?.setThinking?.(false);
      window.catPet?.meow?.();
      window.catPet?.jump?.();

      // When chat tab is open, show answer ONLY beside cat in chat panel.
      // If user closed the chat tab, show one bubble on top of the cat!
      if (panel.hidden) {
        const replyText = String(result.reply || "");
        const topTaskMatch = replyText.match(/🎯\s*\**#1[^\n*]*\**:\s*([^\n]+)/i);
        const tinyStepMatch = replyText.match(/🐾\s*\**Your Tiny Step[^\n]*\**:\s*\n*([^\n]+)/i);
        if (topTaskMatch || tinyStepMatch) {
          const top = topTaskMatch ? topTaskMatch[1].replace(/\*\*/g, "").trim() : "";
          const step = tinyStepMatch ? tinyStepMatch[1].replace(/\*\*/g, "").trim() : "";
          const catSpeech = top && step ? `🎯 #1: ${top}\n🐾 Tiny Step: ${step}` : (top ? `🎯 #1: ${top}` : step);
          window.catPet?.speak?.(catSpeech, { duration: 9000, kind: "notice" });
        } else {
          const firstLine = replyText.split("\n").map((l) => l.trim()).filter(Boolean)[0] || "";
          if (firstLine && firstLine.length <= 100) {
            window.catPet?.speak?.(firstLine.replace(/\*\*/g, ""), { duration: 4500, kind: "notice" });
          } else {
            window.catPet?.speak?.("Mew! I answered in chat. 🐾", { duration: 3500, kind: "notice" });
          }
        }
      }
      if (result.confirmationRequired) {
        pendingAction = result.action;
        pendingApprovalToken = result.approvalToken;
        approvalDescription.textContent = result.actionDescription || "Allow this action?";
        approval.hidden = false;
      } else if (result.autoExecuteAction && result.action) {
        await runAction(result.action, "", prompt, "always");
      }
    } catch (error) {
      finishOperation(id);
      showFailure(error, prompt);
    } finally {
      finishOperation(id);
    }
  }

  async function approveAction(decision = "always") {
    if (!pendingAction || busy || panel.hidden) return;
    const action = pendingAction;
    const token = pendingApprovalToken;
    const prompt = lastPrompt;
    await runAction(action, token, prompt, decision);
  }

  async function saveConfig(event, clearApiKey = false) {
    event?.preventDefault();
    if (configBusy) return;
    configBusy = true;
    configRevision += 1;
    const controls = [...configForm.querySelectorAll("input, button")];
    controls.forEach((control) => { control.disabled = true; });
    configStatus.textContent = clearApiKey ? "Removing…" : "Saving…";
    try {
      const result = await callAgent("config-set", {
        baseUrl: baseUrlInput.value,
        model: modelInput.value,
        ...(clearApiKey ? { clearApiKey: true } : { apiKey: apiKeyInput.value }),
      });
      if (!result || result.ok === false) throw result || new Error("Could not save settings.");
      apiKeyInput.value = "";
      updateKeyPlaceholder(result);
      configStatus.textContent = clearApiKey ? "Key removed." : "Saved. You can retry your question.";
    } catch (error) {
      configStatus.textContent = friendlyError(error);
    } finally {
      configBusy = false;
      controls.forEach((control) => { control.disabled = false; });
    }
  }

  async function testConnection() {
    if (configBusy) return;
    configBusy = true;
    // A late startup state response must not replace the connection result.
    configRevision += 1;
    const controls = [...configForm.querySelectorAll("input, button")];
    controls.forEach((control) => { control.disabled = true; });
    connectionTest.textContent = "Checking…";
    configStatus.textContent = "Saving settings for the connection check…";
    let phase = "save";
    let connectionProgress;
    try {
      const saved = await callAgent("config-set", {
        baseUrl: baseUrlInput.value,
        model: modelInput.value,
        ...(apiKeyInput.value.trim() ? { apiKey: apiKeyInput.value } : {}),
      });
      if (!saved || saved.ok === false) throw saved || new Error("Could not save the settings for testing.");
      apiKeyInput.value = "";
      updateKeyPlaceholder(saved);
      phase = "generation";
      configStatus.textContent = "Checking the API connection…";
      const started = Date.now();
      connectionProgress = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        configStatus.textContent = `Checking the API connection… ${elapsed}s. Waiting for a generated reply (up to 55s).`;
      }, 1000);
      const result = await callAgent("config-test", {}, CONNECTION_TEST_TIMEOUT);
      if (result?.ok) {
        const elapsed = Number.isFinite(result.elapsedMs) ? ` in ${result.elapsedMs}ms` : "";
        configStatus.textContent = `Connected to ${result.model || "the model"}${elapsed}. API key accepted.`;
      } else {
        configStatus.textContent = connectionError(result || new Error("The connection test failed."), phase);
      }
    } catch (error) {
      configStatus.textContent = connectionError(error, phase);
    } finally {
      clearInterval(connectionProgress);
      configBusy = false;
      connectionTest.textContent = "Check API connection";
      controls.forEach((control) => { control.disabled = false; });
    }
  }

  function isInside(element, point, margin = 8) {
    if (!point || !element || element.closest("[hidden], [inert]")) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none" || style.opacity === "0") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && point.clientX >= (rect.left - margin) && point.clientX <= (rect.right + margin)
      && point.clientY >= (rect.top - margin) && point.clientY <= (rect.bottom + margin);
  }

  function syncInteraction() {
    const bubbleEl = document.getElementById("cat-speech-bubble");
    const isPrompt = document.body.dataset.speech === "gentle-prompt" || document.body.dataset.speech === "gentle-paw";
    const targets = panel.hidden ? [searchToggle, ...(isPrompt && bubbleEl ? [bubbleEl] : [])]
      : [searchShell, settingsPopover, ...(settingsPopover.hidden ? [responsePanel, ...quickButtons] : [])];
    const active = targets.some((element) => isInside(element, lastPointer));
    if (active === interactionActive) return;
    interactionActive = active;
    if (window.agentAPI?.setInteractionActive) window.agentAPI.setInteractionActive(active);
    // Older preloads cannot arbitrate ownership. Only claim a visible UI hit;
    // leave release decisions to the existing pet renderer in that fallback.
    else if (active) window.electronAPI?.setMouseEventsEnabled?.(true);
  }

  searchForm.addEventListener("submit", submitQuestion);
  const searchHideBtn = get("agent-search-hide");
  const onHideBar = () => hideBar(true);
  searchHideBtn.addEventListener("click", onHideBar);
  searchHideBtn.addEventListener("pointerdown", onHideBar);
  searchHideBtn.addEventListener("mousedown", onHideBar);
  searchToggle.addEventListener("click", () => showBar(true));
  searchSettings.addEventListener("click", () => setSettingsOpen(settingsPopover.hidden, true));
  get("agent-settings-close").addEventListener("click", () => setSettingsOpen(false, true));
  const responseCloseBtn = get("agent-response-close");
  const onResponseClose = () => {
    if (busy) return hideBar(true);
    clearResponseTimer();
    clearApproval();
    responsePanel.hidden = true;
    responseText.textContent = "";
    searchInput.focus();
    syncInteraction();
  };
  responseCloseBtn.addEventListener("click", onResponseClose);
  responseCloseBtn.addEventListener("pointerdown", onResponseClose);
  responseCloseBtn.addEventListener("mousedown", onResponseClose);

  const keepActive = () => {
    if (!interactionActive) {
      interactionActive = true;
      if (window.agentAPI?.setInteractionActive) window.agentAPI.setInteractionActive(true);
      else window.electronAPI?.setMouseEventsEnabled?.(true);
    }
  };
  [searchShell, responsePanel, settingsPopover].forEach((el) => {
    if (!el) return;
    el.addEventListener("mouseenter", keepActive);
    el.addEventListener("pointerenter", keepActive);
  });
  responsePanel.addEventListener("wheel", (e) => {
    e.stopPropagation();
    if (responseScroll) {
      responseScroll.scrollTop += e.deltaY;
    }
  }, { passive: true });
  retryButton.addEventListener("click", () => {
    if (!failedPrompt || busy) return;
    const prompt = failedPrompt;
    if (failedAction) {
      runAction(failedAction, "", prompt, "always");
      return;
    }
    searchInput.value = prompt;
    submitQuestion();
  });
  quickButtons.forEach((button) => button.addEventListener("click", () => {
    if (busy) return;
    searchInput.value = button.dataset.agentPrompt;
    submitQuestion();
  }));
  configForm.addEventListener("input", () => { configRevision += 1; });
  get("agent-gemini-preset").addEventListener("click", () => {
    configRevision += 1;
    baseUrlInput.value = GEMINI_URL;
    modelInput.value = GEMINI_MODEL;
    configStatus.textContent = "Paste your key and Save";
    apiKeyInput.focus();
  });
  connectionTest.addEventListener("click", (event) => {
    event.preventDefault();
    void testConnection();
  });
  get("agent-api-key-clear").addEventListener("click", (event) => saveConfig(event, true));
  get("agent-approvals-clear").addEventListener("click", async () => {
    configStatus.textContent = "Forgetting permissions…";
    try {
      const result = await callAgent("approvals-clear", {}, CONFIG_TIMEOUT);
      configStatus.textContent = result?.ok ? "Saved permissions forgotten." : "Could not forget permissions.";
    } catch (error) {
      configStatus.textContent = friendlyError(error);
    }
  });
  configForm.addEventListener("submit", saveConfig);
  approveButton.addEventListener("click", () => approveAction("always"));
  allowOnceButton.addEventListener("click", () => approveAction("once"));
  rejectButton.addEventListener("click", () => {
    clearApproval();
    showResponse("Okay, I won't do that.", { status: "Not approved", duration: 3000 });
    searchInput.focus();
  });

  window.addEventListener("mousemove", (event) => {
    lastPointer = { clientX: event.clientX, clientY: event.clientY };
    syncInteraction();
  }, { passive: true });
  window.addEventListener("mouseleave", () => { lastPointer = null; syncInteraction(); });
  window.addEventListener("blur", () => { lastPointer = null; syncInteraction(); });
  window.addEventListener("resize", syncInteraction);
  // Native cursor polling still arrives when the transparent window ignores clicks.
  window.electronAPI?.onCursorPos?.(({ dx, dy }) => {
    lastPointer = { clientX: dx + window.innerWidth / 2, clientY: dy + window.innerHeight / 2 };
    syncInteraction();
  });
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      showBar(true);
    } else if (event.key === "Escape" && !panel.hidden && panel.contains(document.activeElement)) {
      event.preventDefault();
      if (!settingsPopover.hidden) setSettingsOpen(false, true);
      else hideBar(true);
    }
  });

  const ENERGY_DESCRIPTORS = {
    1: { level: 1, name: "Loaf", emoji: "💤", subtitle: "curled up, resting" },
    2: { level: 2, name: "Sleepy", emoji: "🥱", subtitle: "yawning, cozy" },
    3: { level: 3, name: "Chill", emoji: "😸", subtitle: "cheerful & steady" },
    4: { level: 4, name: "Playful", emoji: "⚡", subtitle: "energetic & lively" },
    5: { level: 5, name: "Zoomies", emoji: "💨", subtitle: "high energy, full sprint" },
  };

  async function openChatWithEnergy(level, fromCheckIn = true) {
    const num = Number(level) || 3;
    if (window.electronAPI?.energySet) {
      try { await window.electronAPI.energySet(num); } catch (_) {}
    }
    const info = ENERGY_DESCRIPTORS[num] || ENERGY_DESCRIPTORS[3];
    showBar(true);

    if (fromCheckIn) {
      showResponse(
        `Mew! Your energy is set to Level ${num} (${info.name} ${info.emoji}). 🐾\n\nTell me what tasks or homework you need to work on, and I will prioritize them and give you a tiny step tailored to your energy!`,
        { status: `Level ${num} · ${info.name}` }
      );
      if (searchInput) {
        searchInput.placeholder = "Tell me your tasks (e.g. math homework, history essay)...";
        searchInput.focus();
        searchInput.select?.();
      }
      window.catPet?.meow?.();
    } else {
      if (searchInput) {
        searchInput.placeholder = "Ask anything...";
        searchInput.focus();
      }
    }
  }

  window.addEventListener("cat-open-chat-energy", (event) => {
    openChatWithEnergy(event?.detail?.level, true);
  });

  window.electronAPI?.onCatOpenChat?.(async () => {
    let level = 3;
    try {
      if (window.electronAPI?.energyGet) level = await window.electronAPI.energyGet();
    } catch (_) {}
    openChatWithEnergy(level, false);
  });
  window.addEventListener("cat-toggle-chat", () => {
    if (panel.hidden) {
      showBar(true);
    } else {
      hideBar(true);
    }
  });

  window.voiceAPI?.onPlaySong?.((data) => {
    if (data?.action === "listening") {
      voiceMicButton?.classList?.toggle?.("is-listening", true);
    }
  });

  window.voiceAPI?.onVoiceHeard?.((text) => {
    voiceMicButton?.classList?.toggle?.("is-listening", false);
    const value = String(text || "").trim().slice(0, 2000);
    if (!value || busy) return;
    showBar();
    searchInput.value = value;
    submitQuestion();
  });

  hideBar();
  const initialRevision = configRevision;
  callAgent("state-get").then((state) => {
    if (configRevision !== initialRevision) return;
    if (!state?.config || state.ok === false) throw new Error("Could not load agent settings.");
    baseUrlInput.value = state.config.baseUrl || GEMINI_URL;
    modelInput.value = state.config.model || GEMINI_MODEL;
    updateKeyPlaceholder(state.config);
    if (state.config.apiKeyStatus) configStatus.textContent = `API key: ${state.config.apiKeyStatus}.`;
  }).catch(() => {
    if (configRevision === initialRevision) configStatus.textContent = "Settings unavailable. Try again when the agent is ready.";
  });
})();
