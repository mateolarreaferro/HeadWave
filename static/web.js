/*
  HeadWave in a browser, with no Python server behind it.

  The desktop app serves this same front end from main.py, which also owns the
  EEG headset, the camera, MIDI and OSC. A static web build loads this file
  first, and it answers what the server would: the page keeps calling
  /api/... and opening /ws/... exactly as before.

    EEG       the simulator, a port of src/simulator_service.py and
              src/band_analyzer.py. A real headset needs the desktop app.
    camera    the visitor's own webcam, tracked in the page with MediaPipe;
              a port of src/face_tracker.py, gaze_tracker.py, hand_tracker.py.
              No frame leaves the browser.
    AI        /api/ai/* is forwarded to window.HEADWAVE_API (the host's own
              endpoint), since that is the one thing a browser cannot do alone.
    MIDI, OSC, recording   desktop only; they answer "not available".

  Nothing in the rest of the front end knows which of the two it is talking to.
*/
(() => {
  const AI_BASE = window.HEADWAVE_API || "/api/headwave";
  const DESKTOP_ONLY = "This needs the HeadWave desktop app.";

  // ---------- EEG simulator ----------

  const RATE = 200;
  const CHANNELS = 4;
  const KEEP = RATE * 10;
  const BANDS = [["delta", 0.5, 4], ["theta", 4, 8], ["alpha", 8, 13], ["beta", 13, 30], ["gamma", 30, 40]];
  // Sample generation uses the simulator's own (wider) gamma range.
  const GEN = [[0.5, 4], [4, 8], [8, 13], [13, 30], [30, 50]];
  const MODES = {
    meditation: [10, 30, 40, 5, 2],
    focused: [3, 5, 10, 35, 8],
    drowsy: [40, 25, 15, 5, 2],
    normal: [8, 10, 20, 15, 5],
  };

  const eeg = {
    simulator: false, connected: false, streaming: false, mode: "normal",
    series: Array.from({ length: CHANNELS }, () => []),
    elapsed: 0, last: 0, timer: null,
    bandSmooth: Array.from({ length: CHANNELS }, () => null),
    engagementSmooth: null,
  };

  const uniform = (lo, hi) => lo + Math.random() * (hi - lo);
  const gaussian = (sd) => sd * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

  function sample(t, channel) {
    const amps = MODES[eeg.mode] || MODES.normal;
    const factor = 1 + 0.1 * channel;
    let v = gaussian(2) + 5 * Math.sin(2 * Math.PI * 0.1 * t);
    for (let b = 0; b < 5; b++) v += amps[b] * factor * Math.sin(2 * Math.PI * uniform(GEN[b][0], GEN[b][1]) * t);
    return v;
  }

  function generate() {
    const now = performance.now();
    // A throttled background tab catches up at most one second at a time.
    const due = Math.min(RATE, Math.floor(((now - eeg.last) / 1000) * RATE));
    if (due < 1) return;
    eeg.last += (due / RATE) * 1000;
    for (let i = 0; i < due; i++) {
      for (let ch = 0; ch < CHANNELS; ch++) eeg.series[ch].push(sample(eeg.elapsed, ch));
      eeg.elapsed += 1 / RATE;
    }
    for (const s of eeg.series) if (s.length > KEEP) s.splice(0, s.length - KEEP);
  }

  function startStream() {
    if (eeg.streaming) return;
    eeg.streaming = true;
    eeg.elapsed = 0;
    eeg.last = performance.now();
    eeg.series.forEach((s) => (s.length = 0));
    eeg.timer = setInterval(generate, 25);
  }

  function stopStream() {
    eeg.streaming = false;
    clearInterval(eeg.timer);
    eeg.timer = null;
  }

  const live = () => eeg.connected && eeg.streaming;
  const names = () => eeg.series.map((_, i) => `CH${i + 1}`);
  const tail = (ch, windowSec) => eeg.series[ch].slice(-Math.floor(windowSec * RATE));

  // Power per frequency bin, as numpy's rfft would give it: |X[k]|^2 / N at
  // k * RATE / N hertz. Only the bins up to maxFreq are computed.
  function spectrum(signal, maxFreq) {
    const n = signal.length;
    const bins = Math.min(Math.floor(n / 2), Math.floor((maxFreq * n) / RATE));
    const cos = new Float64Array(n), sin = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    const freqs = [], psd = [];
    for (let k = 0; k <= bins; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) {
        const j = (k * i) % n;
        re += signal[i] * cos[j];
        im -= signal[i] * sin[j];
      }
      freqs.push((k * RATE) / n);
      psd.push((re * re + im * im) / n);
    }
    return { freqs, psd };
  }

  function smooth(previous, values, alpha) {
    return previous ? values.map((v, i) => alpha * v + (1 - alpha) * previous[i]) : values;
  }

  function bandsMessage(windowSec) {
    const bandNames = BANDS.map((b) => b[0]);
    const empty = { type: "bands", channels: [], bands: bandNames, values: [], engagement: 0 };
    if (!live() || eeg.series[0].length === 0) return empty;

    const values = [], engagement = [];
    for (let ch = 0; ch < CHANNELS; ch++) {
      const signal = tail(ch, windowSec);
      if (signal.length < 32) {
        values.push(BANDS.map(() => 0));
        engagement.push(0);
        continue;
      }
      const { freqs, psd } = spectrum(signal, 40);
      const raw = BANDS.map(([, lo, hi]) => psd.reduce((sum, p, i) => (freqs[i] >= lo && freqs[i] < hi ? sum + p : sum), 0));
      const total = raw.reduce((a, b) => a + b, 0);
      const relative = raw.map((v) => (total > 0 ? (v / total) * 100 : 0));
      eeg.bandSmooth[ch] = smooth(eeg.bandSmooth[ch], relative, 0.3);
      values.push(eeg.bandSmooth[ch]);
      // Engagement is beta over alpha plus theta, on the unsmoothed powers.
      engagement.push(Math.max(0, Math.min(5, raw[3] / (raw[2] + raw[1] + 0.001))));
    }
    eeg.engagementSmooth = smooth(eeg.engagementSmooth, engagement, 0.2);
    const average = eeg.engagementSmooth.reduce((a, b) => a + b, 0) / CHANNELS;
    return { type: "bands", channels: names(), bands: bandNames, values, engagement: average, engagement_channels: eeg.engagementSmooth };
  }

  function timeseriesMessage(windowSec) {
    if (!live() || eeg.series[0].length === 0) return null;
    const data = eeg.series.map((_, ch) => {
      const series = tail(ch, windowSec);
      if (series.length <= 512) return series;
      const step = Math.floor(series.length / 512);
      return series.filter((_, i) => i % step === 0);
    });
    return { type: "timeseries", channels: names(), data };
  }

  function fftMessage(windowSec) {
    if (!live() || eeg.series[0].length === 0) return null;
    let freqList = [];
    const all = eeg.series.map((_, ch) => {
      const signal = tail(ch, windowSec);
      if (signal.length < 32) return [];
      const { freqs, psd } = spectrum(signal, 40);
      const keep = freqs.map((f) => f >= 0.5 && f <= 40);
      if (ch === 0) freqList = freqs.filter((_, i) => keep[i]);
      return psd.filter((_, i) => keep[i]).map((p) => 10 * Math.log10(p + 1e-10));
    });
    return { type: "fft", channels: names(), freqs: freqList, psd: all };
  }

  // ---------- camera ----------

  const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1";
  const MODELS = "https://storage.googleapis.com/mediapipe-models";
  const cam = {
    running: false, video: null, canvas: null, stream: null, face: null, hands: null, timer: null,
    features: {}, gaze: {}, handData: { left: null, right: null }, sockets: new Set(),
  };

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function faceFeatures(lm, w, h) {
    const p = (i) => [lm[i].x * w, lm[i].y * h];
    const mouthLeft = p(61), mouthRight = p(291);
    const mouthWidth = dist(mouthLeft, mouthRight);
    const leftEye = p(159), rightEye = p(386), leftBrow = p(70);
    const leftOuter = p(33), rightOuter = p(263), leftInner = p(133), rightInner = p(362);
    const leftWidth = dist(leftOuter, leftInner), rightWidth = dist(rightOuter, rightInner);
    const roll = (Math.atan2(rightOuter[1] - leftOuter[1], rightOuter[0] - leftOuter[0]) * 180) / Math.PI;
    const mouthCurve = ((mouthLeft[1] + mouthRight[1]) / 2 - p(1)[1]) / Math.max(mouthWidth, 1);
    return {
      mouth_openness: dist(p(13), p(14)) / Math.max(mouthWidth, 1),
      brow_raise: (leftEye[1] - leftBrow[1]) / (Math.abs(leftEye[1] - rightEye[1]) + 20),
      head_yaw: ((leftWidth - rightWidth) / (leftWidth + rightWidth)) * 0.5,
      head_roll: roll,
      head_roll_relative: Math.max(0, Math.min(1, (roll + 45) / 90)),
      smile_curvature: 1 / (1 + Math.exp(-5 * (mouthCurve - 0.3))),
    };
  }

  function gazeFeatures(lm, w, h) {
    if (lm.length < 474) return { gaze_x: 0, gaze_y: 0, gaze_confidence: 0 };
    const p = (i) => [lm[i].x * w, lm[i].y * h];
    const eye = (outer, inner, iris) => {
      const o = p(outer), n = p(inner), c = p(iris);
      const width = dist(o, n);
      return [(c[0] - (o[0] + n[0]) / 2) / (width / 2 + 0.001), (c[1] - (o[1] + n[1]) / 2) / (width / 4 + 0.001)];
    };
    const left = eye(33, 133, 468), right = eye(263, 362, 473);
    const x = Math.max(-1, Math.min(1, (left[0] + right[0]) / 2));
    const y = Math.max(-1, Math.min(1, (left[1] + right[1]) / 2));
    return { gaze_x: x, gaze_y: y, gaze_confidence: 1 - Math.abs(x) * 0.3 };
  }

  function handFeatures(lm, confidence) {
    const wrist = lm[0];
    const tips = [4, 8, 12, 16, 20].map((i) => lm[i]);
    const pinch = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
    const states = {
      thumb: Math.abs(lm[4].x - wrist.x) > Math.abs(lm[2].x - wrist.x),
      index: lm[8].y < lm[5].y,
      middle: lm[12].y < lm[9].y,
      ring: lm[16].y < lm[13].y,
      pinky: lm[20].y < lm[17].y,
    };
    const count = Object.values(states).filter(Boolean).length;
    let gesture = "none";
    if (count === 0) gesture = "fist";
    else if (count === 5) gesture = "open";
    else if (states.index && count === 1) gesture = "point";
    else if (states.index && states.middle && count === 2) gesture = "peace";
    else if (states.thumb && count === 1) gesture = "thumbs_up";
    else if (pinch < 0.05) gesture = "pinch";
    return {
      present: true, confidence,
      palm_x: wrist.x, palm_y: wrist.y, palm_z: wrist.z,
      pinch_distance: pinch,
      hand_openness: tips.reduce((sum, t) => sum + Math.hypot(t.x - wrist.x, t.y - wrist.y), 0) / 5,
      fingers_extended: count, gesture, finger_states: states,
    };
  }

  function cameraFrame() {
    const { video, canvas } = cam;
    if (!cam.running || video.readyState < 2) return;
    const ctx = canvas.getContext("2d");
    // Mirrored, as the desktop app does, so moving left moves left on screen.
    ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const now = performance.now();
    const face = cam.face.detectForVideo(canvas, now).faceLandmarks[0];
    cam.features = face ? faceFeatures(face, canvas.width, canvas.height) : {};
    cam.gaze = face ? gazeFeatures(face, canvas.width, canvas.height) : { gaze_x: 0, gaze_y: 0, gaze_confidence: 0 };

    const found = cam.hands.detectForVideo(canvas, now);
    cam.handData = { left: null, right: null };
    found.landmarks.forEach((lm, i) => {
      const side = found.handedness[i][0];
      cam.handData[side.categoryName.toLowerCase()] = handFeatures(lm, side.score);
    });

    if (cam.sockets.size === 0) return;
    const frame = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
    const message = { type: "camera", frame, features: cam.features, gaze: cam.gaze, hands: cam.handData };
    cam.sockets.forEach((socket) => socket.deliver(message));
  }

  async function startCamera() {
    if (cam.running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("This browser has no camera access.");
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    try {
      cam.video = document.createElement("video");
      cam.video.muted = true;
      cam.video.playsInline = true;
      cam.video.srcObject = cam.stream;
      await cam.video.play();
      cam.canvas = document.createElement("canvas");
      cam.canvas.width = 640;
      cam.canvas.height = 480;

      if (!cam.face) {
        const vision = await import(`${VISION}/vision_bundle.mjs`);
        const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
        cam.face = await vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: `${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
          runningMode: "VIDEO", numFaces: 1,
          minFaceDetectionConfidence: 0.3, minFacePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
        });
        cam.hands = await vision.HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: `${MODELS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` },
          runningMode: "VIDEO", numHands: 2,
        });
      }
    } catch (error) {
      cam.stream.getTracks().forEach((track) => track.stop());
      cam.stream = null;
      throw error;
    }
    cam.running = true;
    cam.timer = setInterval(() => {
      try { cameraFrame(); } catch (error) { console.warn("[HeadWave] camera frame failed:", error); }
    }, 1000 / 15);
  }

  function stopCamera() {
    cam.running = false;
    clearInterval(cam.timer);
    if (cam.stream) cam.stream.getTracks().forEach((track) => track.stop());
    cam.stream = null;
  }

  // ---------- the server's HTTP endpoints ----------

  const ok = (extra) => [200, { status: "ok", ...extra }];
  const unavailable = [503, { status: "error", message: DESKTOP_ONLY }];

  const routes = {
    "GET status": () => [200, { connected: eeg.connected, streaming: eeg.streaming, simulator: eeg.simulator }],
    "POST use_simulator": (body) => {
      eeg.simulator = body.enabled !== false;
      if (!eeg.simulator) { stopStream(); eeg.connected = false; }
      return ok({ simulator: eeg.simulator, message: eeg.simulator ? "Simulator enabled" : "Real hardware enabled" });
    },
    "POST simulator/mode": (body) => {
      if (MODES[body.mode]) eeg.mode = body.mode;
      return ok({ mode: body.mode });
    },
    "POST connect": () => {
      if (!eeg.simulator) return [500, { status: "error", message: "A real EEG headset needs the HeadWave desktop app. Enable the simulator to try it here." }];
      eeg.connected = true;
      return ok({ simulator: true });
    },
    "POST disconnect": () => { stopStream(); eeg.connected = false; return ok(); },
    "POST start": () => {
      if (!eeg.connected) return [500, { status: "error", message: "Simulator not connected" }];
      startStream();
      return ok({ simulator: true });
    },
    "POST stop": () => { stopStream(); return ok(); },
    "GET ports": () => [200, []],
    "POST camera/start": async () => {
      try { await startCamera(); return ok(); }
      catch (error) {
        const denied = error && error.name === "NotAllowedError";
        return [500, { status: "error", message: denied ? "Camera permission was not given." : String((error && error.message) || error) }];
      }
    },
    "POST camera/stop": () => { stopCamera(); return ok(); },
    "GET camera/status": () => [200, { running: cam.running, streaming: cam.running, available: true }],
    "GET camera/features": () => [200, { features: cam.features }],
    "GET engagement": () => [200, { channels: [], values: [], average: 0 }],
    "GET midi/ports": () => [200, { available: false, ports: [] }],
    "GET midi/status": () => [200, { available: false, connected: false }],
    "GET recording/status": () => [200, { available: false, recording: false }],
    "GET recording/list": () => [200, { sessions: [] }],
    "GET calibration/status": () => [200, { calibrating: false, available: false }],
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    const path = url.pathname;
    if (url.origin !== window.location.origin || !path.startsWith("/api/") || path.startsWith(AI_BASE + "/")) return realFetch(input, init);
    if (path.startsWith("/api/ai/")) return realFetch(AI_BASE + path.slice(4), init);

    const method = (init.method || "GET").toUpperCase();
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { /* treated as empty */ }
    const route = routes[`${method} ${path.slice(5)}`];
    const [status, data] = route ? await route(body) : unavailable;
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  };

  // ---------- the server's two websockets ----------

  class LocalSocket {
    constructor(kind) {
      this.kind = kind;
      this.readyState = 0;
      this.config = { mode: "timeseries", window_sec: 4, interval_ms: 100 };
      setTimeout(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        if (kind === "camera") cam.sockets.add(this);
        if (this.onopen) this.onopen({ target: this });
      }, 0);
    }

    // The EEG stream begins on the first message, which names the mode.
    send(text) {
      if (this.kind !== "stream") return;
      Object.assign(this.config, JSON.parse(text));
      if (!this.timer) this.tick();
    }

    tick() {
      if (this.readyState !== 1) return;
      const { mode, window_sec } = this.config;
      const message = mode === "bands" ? bandsMessage(window_sec) : mode === "fft" ? fftMessage(window_sec) : timeseriesMessage(window_sec);
      if (live() && message) this.deliver(message);
      this.timer = setTimeout(() => this.tick(), live() ? this.config.interval_ms : 500);
    }

    deliver(message) {
      if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(message), target: this });
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      clearTimeout(this.timer);
      cam.sockets.delete(this);
      if (this.onclose) this.onclose({ target: this });
    }
  }

  const RealSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const path = new URL(url, window.location.href).pathname;
    if (path === "/ws/stream") return new LocalSocket("stream");
    if (path === "/ws/camera") return new LocalSocket("camera");
    return new RealSocket(url, protocols);
  };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

  // ---------- first visit ----------

  const STARTER = new URL("web-starter.json", document.currentScript.src).href;

  // The desktop app opens on an empty canvas. Here a first-time visitor gets a
  // small working patch instead: a prompt, the sketch it once produced, and
  // the EEG's alpha band wired into one of its parameters. The sketch is
  // stored, not generated, so opening the page costs no model call.
  async function loadStarter() {
    if (typeof Patcher === "undefined" || Patcher.nodes.length > 0) return;
    const starter = await (await realFetch(STARTER)).json();

    const signal = Patcher.addNode("eeg", 250, 120);
    const prompt = Patcher.addNode("prompt", 250, 300);
    const gen = Patcher.addNode("gen", 620, 110);
    if (!signal || !prompt || !gen) return;

    signal.params.band = starter.modulate.band;
    AudioEngine.nodes[signal.id].params.band = starter.modulate.band;
    prompt.params.text = starter.prompt;
    AudioEngine.nodes[prompt.id].params.text = starter.prompt;
    gen.params.code = starter.code;
    gen.params.sourcePrompt = starter.prompt;
    Object.assign(AudioEngine.nodes[gen.id].params, { code: starter.code, sourcePrompt: starter.prompt });
    AudioEngine.nodes[gen.id].code = starter.code;
    Patcher._applyParametersToGenNode(gen, starter.parameters);
    AudioEngine.executeGenCanvas(gen.id, gen, starter.code);

    Patcher.connectNodes(signal.id, "value", gen.id, starter.modulate.parameter);
    // Drawn directly: connectNodes would treat this cable as a request to generate.
    if (AudioEngine.connect(prompt.id, "prompt", gen.id, "prompt")) {
      Patcher.cables.push({ fromNode: prompt.id, fromPort: "prompt", toNode: gen.id, toPort: "prompt" });
    }
    Patcher.render();
  }

  // A visitor has no headset: open with the simulator already running, through
  // the page's own button so its state and the server's stay in step.
  window.addEventListener("load", () => {
    setTimeout(() => {
      const toggle = document.getElementById("toggle-simulator");
      if (toggle && !eeg.simulator) toggle.click();
      loadStarter().catch((error) => console.warn("[HeadWave] starter patch failed:", error));
    }, 300);
  });
})();
