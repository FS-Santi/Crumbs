const crumbsFace =
  document.querySelector("#crumbs");

const mouth =
  document.querySelector("#mouth");

const moodLabel =
  document.querySelector("#mood-label");

const startHint =
  document.querySelector("#start-hint");

const settingsOverlay =
  document.querySelector("#settings-overlay");

const settingsClose =
  document.querySelector("#settings-close");

const settingsNote =
  document.querySelector("#settings-note");

const micMeter =
  document.querySelector("#mic-meter");

const micMeterTrack =
  document.querySelector("#mic-meter-track");

const micMeterFill =
  document.querySelector("#mic-meter-fill");

const micMeterStatus =
  document.querySelector("#mic-meter-status");

const micMeterReadout =
  document.querySelector("#mic-meter-readout");

const wakewordInputStatus =
  document.querySelector("#wakeword-input-status");

const designOptions =
  document.querySelectorAll("[data-design-select]");

let lastMicMeterUpdate = 0;
let micMeterTimer = null;

function setMicMeterStatus(state, label) {
  if (!micMeter || !micMeterStatus) return;

  micMeter.dataset.state = state;
  micMeterStatus.textContent = label;
}

function updateMicMeter(rms, now) {
  if (
    !micMeterTrack ||
    !micMeterFill ||
    !micMeterReadout ||
    now - lastMicMeterUpdate < 100
  ) {
    return;
  }

  lastMicMeterUpdate = now;
  const dbfs = rms > 0 ? Math.max(-80, 20 * Math.log10(rms)) : -80;
  const level = Math.max(0, Math.min(100, ((dbfs + 60) / 48) * 100));
  const hasSignal = dbfs > -48;

  micMeterFill.style.transform = `scaleX(${level / 100})`;
  micMeterTrack.setAttribute("aria-valuenow", String(Math.round(level)));
  micMeterTrack.setAttribute("aria-valuetext", `${Math.round(dbfs)} dBFS`);
  micMeterReadout.textContent = `${Math.round(dbfs)} dBFS`;
  setMicMeterStatus(
    hasSignal ? "signal" : "quiet",
    hasSignal ? "Signal detected" : "Very quiet or no signal"
  );
}

function startMicMeter(analyser) {
  if (micMeterTimer !== null) {
    clearTimeout(micMeterTimer);
  }

  const samples = new Float32Array(analyser.fftSize);

  function sampleMicLevel() {
    analyser.getFloatTimeDomainData(samples);

    let sum = 0;
    for (const sample of samples) {
      sum += sample * sample;
    }

    updateMicMeter(Math.sqrt(sum / samples.length), performance.now());
    micMeterTimer = setTimeout(sampleMicLevel, 100);
  }

  sampleMicLevel();
}

const moodDescriptions = {
  idle: "Ready when you are",
  starting: "Waking up my tiny brain...",
  connecting: "Tuning my toaster circuits...",
  calibrating: "Shh. I am listening to the room.",
  sleeping: "Sleeping. Say Crumbs to wake me.",
  awake: "I am awake. Go on, impress me.",
  listening: "I am all ears. Well, toaster ears.",
  thinking: "Let me toast on that...",
  speaking: "Talking your ear off.",
  interrupted: "Excuse you, I was talking.",
  error: "Well, that was embarrassing. Try again."
};

function setCrumbsMood(mood, detail = "") {
  if (!crumbsFace || !moodLabel) {
    return;
  }

  crumbsFace.dataset.mood = mood;
  crumbsFace.setAttribute(
    "aria-label",
    `Crumbs is ${mood === "idle" ? "ready" : mood}`
  );
  moodLabel.textContent =
    detail || moodDescriptions[mood] || moodDescriptions.awake;
}

function setFaceDesign(design) {
  const selectedDesign =
    design === "minimal" ? "minimal" : "toaster";

  crumbsFace.dataset.design = selectedDesign;

  for (const option of designOptions) {
    const selected =
      option.dataset.designSelect === selectedDesign;

    option.setAttribute("aria-pressed", String(selected));
  }

  try {
    localStorage.setItem("crumbs-face-design", selectedDesign);
  } catch (error) {
    console.warn("Could not save Crumbs's face style", error);
  }
}

let mouthTimeline = [];
let lipSyncFrame = null;
let alignmentWarningShown = false;

function setMouthViseme(shape) {
  if (mouth) {
    mouth.dataset.viseme = shape;
  }
}

function getVisemeForCharacter(characters, index) {
  const letter = (characters[index] || "").toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const nextLetter = (characters[index + 1] || "").toLowerCase();
  const pair = `${letter}${nextLetter}`;
  const previousPair = `${(characters[index - 1] || "").toLowerCase()}${letter}`;

  if (["th", "ph"].includes(pair)) return "teeth";
  if (["sh", "ch", "zh"].includes(pair)) return "soft";
  if (["wh", "oo", "ou", "ew"].includes(pair)) return "round";
  if (["ee", "ea", "ie", "ei", "ay", "ey"].includes(pair)) return "wide";
  if (["ow", "oi", "oy"].includes(pair)) return "open";
  if (["ow", "oi", "oy"].includes(previousPair)) return "round";

  if (!/[a-z]/.test(letter)) return "rest";
  if (/[mbp]/.test(letter)) return "closed";
  if (/[fv]/.test(letter)) return "teeth";
  if (/[ouqw]/.test(letter)) return "round";
  if (letter === "a") return "open";
  if (/[eiy]/.test(letter)) return "wide";
  if (/[rl]/.test(letter)) return "small";
  return "soft";
}

function queueMouthAlignment(alignment, audioStartTime, myGeneration) {
  if (!alignment || !Number.isFinite(audioStartTime)) return 0;

  const characters = alignment.chars || alignment.characters || [];
  const starts = alignment.char_start_times_ms || alignment.charStartTimesMs ||
    alignment.character_start_times_ms || alignment.characterStartTimesMs || [];
  const durations = alignment.char_durations_ms || alignment.charDurationsMs || alignment.chars_durations_ms ||
    alignment.character_durations_ms || alignment.characterDurationsMs || [];
  const ends = alignment.char_end_times_ms || alignment.charEndTimesMs ||
    alignment.character_end_times_ms || alignment.characterEndTimesMs || [];
  let queuedCount = 0;

  for (let index = 0; index < characters.length; index++) {
    const startMs = Number(starts[index]);
    if (!Number.isFinite(startMs)) continue;

    const nextStartMs = Number(starts[index + 1]);
    const durationMs = Number(durations[index]);
    const endMs = Number(ends[index]);
    const fallbackEndMs = Number.isFinite(nextStartMs)
      ? nextStartMs
      : startMs + 80;
    const finishMs = Number.isFinite(endMs)
      ? endMs
      : startMs + (Number.isFinite(durationMs) ? durationMs : Math.max(45, fallbackEndMs - startMs));

    mouthTimeline.push({
      start: audioStartTime + startMs / 1000,
      end: audioStartTime + Math.max(startMs + 25, finishMs) / 1000,
      shape: getVisemeForCharacter(characters, index)
    });
    queuedCount++;
  }

  if (queuedCount === 0) return 0;

  mouthTimeline.sort((a, b) => a.start - b.start);

  if (lipSyncFrame === null) {
    lipSyncFrame = requestAnimationFrame(() => updateMouthSync(myGeneration));
  }

  return queuedCount;
}

function updateMouthSync(myGeneration) {
  lipSyncFrame = null;

  if (myGeneration !== generationId || !busy) {
    setMouthViseme("rest");
    return;
  }

  const now = getAudibleAudioTime();
  let activeShape = "rest";

  for (const cue of mouthTimeline) {
    if (cue.start > now) break;
    if (cue.end >= now) activeShape = cue.shape;
  }

  setMouthViseme(activeShape);
  lipSyncFrame = requestAnimationFrame(() => updateMouthSync(myGeneration));
}

function getAudibleAudioTime() {
  if (!audioContext) return 0;

  if (typeof audioContext.getOutputTimestamp === "function") {
    const timestamp = audioContext.getOutputTimestamp();

    if (timestamp.performanceTime > 0) {
      // Compare the face against the sample reaching the audio output,
      // instead of the render clock, which can run ahead of speaker playback.
      const elapsed = Math.max(0, performance.now() - timestamp.performanceTime) / 1000;
      return timestamp.contextTime + elapsed;
    }
  }

  const outputDelay =
    (audioContext.baseLatency || 0) +
    (audioContext.outputLatency || 0);

  return audioContext.currentTime - outputDelay;
}

function resetMouthSync() {
  if (lipSyncFrame !== null) {
    cancelAnimationFrame(lipSyncFrame);
    lipSyncFrame = null;
  }

  mouthTimeline = [];
  setMouthViseme("rest");
}

for (const option of designOptions) {
  option.addEventListener("click", () => {
    setFaceDesign(option.dataset.designSelect);
    closeSettings();
  });
}

function openSettings() {
  settingsOverlay.hidden = false;
  settingsOverlay.setAttribute("aria-hidden", "false");
  settingsClose.focus({ preventScroll: true });
}

function closeSettings() {
  settingsOverlay.hidden = true;
  settingsOverlay.setAttribute("aria-hidden", "true");
}

function tappedCenterOfFace(event) {
  const face = crumbsFace.querySelector(".face");
  if (!face) return false;

  const bounds = face.getBoundingClientRect();
  const insetX = bounds.width * 0.15;
  const insetY = bounds.height * 0.1;

  return event.clientX >= bounds.left + insetX &&
    event.clientX <= bounds.right - insetX &&
    event.clientY >= bounds.top + insetY &&
    event.clientY <= bounds.bottom - insetY;
}

settingsClose.addEventListener("click", closeSettings);

settingsOverlay.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) {
    closeSettings();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsOverlay.hidden) {
    closeSettings();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!settingsOverlay.hidden) return;

  if (tappedCenterOfFace(event)) {
    openSettings();
  }

  if (audioContext?.state === "suspended") {
    audioContext.resume().catch((error) => {
      console.warn("Audio output is still waiting for browser permission", error);
    });
  }

  if (!listening && !starting) {
    startCrumbs();
  }
});

try {
  setFaceDesign(localStorage.getItem("crumbs-face-design") || "toaster");
} catch {
  setFaceDesign("toaster");
}


let listening = false;
let starting = false;
let busy = false;


let audioContext = null;
let micStream = null;
let micProcessor = null;
let silentGain = null;


// ============================================================
// GPT / TTS STATE
// ============================================================

let currentGenerationController =
  null;

let ttsSocket = null;

let nextAudioTime = 0;

let activeAudioSources =
  new Set();

let finishTimer = null;

let bargeInStarted = null;

let generationId = 0;


// ============================================================
// REALTIME TRANSCRIPTION STATE
// ============================================================

let sttSocket = null;

let sttReady = false;

let sttConnectPromise = null;

let sttStreaming = false;

let sttPartial = "";


// ============================================================
// LOCAL WAKE WORD STATE
// ============================================================

let wakeSocket = null;

let wakeReady = false;

let wakeConnectPromise = null;

let wakeSampleRate =
  16000;

let awake = false;

let awakeTimer = null;


// ============================================================
// USER SPEECH STATE
// ============================================================

let userRecording =
  false;

let recordingStarted =
  0;

let silenceStarted =
  null;


// ============================================================
// SETTINGS
// ============================================================

const SILENCE_MS =
  1100;

const MIN_RECORDING_MS =
  350;

const MAX_RECORDING_MS =
  30000;

const BARGE_IN_MS =
  180;

const STT_SAMPLE_RATE =
  24000;

// Give the user time to begin speaking after the wake word.
const AWAKE_TIMEOUT_MS =
  15000;

function handleMicAudioFrame(input) {
  // --------------------------------------------------------
  // SLEEPING: local Sherpa only. Nothing from the room is sent to OpenAI.
  // --------------------------------------------------------
  if (
    !awake &&
    wakeReady &&
    wakeSocket &&
    wakeSocket.readyState === WebSocket.OPEN
  ) {
    const wakePCM = resampleToPCM16(
      input,
      audioContext.sampleRate,
      wakeSampleRate
    );

    wakeSocket.send(wakePCM.buffer);
  }

  // --------------------------------------------------------
  // AWAKE + ACTUALLY RECORDING USER: OpenAI realtime STT.
  // --------------------------------------------------------
  if (
    sttStreaming &&
    sttReady &&
    sttSocket &&
    sttSocket.readyState === WebSocket.OPEN
  ) {
    const sttPCM = resampleToPCM16(
      input,
      audioContext.sampleRate,
      STT_SAMPLE_RATE
    );

    sttSocket.send(sttPCM.buffer);
  }
}


// ============================================================
// START CRUMBS
// ============================================================

async function startCrumbs() {
  if (listening || starting) {
    return;
  }

  starting = true;
  micProcessor = null;
  silentGain = null;

    try {
      setCrumbsMood("starting");
      setMicMeterStatus("waiting", "Starting mic…");
      settingsNote.textContent = "Starting Crumbs...";

      audioContext =
        new AudioContext();

      audioContext.resume().catch((error) => {
        console.warn("Audio output needs a screen touch to unlock", error);
      });

      micStream =
        await navigator.mediaDevices
          .getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });

      setMicMeterStatus("ready", "Mic opened — speak to test");

      // Acquiring the mic can unlock Web Audio in browser kiosk sessions.
      // If autoplay policy still suspends it, the screen-touch handler retries.
      await audioContext.resume();

      const source =
        audioContext
          .createMediaStreamSource(
            micStream
          );

      const analyser =
        audioContext
          .createAnalyser();

      analyser.fftSize =
        1024;

      source.connect(
        analyser
      );

      startMicMeter(analyser);

      const samples =
        new Float32Array(
          analyser.fftSize
        );


      // ======================================================
      // ONE MIC PIPELINE
      //
      // ASLEEP:
      //   -> local Sherpa wake-word engine
      //
      // AWAKE + USER TALKING:
      //   -> OpenAI realtime STT
      // ======================================================

      silentGain =
        audioContext
          .createGain();

      silentGain.gain.value =
        0;

      micProcessor = audioContext.createScriptProcessor(2048, 1, 1);
      micProcessor.onaudioprocess = (event) => {
        handleMicAudioFrame(event.inputBuffer.getChannelData(0));
      };
      source.connect(micProcessor);
      micProcessor.connect(silentGain);
      console.log("Microphone capture: ScriptProcessor (known-good path)");

      silentGain.connect(audioContext.destination);


      // ======================================================
      // CONNECT WAKE WORD + STT
      // ======================================================

      setCrumbsMood("connecting");

      await Promise.all([
        connectWakeWord(),
        connectRealtimeSTT()
      ]);


      // ======================================================
      // CALIBRATE ROOM
      // ======================================================

      setCrumbsMood("calibrating");

      const noiseFloor =
        await measureNoise(
          analyser,
          samples
        );

      const threshold =
        Math.max(
          noiseFloor * 2.5,
          0.012
        );

      console.log(
        "Noise floor:",
        noiseFloor
      );

      console.log(
        "Threshold:",
        threshold
      );

      listening =
        true;

      startHint.textContent =
        "Tap Crumbs for settings";

      settingsNote.textContent =
        "Speak near the Jabra; the meter shows the microphone signal reaching Chromium.";

      goToSleep();


      // ======================================================
      // LOCAL VAD LOOP
      // ======================================================

      function detectSpeech() {
        analyser
          .getFloatTimeDomainData(
            samples
          );

        let sum = 0;

        for (
          const sample
          of samples
        ) {
          sum +=
            sample *
            sample;
        }

        const rms =
          Math.sqrt(
            sum /
            samples.length
          );

        const now =
          performance.now();


        // ----------------------------------------------------
        // SLEEPING
        // Porcupine/Sherpa wake engine owns this state.
        // ----------------------------------------------------

        if (!awake) {
          requestAnimationFrame(
            detectSpeech
          );

          return;
        }


        // ----------------------------------------------------
        // CRUMBS THINKING / TALKING
        // ----------------------------------------------------

        if (busy) {
          const outputPlaying =
            activeAudioSources.size >
            0;

          const bargeThreshold =
            outputPlaying
              ? threshold *
                1.8
              : threshold;

          if (
            rms >
            bargeThreshold
          ) {
            if (
              bargeInStarted ===
              null
            ) {
              bargeInStarted =
                now;
            }

            if (
              now -
              bargeInStarted >=
              BARGE_IN_MS
            ) {
              bargeInStarted =
                null;

              interruptCrumb();
            }
          } else {
            bargeInStarted =
              null;
          }
        }


        // ----------------------------------------------------
        // AWAKE AND WAITING FOR USER
        // ----------------------------------------------------

        else if (
          !userRecording
        ) {
          if (
            sttReady &&
            rms > threshold
          ) {
            startRecording();
          }
        }


        // ----------------------------------------------------
        // USER IS TALKING
        // ----------------------------------------------------

        else {
          if (
            rms > threshold
          ) {
            silenceStarted =
              null;
          } else {
            if (
              silenceStarted ===
              null
            ) {
              silenceStarted =
                now;
            }

            const silentFor =
              now -
              silenceStarted;

            const recordedFor =
              now -
              recordingStarted;

            if (
              silentFor >=
                SILENCE_MS &&

              recordedFor >=
                MIN_RECORDING_MS
            ) {
              stopRecording();
            }
          }

          if (
            now -
            recordingStarted >=
            MAX_RECORDING_MS
          ) {
            stopRecording();
          }
        }


        requestAnimationFrame(
          detectSpeech
        );
      }


      detectSpeech();

    } catch (error) {
      console.error(
        error
      );

      if (micMeterTimer !== null) {
        clearTimeout(micMeterTimer);
        micMeterTimer = null;
      }

      if (micStream) {
        for (const track of micStream.getTracks()) {
          track.stop();
        }
        micStream = null;
      }

      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(() => {});
      }
      audioContext = null;

      startHint.textContent =
        "Tap Crumbs to retry";

      settingsNote.textContent =
        "Microphone startup failed. Check browser microphone permission, then tap Crumbs to retry.";

      setCrumbsMood("error", "I could not start listening. Tap Crumbs to try again.");
      setMicMeterStatus("error", "Audio startup failed");
    } finally {
      starting = false;
    }
}


// ============================================================
// WAKE / SLEEP
// ============================================================

function wakeUp() {
  if (awake) {
    return;
  }

  awake =
    true;

  setCrumbsMood("awake");

  resetAwakeTimer();

  console.log(
    "👀 Crumbs is awake"
  );

}


function goToSleep() {
  if (
    busy ||
    userRecording
  ) {
    resetAwakeTimer();

    return;
  }

  awake =
    false;

  sttStreaming =
    false;

  sttPartial =
    "";

  if (
    awakeTimer
  ) {
    clearTimeout(
      awakeTimer
    );

    awakeTimer =
      null;
  }

  if (
    sttSocket &&

    sttSocket.readyState ===
      WebSocket.OPEN
  ) {
    try {
      sttSocket.send(
        JSON.stringify({
          type: "clear"
        })
      );
    } catch {}
  }

  setCrumbsMood("sleeping");

  console.log(
    "Crumbs is sleeping"
  );
}


function resetAwakeTimer() {
  if (
    awakeTimer
  ) {
    clearTimeout(
      awakeTimer
    );
  }

  awakeTimer =
    setTimeout(
      () => {
        if (
          busy ||
          userRecording
        ) {
          resetAwakeTimer();

          return;
        }

        goToSleep();
      },

      AWAKE_TIMEOUT_MS
    );
}


// ============================================================
// START USER SPEECH
// ============================================================

function startRecording() {
  if (
    !awake ||

    busy ||

    userRecording ||

    !sttReady ||

    !sttSocket ||

    sttSocket.readyState !==
      WebSocket.OPEN
  ) {
    return;
  }

  console.log(
    "🎤 Speech detected"
  );

  userRecording =
    true;

  sttStreaming =
    true;

  sttPartial =
    "";

  sttSocket.send(
    JSON.stringify({
      type: "clear"
    })
  );

  recordingStarted =
    performance.now();

  silenceStarted =
    null;

  resetAwakeTimer();

  setCrumbsMood("listening");
}


// ============================================================
// STOP USER SPEECH
// ============================================================

function stopRecording() {
  if (
    !userRecording
  ) {
    return;
  }

  console.log(
    "🛑 You stopped talking"
  );

  userRecording =
    false;

  sttStreaming =
    false;

  busy =
    true;

  if (
    sttSocket &&

    sttSocket.readyState ===
      WebSocket.OPEN
  ) {
    sttSocket.send(
      JSON.stringify({
        type: "commit"
      })
    );
  }

  setCrumbsMood("thinking");
}


// ============================================================
// BARGE IN
// ============================================================

function interruptCrumb() {
  console.log(
    "✋ INTERRUPTED CRUMB"
  );

  stopCurrentResponse();
  startRecording();
}


// ============================================================
// ROOM CALIBRATION
// ============================================================

async function measureNoise(
  analyser,
  samples
) {
  const measurements =
    [];

  const start =
    performance.now();

  while (
    performance.now() -
    start <
    1000
  ) {
    analyser
      .getFloatTimeDomainData(
        samples
      );

    let sum = 0;

    for (
      const sample
      of samples
    ) {
      sum +=
        sample *
        sample;
    }

    measurements.push(
      Math.sqrt(
        sum /
        samples.length
      )
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          50
        )
    );
  }

  return (
    measurements.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    measurements.length
  );
}


// ============================================================
// CONNECT LOCAL SHERPA WAKE WORD
// ============================================================

function connectWakeWord() {
  if (
    wakeReady &&

    wakeSocket &&

    wakeSocket.readyState ===
      WebSocket.OPEN
  ) {
    return Promise.resolve();
  }

  if (
    wakeConnectPromise
  ) {
    return wakeConnectPromise;
  }

  wakeConnectPromise =
    new Promise(
      (
        resolve,
        reject
      ) => {
        const protocol =
          location.protocol ===
          "https:"
            ? "wss"
            : "ws";

        const socket =
          new WebSocket(
            `${protocol}://${location.host}/wake-word`
          );

        wakeSocket =
          socket;

        wakeReady =
          false;

        let settled =
          false;

        const timeout =
          setTimeout(
            () => {
              if (
                settled
              ) {
                return;
              }

              settled =
                true;

              wakeConnectPromise =
                null;

              try {
                socket.close();
              } catch {}

              reject(
                new Error(
                  "Wake-word connection timed out"
                )
              );
            },

            120000
          );


        socket.onmessage =
          (event) => {
            let data;

            try {
              data =
                JSON.parse(
                  event.data
                );
            } catch (error) {
              console.error(
                "Bad wake-word message:",
                error
              );

              return;
            }


            if (
              data.type ===
              "config"
            ) {
              wakeSampleRate =
                data.sampleRate;

              wakeReady =
                true;

              console.log(
                "👂 Local wake word ready:",
                data.sampleRate,
                "Hz"
              );

              if (wakewordInputStatus) {
                wakewordInputStatus.textContent =
                  "Wake engine connected; waiting for audio";
              }

              if (
                !settled
              ) {
                settled =
                  true;

                clearTimeout(
                  timeout
                );

                wakeConnectPromise =
                  null;

                resolve();
              }

              return;
            }


            if (
              data.type ===
              "audio-level"
            ) {
              if (wakewordInputStatus) {
                const rms = Number(data.rmsDbfs);
                const peak = Number(data.peakDbfs);
                if (Number.isFinite(rms)) {
                  updateMicMeter(Math.pow(10, rms / 20), performance.now());
                }
                wakewordInputStatus.textContent =
                  Number.isFinite(rms) && Number.isFinite(peak)
                    ? `Sherpa input: ${Math.round(rms)} dBFS RMS, ${Math.round(peak)} dBFS peak`
                    : "Sherpa is receiving audio";
              }

              return;
            }


            if (
              data.type ===
              "wake"
            ) {
              console.log(
                "👀 WAKE WORD:",
                data.label
              );

              wakeUp();

              return;
            }


            if (
              data.type ===
              "error"
            ) {
              console.error(
                "Wake-word error:",
                data.error
              );

              if (wakewordInputStatus) {
                wakewordInputStatus.textContent = "Wake engine error";
              }

              if (
                !settled
              ) {
                settled =
                  true;

                clearTimeout(
                  timeout
                );

                wakeConnectPromise =
                  null;

                reject(
                  new Error(
                    data.error
                  )
                );
              }
            }
          };


        socket.onerror =
          () => {
            if (
              !settled
            ) {
              settled =
                true;

              clearTimeout(
                timeout
              );

              wakeConnectPromise =
                null;

              reject(
                new Error(
                  "Could not connect wake-word engine"
                )
              );
            }
          };


        socket.onclose =
          () => {
            wakeReady =
              false;

            if (wakewordInputStatus) {
              wakewordInputStatus.textContent = "Wake engine disconnected";
            }

            if (
              wakeSocket ===
              socket
            ) {
              wakeSocket =
                null;
            }

            if (
              !settled
            ) {
              settled =
                true;

              clearTimeout(
                timeout
              );

              wakeConnectPromise =
                null;

              reject(
                new Error(
                  "Wake-word socket closed"
                )
              );

              return;
            }

            if (
              listening
            ) {
              console.warn(
                "👂 Wake word disconnected. Reconnecting..."
              );

              setTimeout(
                () => {
                  connectWakeWord()
                    .catch(
                      error => {
                        console.error(
                          "Wake-word reconnect failed:",
                          error
                        );
                      }
                    );
                },

                1000
              );
            }
          };
      }
    );

  return wakeConnectPromise;
}


// ============================================================
// CONNECT REALTIME STT
// ============================================================

function connectRealtimeSTT() {
  if (
    sttReady &&

    sttSocket &&

    sttSocket.readyState ===
      WebSocket.OPEN
  ) {
    return Promise.resolve();
  }

  if (
    sttConnectPromise
  ) {
    return sttConnectPromise;
  }

  sttConnectPromise =
    new Promise(
      (
        resolve,
        reject
      ) => {
        const protocol =
          location.protocol ===
          "https:"
            ? "wss"
            : "ws";

        const socket =
          new WebSocket(
            `${protocol}://${location.host}/realtime-transcribe`
          );

        sttSocket =
          socket;

        sttReady =
          false;

        let settled =
          false;

        const timeout =
          setTimeout(
            () => {
              if (
                settled
              ) {
                return;
              }

              settled =
                true;

              sttConnectPromise =
                null;

              try {
                socket.close();
              } catch {}

              reject(
                new Error(
                  "Realtime transcription connection timed out"
                )
              );
            },

            10000
          );


        socket.onmessage =
          (event) => {
            let data;

            try {
              data =
                JSON.parse(
                  event.data
                );
            } catch (error) {
              console.error(
                "Bad STT message:",
                error
              );

              return;
            }


            if (
              data.type ===
              "ready"
            ) {
              sttReady =
                true;

              console.log(
                "🎙️ Realtime STT ready in browser"
              );

              if (
                !settled
              ) {
                settled =
                  true;

                clearTimeout(
                  timeout
                );

                sttConnectPromise =
                  null;

                resolve();
              }

              return;
            }


            if (
              data.type ===
              "transcript-delta"
            ) {
              sttPartial +=
                data.delta ||
                "";

              console.log(
                "STT DELTA:",
                data.delta
              );

              return;
            }


            if (
              data.type ===
              "transcript-complete"
            ) {
              const text =
                (
                  data.text ||
                  ""
                ).trim();

              console.log(
                "STT FINAL:",
                text
              );

              handleFinalTranscript(
                text
              );

              return;
            }


            if (
              data.type ===
              "error"
            ) {
              console.error(
                "Realtime STT error:",
                data.error
              );

              sttStreaming =
                false;

              userRecording =
                false;

              busy =
                false;

              setCrumbsMood(awake ? "awake" : "sleeping");
            }
          };


        socket.onerror =
          () => {
            if (
              !settled
            ) {
              settled =
                true;

              clearTimeout(
                timeout
              );

              sttConnectPromise =
                null;

              reject(
                new Error(
                  "Could not connect realtime transcription"
                )
              );
            }
          };


        socket.onclose =
          () => {
            sttReady =
              false;

            sttStreaming =
              false;

            if (
              sttSocket ===
              socket
            ) {
              sttSocket =
                null;
            }

            if (
              !settled
            ) {
              settled =
                true;

              clearTimeout(
                timeout
              );

              sttConnectPromise =
                null;

              reject(
                new Error(
                  "Realtime transcription socket closed"
                )
              );

              return;
            }

            if (
              listening
            ) {
              console.warn(
                "🎙️ STT disconnected. Reconnecting..."
              );

              setTimeout(
                () => {
                  connectRealtimeSTT()
                    .then(
                      () => {
                        if (
                          !busy
                        ) {
                          setCrumbsMood(awake ? "awake" : "sleeping");
                        }
                      }
                    )
                    .catch(
                      error => {
                        console.error(
                          "STT reconnect failed:",
                          error
                        );
                      }
                    );
                },

                1000
              );
            }
          };
      }
    );

  return sttConnectPromise;
}


// ============================================================
// RESAMPLE MIC TO PCM16 MONO
// ============================================================

function resampleToPCM16(
  input,
  inputSampleRate,
  outputSampleRate
) {
  if (
    inputSampleRate ===
    outputSampleRate
  ) {
    const output =
      new Int16Array(
        input.length
      );

    for (
      let i = 0;
      i < input.length;
      i++
    ) {
      const sample =
        Math.max(
          -1,
          Math.min(
            1,
            input[i]
          )
        );

      output[i] =
        sample < 0
          ? sample *
            0x8000
          : sample *
            0x7fff;
    }

    return output;
  }

  const ratio =
    inputSampleRate /
    outputSampleRate;

  const outputLength =
    Math.floor(
      input.length /
      ratio
    );

  const output =
    new Int16Array(
      outputLength
    );

  for (
    let i = 0;
    i < outputLength;
    i++
  ) {
    const sourcePosition =
      i * ratio;

    const leftIndex =
      Math.floor(
        sourcePosition
      );

    const rightIndex =
      Math.min(
        leftIndex + 1,
        input.length - 1
      );

    const fraction =
      sourcePosition -
      leftIndex;

    const sample =
      input[leftIndex] *
        (
          1 -
          fraction
        ) +
      input[rightIndex] *
        fraction;

    const clamped =
      Math.max(
        -1,
        Math.min(
          1,
          sample
        )
      );

    output[i] =
      clamped < 0
        ? clamped *
          0x8000
        : clamped *
          0x7fff;
  }

  return output;
}


// ============================================================
// FINAL TRANSCRIPT -> GPT
// ============================================================

function handleFinalTranscript(
  rawText
) {
  sttPartial =
    "";

  let text =
    (
      rawText ||
      ""
    ).trim();


  // If STT caught the end of the wake phrase too,
  // remove only a LEADING "Crumbs".
  text =
    text.replace(
      /^crumbs[\s,.:;!?-]*/i,
      ""
    ).trim();


  if (!text) {
    console.log(
      "Ignored empty transcript"
    );

    busy =
      false;

    resetAwakeTimer();

    setCrumbsMood("awake");

    return;
  }

  console.log(
    "YOU:",
    text
  );

  resetAwakeTimer();

  processTranscript(
    text
  );
}


// ============================================================
// GPT + ELEVENLABS
// ============================================================

async function processTranscript(
  userText
) {
  const myGeneration =
    ++generationId;

  resetMouthSync();
  alignmentWarningShown = false;
  setCrumbsMood("thinking");

  try {
    currentGenerationController =
      new AbortController();

    const gptPromise =
      fetch(
        "/respond-stream",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              text:
                userText
            }),

          signal:
            currentGenerationController
              .signal
        }
      );

    const ttsPromise =
      createCrumbVoiceStream(
        myGeneration
      );

    const [
      gptResponse,
      socket
    ] =
      await Promise.all([
        gptPromise,
        ttsPromise
      ]);

    if (
      myGeneration !==
      generationId
    ) {
      socket.close();

      return;
    }

    if (
      !gptResponse.ok
    ) {
      throw new Error(
        "GPT streaming request failed"
      );
    }

    ttsSocket =
      socket;

    nextAudioTime =
      audioContext
        .currentTime;

    const reader =
      gptResponse.body
        .getReader();

    const decoder =
      new TextDecoder();

    let networkBuffer =
      "";

    let fullReply =
      "";

    let sentTTSEnd =
      false;

    while (true) {
      const {
        value,
        done
      } =
        await reader.read();

      if (done) {
        break;
      }

      if (
        myGeneration !==
        generationId
      ) {
        return;
      }

      networkBuffer +=
        decoder.decode(
          value,
          {
            stream:
              true
          }
        );

      const lines =
        networkBuffer
          .split("\n");

      networkBuffer =
        lines.pop();

      for (
        const line
        of lines
      ) {
        if (
          !line.trim()
        ) {
          continue;
        }

        const event =
          JSON.parse(
            line
          );

        if (
          event.type ===
          "delta"
        ) {
          fullReply +=
            event.delta;

          console.log(
            "GPT DELTA:",
            event.delta
          );

          if (
            socket.readyState ===
            WebSocket.OPEN
          ) {
            socket.send(
              JSON.stringify({
                text:
                  event.delta
              })
            );
          }
        }

        if (
          event.type ===
          "done"
        ) {
          console.log(
            "CRUMB:",
            fullReply
          );

          if (
            socket.readyState ===
            WebSocket.OPEN
          ) {
            socket.send(
              JSON.stringify({
                text: ""
              })
            );

            sentTTSEnd =
              true;
          }
        }

        if (
          event.type ===
          "error"
        ) {
          throw new Error(
            event.error ||
            "GPT stream error"
          );
        }
      }
    }

    if (
      !sentTTSEnd &&

      socket.readyState ===
        WebSocket.OPEN
    ) {
      socket.send(
        JSON.stringify({
          text: ""
        })
      );
    }

    currentGenerationController =
      null;

  } catch (error) {
    if (
      error.name ===
      "AbortError"
    ) {
      return;
    }

    console.error(
      error
    );

    if (
      myGeneration ===
      generationId
    ) {
      stopCurrentResponse();

      setCrumbsMood(awake ? "awake" : "sleeping");
    }
  }
}


// ============================================================
// CREATE ELEVENLABS TTS WEBSOCKET
// ============================================================

async function createCrumbVoiceStream(
  myGeneration
) {
  const tokenResponse =
    await fetch(
      "/elevenlabs-tts-token"
    );

  if (
    !tokenResponse.ok
  ) {
    throw new Error(
      "Could not get ElevenLabs token"
    );
  }

  const {
    token,
    voiceId
  } =
    await tokenResponse.json();

  const params =
    new URLSearchParams({
      model_id:
        "eleven_flash_v2_5",

      output_format:
        "pcm_24000",

      sync_alignment:
        "true",

      single_use_token:
        token,

      inactivity_timeout:
        "180",

      apply_text_normalization:
        "on"
    });

  const url =
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?${params}`;

  const socket =
    new WebSocket(
      url
    );

  await new Promise(
    (
      resolve,
      reject
    ) => {
      socket.addEventListener(
        "open",
        resolve,
        {
          once: true
        }
      );

      socket.addEventListener(
        "error",
        reject,
        {
          once: true
        }
      );
    }
  );

  if (
    myGeneration !==
    generationId
  ) {
    socket.close();

    throw new DOMException(
      "Interrupted",
      "AbortError"
    );
  }

  let receivedFinal =
    false;

  socket.onmessage =
    (event) => {
      if (
        myGeneration !==
        generationId
      ) {
        return;
      }

      const data =
        JSON.parse(
          event.data
        );

      let audioStartTime =
        nextAudioTime || audioContext.currentTime;

      if (
        data.audio
      ) {
        audioStartTime = playPCMChunk(
          data.audio,
          myGeneration
        );
      }

      const alignment =
        data.normalized_alignment || data.normalizedAlignment || data.alignment;

      if (alignment) {
        const alignedCharacters = queueMouthAlignment(
          alignment,
          audioStartTime,
          myGeneration
        );

        if (alignedCharacters === 0) {
          console.warn("ElevenLabs returned alignment without usable character timings", alignment);
        }
      } else if (data.audio && !alignmentWarningShown) {
        alignmentWarningShown = true;
        console.warn("ElevenLabs audio chunk arrived without alignment; check sync_alignment in the stream URL");
      }

      if (
        data.is_final
      ) {
        receivedFinal =
          true;

        console.log(
          "🔊 ElevenLabs finished"
        );

        scheduleResponseFinished(
          myGeneration
        );
      }
    };

  socket.onerror =
    (error) => {
      console.error(
        "ElevenLabs WebSocket error:",
        error
      );
    };

  socket.onclose =
    () => {
      if (
        ttsSocket ===
        socket
      ) {
        ttsSocket =
          null;
      }

      if (
        !receivedFinal &&

        myGeneration ===
          generationId
      ) {
        console.warn(
          "ElevenLabs closed before final audio"
        );

        scheduleResponseFinished(
          myGeneration
        );
      }
    };


  // Correct ElevenLabs initialization:
  // ONE SPACE, not the GPT delta here.
  socket.send(
    JSON.stringify({
      text: " ",

      voice_settings: {
        stability:
          0.45,

        similarity_boost:
          0.8,

        speed:
          1.0
      }
    })
  );

  return socket;
}


// ============================================================
// PLAY RAW ELEVENLABS PCM
// ============================================================

function playPCMChunk(
  base64Audio,
  myGeneration
) {
  if (
    myGeneration !==
    generationId
  ) {
    return;
  }

  setCrumbsMood("speaking");

  const binary =
    atob(
      base64Audio
    );

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let i = 0;
    i <
      binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(
        i
      );
  }

  const sampleCount =
    Math.floor(
      bytes.length /
      2
    );

  const audioBuffer =
    audioContext
      .createBuffer(
        1,
        sampleCount,
        24000
      );

  const channel =
    audioBuffer
      .getChannelData(
        0
      );

  const view =
    new DataView(
      bytes.buffer
    );

  for (
    let i = 0;
    i <
      sampleCount;
    i++
  ) {
    channel[i] =
      view.getInt16(
        i * 2,
        true
      ) /
      32768;
  }

  const source =
    audioContext
      .createBufferSource();

  source.buffer =
    audioBuffer;

  source.connect(
    audioContext.destination
  );

  const now =
    audioContext
      .currentTime;

  const startTime =
    Math.max(
      now + 0.02,
      nextAudioTime
    );

  source.start(
    startTime
  );

  nextAudioTime =
    startTime +
    audioBuffer.duration;

  activeAudioSources.add(
    source
  );

  source.onended =
    () => {
      activeAudioSources.delete(
        source
      );
    };

  return startTime;
}


// ============================================================
// WAIT UNTIL QUEUED AUDIO ACTUALLY FINISHES
// ============================================================

function scheduleResponseFinished(
  myGeneration
) {
  if (
    finishTimer
  ) {
    clearTimeout(
      finishTimer
    );
  }

  const remaining =
    Math.max(
      0,
      nextAudioTime -
      audioContext.currentTime
    );

  finishTimer =
    setTimeout(
      () => {
        if (
          myGeneration !==
          generationId
        ) {
          return;
        }

        busy =
          false;

        resetMouthSync();

        nextAudioTime =
          0;

        ttsSocket =
          null;

        if (awake) {
          resetAwakeTimer();

          setCrumbsMood("awake");
        } else {
          setCrumbsMood("sleeping");
        }

        console.log(
          "👂 Listening again"
        );
      },

      remaining *
        1000 +
        75
    );
}


// ============================================================
// CANCEL CURRENT CRUMBS RESPONSE
// ============================================================

function stopCurrentResponse() {
  generationId++;

  if (
    currentGenerationController
  ) {
    currentGenerationController
      .abort();

    currentGenerationController =
      null;
  }

  if (
    ttsSocket
  ) {
    try {
      ttsSocket.close();
    } catch {}

    ttsSocket =
      null;
  }

  for (
    const source
    of activeAudioSources
  ) {
    try {
      source.stop();
    } catch {}
  }

  activeAudioSources.clear();

  if (
    finishTimer
  ) {
    clearTimeout(
      finishTimer
    );

    finishTimer =
      null;
  }

  nextAudioTime =
    0;

  bargeInStarted =
    null;

  busy =
    false;

  resetMouthSync();

  if (awake) {
    resetAwakeTimer();

    setCrumbsMood("awake");
  } else {
    setCrumbsMood("sleeping");
  }
}

window.addEventListener("load", () => {
  startCrumbs();
}, { once: true });
