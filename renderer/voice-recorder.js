"use strict";

(() => {
  const micButton = document.getElementById("voice-mic-button");
  const speechBubble = document.getElementById("cat-speech-bubble");

  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingTimeout = null;
  let vadInterval = null;
  let audioContext = null;
  let isRecording = false;

  function showBubble(text, durationMs = 2500) {
    if (!speechBubble) return;
    speechBubble.textContent = text;
    speechBubble.setAttribute("aria-label", text);
    document.body.dataset.speech = "notice";
    if (durationMs > 0) {
      setTimeout(() => {
        if (speechBubble.textContent === text) {
          speechBubble.textContent = "";
          delete document.body.dataset.speech;
        }
      }, durationMs);
    }
  }

  async function startRecording() {
    if (isRecording) {
      stopRecording();
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        showBubble("Microphone not supported", 3000);
        return;
      }

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      audioChunks = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        cleanupAudio();
        const searchInput = document.getElementById("agent-search-input");
        if (searchInput && searchInput.placeholder === "Listening... 🎙️") {
          searchInput.placeholder = "Tell me your tasks (e.g. math homework)...";
        }

        if (audioChunks.length === 0) return;

        const audioBlob = new Blob(audioChunks, { type: mimeType });
        if (audioBlob.size < 500) return;

        window.catPet?.setThinking?.(true);

        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          if (window.voiceAPI?.transcribeAudio) {
            const result = await window.voiceAPI.transcribeAudio(arrayBuffer, mimeType);
            if (result?.ok && result.text) {
              const text = result.text.trim();
              if (text && searchInput) {
                searchInput.value = text;
                const searchForm = document.getElementById("agent-search-form");
                if (searchForm) {
                  searchForm.dispatchEvent(new Event("submit", { cancelable: true }));
                }
              }
            } else if (result?.error === "MISSING_KEY") {
              showBubble("Paste Groq key in .env file! 🔑", 4000);
            } else if (result?.error) {
              showBubble("Couldn't hear clearly 😿", 2500);
            }
          }
        } catch (err) {
          console.error("[VoiceRecorder] Transcription failed:", err);
          showBubble("Voice error 😿", 2500);
        } finally {
          window.catPet?.setThinking?.(false);
        }
      };

      mediaRecorder.start(200);
      isRecording = true;
      if (micButton) micButton.classList.add("is-listening");
      const searchInput = document.getElementById("agent-search-input");
      if (searchInput) searchInput.placeholder = "Listening... 🎙️";

      // Voice Activity Detection (silence detection)
      setupVad(mediaStream);

      // Generous safety cap (10 minutes) so user can speak for 2 sec, 1 min, or 10 min without cutoff
      if (recordingTimeout) clearTimeout(recordingTimeout);
      recordingTimeout = setTimeout(() => {
        if (isRecording) {
          stopRecording();
        }
      }, 10 * 60 * 1000);
    } catch (err) {
      console.error("[VoiceRecorder] getUserMedia error:", err);
      showBubble("Mic permission needed 🎙️", 3000);
      cleanupAudio();
    }
  }

  function setupVad(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      audioContext = new AudioCtx();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let hasSpoken = false;
      let silenceStartTime = null;
      const recordingStartTime = Date.now();

      if (vadInterval) clearInterval(vadInterval);
      vadInterval = setInterval(() => {
        if (!isRecording) {
          clearInterval(vadInterval);
          vadInterval = null;
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avgVolume = sum / bufferLength;

        // Threshold for human speech vs background room noise (raised to 24 so background noise/fans aren't counted as speech)
        if (avgVolume > 24) {
          hasSpoken = true;
          silenceStartTime = null;
        } else if (hasSpoken) {
          if (!silenceStartTime) {
            silenceStartTime = Date.now();
          } else if (Date.now() - silenceStartTime > 1400) {
            // User paused speaking for 1.4 seconds -> automatically conclude and transcribe!
            clearInterval(vadInterval);
            vadInterval = null;
            stopRecording();
          }
        } else if (!hasSpoken && Date.now() - recordingStartTime > 6000) {
          // If no speech detected within 6 seconds, stop to prevent background noise accumulation
          clearInterval(vadInterval);
          vadInterval = null;
          stopRecording();
        }
      }, 100);
    } catch (err) {
      console.warn("[VoiceRecorder] VAD setup skipped:", err);
    }
  }

  function cleanupAudio() {
    isRecording = false;
    if (recordingTimeout) {
      clearTimeout(recordingTimeout);
      recordingTimeout = null;
    }
    if (vadInterval) {
      clearInterval(vadInterval);
      vadInterval = null;
    }
    if (audioContext) {
      try {
        audioContext.close();
      } catch (_) {}
      audioContext = null;
    }
    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach((track) => track.stop());
      } catch (_) {}
      mediaStream = null;
    }
    if (micButton) micButton.classList.remove("is-listening");
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch (_) {}
    }
    cleanupAudio();
  }

  // Bind click listener on microphone button
  if (micButton) {
    micButton.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (isRecording) {
          stopRecording();
        } else {
          startRecording();
        }
      },
      true
    );
  }

  // Auto-recording trigger from main process (e.g. when user says "Hey Bheduu")
  if (window.voiceAPI?.onStartRecord) {
    window.voiceAPI.onStartRecord(() => {
      startRecording();
    });
  }

  // Global custom event
  window.addEventListener("voice-start-record", () => {
    startRecording();
  });

  window.startVoiceRecording = startRecording;
})();
