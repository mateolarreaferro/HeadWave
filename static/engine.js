// engine.js - Unified Node Engine for HeadWave
// Audio + Visual synthesis with EEG/CV integration

const AudioEngine = {
  // Audio context
  ctx: null,
  masterGain: null,
  analyzer: null,

  // State
  initialized: false,
  muted: false,
  masterVolume: 0.5,

  // Active nodes
  nodes: {},
  nodeCounter: 0,

  // Connections
  connections: [],

  // Sample buffers (per node ID)
  sampleBuffers: {},

  // Data sources
  data: {
    bands: { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 },
    cv: { mouth: 0, yaw: 0, roll: 0, smile: 0 },
    gaze: { x: 0, y: 0, confidence: 0 },
    hands: { left: null, right: null },
    engagement: 0
  },

  // Recording state
  recording: {
    isRecording: false,
    startTime: null,
    duration: 0
  },

  // Visualization data buffers - global shared buffers
  vizData: {
    timeSeries: {
      channels: [[], [], [], [], [], [], [], []], // Rolling buffers per channel (up to 8)
      maxPoints: 200
    },
    fft: {
      freqs: [],
      psd: [[], [], [], [], [], [], [], []] // PSD per channel
    }
  },

  // Node type definitions - New consolidated categories
  nodeTypes: {
    // ============ AUDIO ============
    toneGenerator: {
      name: 'Tone Generator',
      category: 'audio',
      inputs: ['frequency', 'detune', 'gain'],
      outputs: ['audio'],
      params: {
        mode: { default: 'oscillator', options: ['oscillator', 'noise'] },
        waveform: { default: 'sine', options: ['sine', 'square', 'sawtooth', 'triangle'] },
        noiseType: { default: 'white', options: ['white', 'pink', 'brown'] },
        frequency: { default: 440, min: 20, max: 2000 },
        detune: { default: 0, min: -1200, max: 1200 },
        gain: { default: 0.5, min: 0, max: 1 }
      }
    },
    sampler: {
      name: 'Sampler',
      category: 'audio',
      inputs: ['speed', 'trigger'],
      outputs: ['audio'],
      params: {
        speed: { default: 1, min: 0.1, max: 4 },
        loop: { default: true, options: [true, false] },
        reverse: { default: false, options: [true, false] },
        startPosition: { default: 0, min: 0, max: 1 }
      }
    },
    filter: {
      name: 'Filter',
      category: 'audio',
      inputs: ['audio', 'frequency', 'Q'],
      outputs: ['audio'],
      params: {
        mode: { default: 'lpf', options: ['lpf', 'hpf', 'bpf'] },
        frequency: { default: 1000, min: 20, max: 20000 },
        Q: { default: 1, min: 0.1, max: 20 }
      }
    },
    effects: {
      name: 'Effects',
      category: 'audio',
      inputs: ['audio', 'mix'],
      outputs: ['audio'],
      params: {
        type: { default: 'delay', options: ['delay', 'reverb', 'chorus'] },
        // Delay params
        delayTime: { default: 0.3, min: 0, max: 2 },
        feedback: { default: 0.3, min: 0, max: 0.95 },
        // Reverb params
        decay: { default: 2, min: 0.1, max: 10 },
        // Chorus params
        rate: { default: 1.5, min: 0.1, max: 10 },
        depth: { default: 0.5, min: 0, max: 1 },
        // Common
        mix: { default: 0.3, min: 0, max: 1 }
      }
    },

    // ============ MODULATORS ============
    face: {
      name: 'Face',
      category: 'modulator',
      inputs: [],
      outputs: ['mouth', 'smile', 'yaw', 'roll', 'brow'],
      params: {
        smoothing: { default: 0.1, min: 0, max: 1 }
      }
    },
    hands: {
      name: 'Hands',
      category: 'modulator',
      inputs: [],
      outputs: ['leftX', 'leftY', 'leftPinch', 'leftOpen', 'rightX', 'rightY', 'rightPinch', 'rightOpen'],
      params: {
        smoothing: { default: 0.1, min: 0, max: 1 }
      }
    },
    eeg: {
      name: 'EEG',
      category: 'modulator',
      inputs: [],
      outputs: ['value'],
      params: {
        mode: { default: 'bands', options: ['bands', 'timeseries', 'fft'] },
        // Bands mode
        band: { default: 'alpha', options: ['delta', 'theta', 'alpha', 'beta', 'gamma'] },
        // Time series mode
        channel: { default: 1, min: 1, max: 8 },
        metric: { default: 'amplitude', options: ['amplitude', 'rms', 'peak', 'mean'] },
        // FFT mode
        fftBin: { default: 10, min: 1, max: 64 },
        // Common
        smoothing: { default: 0.1, min: 0, max: 1 }
      }
    },
    eyes: {
      name: 'Eyes',
      category: 'modulator',
      inputs: [],
      outputs: ['x', 'y', 'confidence'],
      params: {
        smoothing: { default: 0.1, min: 0, max: 1 }
      }
    },
    lfo: {
      name: 'LFO',
      category: 'modulator',
      inputs: ['rate'],
      outputs: ['signal'],
      params: {
        waveform: { default: 'sine', options: ['sine', 'square', 'sawtooth', 'triangle'] },
        rate: { default: 1, min: 0.01, max: 20 },
        depth: { default: 1, min: 0, max: 1 }
      }
    },
    scale: {
      name: 'Scale',
      category: 'modulator',
      inputs: ['signal'],
      outputs: ['signal'],
      params: {
        min: { default: 200, min: 0, max: 20000 },
        max: { default: 800, min: 0, max: 20000 }
      }
    },

    // ============ VISUALS ============
    aiCanvas: {
      name: 'AI Canvas',
      category: 'visual',
      inputs: [],  // Dynamically populated after AI generates code
      outputs: ['draw'],
      params: {
        prompt: { default: '', type: 'text', placeholder: 'Describe your visual...' },
        background: { default: '#0d1117', type: 'color' }
      }
    },
    ellipse: {
      name: 'Ellipse',
      category: 'visual',
      inputs: ['x', 'y', 'width', 'height', 'color', 'rotation'],
      outputs: ['draw'],
      params: {
        x: { default: 0.5, min: 0, max: 1 },
        y: { default: 0.5, min: 0, max: 1 },
        width: { default: 0.1, min: 0, max: 1 },
        height: { default: 0.1, min: 0, max: 1 },
        rotation: { default: 0, min: 0, max: 360 },
        fill: { default: '#ffffff', type: 'color' },
        stroke: { default: 'none', type: 'color' },
        strokeWeight: { default: 2, min: 0, max: 20 }
      }
    },
    rect: {
      name: 'Rectangle',
      category: 'visual',
      inputs: ['x', 'y', 'width', 'height', 'color', 'rotation'],
      outputs: ['draw'],
      params: {
        x: { default: 0.5, min: 0, max: 1 },
        y: { default: 0.5, min: 0, max: 1 },
        width: { default: 0.1, min: 0, max: 1 },
        height: { default: 0.1, min: 0, max: 1 },
        rotation: { default: 0, min: 0, max: 360 },
        cornerRadius: { default: 0, min: 0, max: 100 },
        fill: { default: '#ffffff', type: 'color' },
        stroke: { default: 'none', type: 'color' },
        strokeWeight: { default: 2, min: 0, max: 20 }
      }
    },

    // ============ SENDERS ============
    midi: {
      name: 'MIDI',
      category: 'sender',
      inputs: ['value', 'trigger'],
      outputs: [],
      params: {
        mode: { default: 'cc', options: ['cc', 'note'] },
        // CC mode
        cc: { default: 1, min: 0, max: 127 },
        // Note mode
        note: { default: 60, min: 0, max: 127 },
        velocity: { default: 100, min: 0, max: 127 },
        duration: { default: 100, min: 10, max: 5000 },
        // Common
        channel: { default: 1, min: 1, max: 16 }
      }
    },
    osc: {
      name: 'OSC',
      category: 'sender',
      inputs: ['value'],
      outputs: [],
      params: {
        address: { default: '/headwave/value', type: 'text', placeholder: '/osc/address' },
        ip: { default: '127.0.0.1', type: 'text', placeholder: '127.0.0.1' },
        port: { default: 9000, min: 1024, max: 65535 },
        scale: { default: 1, min: 0.01, max: 100 }
      }
    },

    // ============ VISUALIZERS ============
    eegViz: {
      name: 'EEG Viz',
      category: 'visualizer',
      inputs: ['eegSignal'],
      outputs: [],
      params: {
        mode: { default: 'bands', options: ['timeseries', 'fft', 'bands'] },
        channel: { default: 1, min: 1, max: 8 },
        windowSec: { default: 4, min: 1, max: 10 },
        colorScheme: { default: 'cyan', options: ['cyan', 'purple', 'green', 'rainbow'] },
        recording: { default: false, options: [true, false] }
      }
    },
    cvViz: {
      name: 'CV Viz',
      category: 'visualizer',
      inputs: [],
      outputs: [],
      params: {
        showFace: { default: true, options: [true, false] },
        showHands: { default: true, options: [true, false] },
        showGaze: { default: true, options: [true, false] },
        showMeters: { default: true, options: [true, false] },
        recording: { default: false, options: [true, false] }
      }
    },

    // ============ OUTPUT ============
    output: {
      name: 'Output',
      category: 'output',
      inputs: ['audio', 'visual'],
      outputs: [],
      params: {
        audioGain: { default: 0.5, min: 0, max: 1 },
        visualEnabled: { default: true, options: [true, false] }
      }
    }
  },

  // Store for AI Canvas instances (isolated p5.js)
  aiCanvasInstances: {},
  aiCanvasCode: {},

  // Initialize the audio engine
  init: function() {
    if (this.initialized) return true;

    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();

      // Master gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.ctx.destination);

      // Analyzer for visualization
      this.analyzer = this.ctx.createAnalyser();
      this.analyzer.fftSize = 256;
      this.masterGain.connect(this.analyzer);

      this.initialized = true;
      return true;
    } catch (e) {
      console.error('[AudioEngine] Failed to initialize:', e);
      return false;
    }
  },

  // Resume audio context (needed after user interaction)
  resume: function() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  // Start the modulator update loop (for LFO and other time-based modulators)
  _startModulatorLoop: function() {
    if (this._modulatorLoopRunning) return;
    this._modulatorLoopRunning = true;

    const updateLoop = () => {
      if (!this._modulatorLoopRunning) return;

      // Update time-based modulators (LFO)
      this._updateTimeBasedModulators();

      requestAnimationFrame(updateLoop);
    };
    requestAnimationFrame(updateLoop);
  },

  // Update only time-based modulators (LFO, etc.) - called every frame
  _updateTimeBasedModulators: function() {
    for (const [id, node] of Object.entries(this.nodes)) {
      // LFO
      if (node.type === 'lfo') {
        const rate = node.params.rate || 1;
        const depth = node.params.depth || 1;
        const time = this.ctx ? this.ctx.currentTime : (Date.now() / 1000);
        const phase = (time * rate) % 1;

        let value = 0;
        const waveform = node.params.waveform || 'sine';
        if (waveform === 'sine') {
          value = (Math.sin(phase * Math.PI * 2) + 1) / 2;
        } else if (waveform === 'square') {
          value = phase < 0.5 ? 1 : 0;
        } else if (waveform === 'sawtooth') {
          value = phase;
        } else if (waveform === 'triangle') {
          value = phase < 0.5 ? phase * 2 : 2 - phase * 2;
        }
        node.outputValue = value * depth;

        // Apply modulation to connected nodes
        this._applyModulation(node);
      }
    }
  },

  // Start the audio engine (called when Enable Audio is checked)
  start: function() {
    if (!this.initialized) {
      this.init();
    }
    this.resume();
    this._startModulatorLoop();
    this.muted = false;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }
  },

  // Stop the audio engine
  stop: function() {
    this.muted = true;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
  },

  // Set master volume (alias for setVolume)
  setMasterVolume: function(value) {
    this.setVolume(value);
  },

  // Set master volume
  setVolume: function(value) {
    this.masterVolume = Math.max(0, Math.min(1, value));
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
  },

  // Toggle mute
  toggleMute: function() {
    this.muted = !this.muted;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
    return this.muted;
  },

  // -------- Recording Control --------
  startRecording: async function() {
    if (this.recording.isRecording) return false;

    try {
      const response = await fetch('/api/recording/start', { method: 'POST' });
      if (response.ok) {
        this.recording.isRecording = true;
        this.recording.startTime = Date.now();
        this.recording.duration = 0;
        return true;
      }
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
    return false;
  },

  stopRecording: async function() {
    if (!this.recording.isRecording) return false;

    try {
      const response = await fetch('/api/recording/stop', { method: 'POST' });
      if (response.ok) {
        this.recording.isRecording = false;
        this.recording.duration = (Date.now() - this.recording.startTime) / 1000;
        this.recording.startTime = null;
        return true;
      }
    } catch (err) {
      console.error('Failed to stop recording:', err);
    }
    return false;
  },

  toggleRecording: async function() {
    if (this.recording.isRecording) {
      return await this.stopRecording();
    } else {
      return await this.startRecording();
    }
  },

  getRecordingDuration: function() {
    if (!this.recording.isRecording || !this.recording.startTime) return 0;
    return (Date.now() - this.recording.startTime) / 1000;
  },

  // -------- Sender Methods --------
  sendOSC: async function(address, value, ip = '127.0.0.1', port = 9000) {
    try {
      await fetch('/api/node/osc/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, value, ip, port })
      });
    } catch (err) {
      console.error('OSC send error:', err);
    }
  },

  sendMIDICC: async function(cc, value, channel = 1) {
    try {
      await fetch('/api/node/midi/cc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cc, value, channel })
      });
    } catch (err) {
      console.error('MIDI CC send error:', err);
    }
  },

  sendMIDINote: async function(note, velocity, channel = 1, duration = 100) {
    try {
      await fetch('/api/node/midi/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, velocity, channel, duration })
      });
    } catch (err) {
      console.error('MIDI Note send error:', err);
    }
  },

  // Create a node
  createNode: function(type, x = 100, y = 100) {
    // Auto-initialize if needed
    if (!this.initialized) {
      this.init();
    }

    if (!this.nodeTypes[type]) {
      return null;
    }

    const id = `node_${++this.nodeCounter}`;
    const nodeType = this.nodeTypes[type];

    const node = {
      id: id,
      type: type,
      x: x,
      y: y,
      params: {},
      audioNode: null,
      inputNodes: {},
      outputValue: 0
    };

    // Initialize params with defaults
    for (const [param, config] of Object.entries(nodeType.params)) {
      node.params[param] = config.default;
    }

    // Create Web Audio node
    node.audioNode = this._createAudioNode(type, node.params);

    this.nodes[id] = node;
    return node;
  },

  // Create the underlying Web Audio node
  _createAudioNode: function(type, params) {
    if (!this.ctx) return null;

    switch (type) {
      case 'toneGenerator':
        // Combined oscillator + noise node
        if (params.mode === 'noise') {
          const noiseNode = this._createNoiseNode(params.noiseType);
          const gainNode = this.ctx.createGain();
          gainNode.gain.value = params.gain;
          noiseNode.connect(gainNode);
          gainNode._noiseSource = noiseNode;
          gainNode._mode = 'noise';
          return gainNode;
        } else {
          const osc = this.ctx.createOscillator();
          osc.type = params.waveform;
          osc.frequency.value = params.frequency;
          osc.detune.value = params.detune;
          const gainNode = this.ctx.createGain();
          gainNode.gain.value = params.gain;
          osc.connect(gainNode);
          osc.start();
          gainNode._oscillator = osc;
          gainNode._mode = 'oscillator';
          return gainNode;
        }

      case 'sampler':
        return this._createSamplerNode(params, this.nodeCounter);

      case 'filter':
        const filter = this.ctx.createBiquadFilter();
        // Map mode to Web Audio filter type
        const filterTypeMap = { 'lpf': 'lowpass', 'hpf': 'highpass', 'bpf': 'bandpass' };
        filter.type = filterTypeMap[params.mode] || 'lowpass';
        filter.frequency.value = params.frequency;
        filter.Q.value = params.Q;
        return filter;

      case 'effects':
        return this._createEffectsNode(params);

      case 'lfo':
        const lfo = this.ctx.createOscillator();
        lfo.type = params.waveform;
        lfo.frequency.value = params.rate;
        lfo.start();
        return lfo;

      case 'scale':
        // Scale/Range node - no audio node needed, handles signal mapping
        return null;

      case 'output':
        return this.masterGain;

      default:
        return null;
    }
  },

  // Create effects node (delay, reverb, chorus)
  _createEffectsNode: function(params) {
    if (!this.ctx) return null;

    const effectType = params.type || 'delay';

    // Create dry/wet mixer
    const inputGain = this.ctx.createGain();
    const dryGain = this.ctx.createGain();
    const wetGain = this.ctx.createGain();
    const outputGain = this.ctx.createGain();

    dryGain.gain.value = 1 - params.mix;
    wetGain.gain.value = params.mix;

    inputGain.connect(dryGain);
    dryGain.connect(outputGain);

    let effectNode;

    if (effectType === 'delay') {
      effectNode = this.ctx.createDelay(5);
      effectNode.delayTime.value = params.delayTime;

      // Create feedback loop
      const feedbackGain = this.ctx.createGain();
      feedbackGain.gain.value = params.feedback;

      inputGain.connect(effectNode);
      effectNode.connect(feedbackGain);
      feedbackGain.connect(effectNode);
      effectNode.connect(wetGain);
      wetGain.connect(outputGain);

      outputGain._delay = effectNode;
      outputGain._feedback = feedbackGain;
    } else if (effectType === 'reverb') {
      // Create convolution reverb with generated impulse
      const convolver = this.ctx.createConvolver();
      convolver.buffer = this._createReverbImpulse(params.decay);

      inputGain.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(outputGain);

      outputGain._convolver = convolver;
    } else if (effectType === 'chorus') {
      // Chorus using modulated delay
      const chorusDelay = this.ctx.createDelay(0.1);
      chorusDelay.delayTime.value = 0.03;

      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = params.rate;

      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = params.depth * 0.01;

      lfo.connect(lfoGain);
      lfoGain.connect(chorusDelay.delayTime);
      lfo.start();

      inputGain.connect(chorusDelay);
      chorusDelay.connect(wetGain);
      wetGain.connect(outputGain);

      outputGain._chorusDelay = chorusDelay;
      outputGain._chorusLfo = lfo;
      outputGain._chorusLfoGain = lfoGain;
    }

    outputGain._input = inputGain;
    outputGain._dry = dryGain;
    outputGain._wet = wetGain;
    outputGain._effectType = effectType;

    // Override connect to use input
    const originalConnect = outputGain.connect.bind(outputGain);
    outputGain.connectInput = function(source) {
      source.connect(inputGain);
    };

    return outputGain;
  },

  // Create reverb impulse response
  _createReverbImpulse: function(decay) {
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * decay;
    const impulse = this.ctx.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }

    return impulse;
  },

  // Create sampler node (initially silent, needs sample loaded)
  _createSamplerNode: function(params, nodeId) {
    if (!this.ctx) return null;

    // Create a gain node as placeholder (will connect source to this)
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 1;
    gainNode._nodeId = nodeId;
    gainNode._params = params;
    gainNode._source = null;

    return gainNode;
  },

  // Load sample for a specific sampler node
  loadSampleForNode: function(nodeId, file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target.result;
          const buffer = await this.ctx.decodeAudioData(arrayBuffer);
          this.sampleBuffers[nodeId] = buffer;

          // Start playback
          const node = this.nodes[nodeId];
          if (node && node.audioNode) {
            this._startSamplerPlayback(nodeId);
          }

          resolve(buffer);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  },

  // Start/restart sampler playback
  _startSamplerPlayback: function(nodeId) {
    const node = this.nodes[nodeId];
    if (!node || !node.audioNode) return;

    const buffer = this.sampleBuffers[nodeId];
    if (!buffer) return;

    // Stop existing source
    if (node.audioNode._source) {
      try { node.audioNode._source.stop(); } catch (e) {}
      node.audioNode._source.disconnect();
    }

    // Create new source
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = node.params.loop;
    source.playbackRate.value = node.params.speed;
    source.connect(node.audioNode);
    source.start();

    node.audioNode._source = source;
  },

  // Create noise generator
  _createNoiseNode: function(type) {
    const bufferSize = 2 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    if (type === 'white') {
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    } else if (type === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    } else { // brown
      let last = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (last + 0.02 * white) / 1.02;
        last = data[i];
        data[i] *= 3.5;
      }
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    noise.start();
    return noise;
  },

  // Delete a node
  deleteNode: function(id) {
    const node = this.nodes[id];
    if (!node) return;

    // Disconnect all connections involving this node
    this.connections = this.connections.filter(conn => {
      if (conn.fromNode === id || conn.toNode === id) {
        this._disconnectNodes(conn.fromNode, conn.toNode);
        return false;
      }
      return true;
    });

    // Stop and disconnect audio node
    if (node.audioNode) {
      if (node.audioNode.stop) {
        try { node.audioNode.stop(); } catch (e) {}
      }
      if (node.audioNode.disconnect) {
        node.audioNode.disconnect();
      }
    }

    delete this.nodes[id];
  },

  // Connect two nodes
  connect: function(fromNodeId, fromOutput, toNodeId, toInput) {
    console.log('[AudioEngine] connect called:', fromNodeId, fromOutput, '->', toNodeId, toInput);

    const fromNode = this.nodes[fromNodeId];
    const toNode = this.nodes[toNodeId];

    if (!fromNode || !toNode) {
      console.log('[AudioEngine] connect failed: node not found', { fromNode: !!fromNode, toNode: !!toNode });
      return false;
    }

    // Check if connection already exists
    const exists = this.connections.some(c =>
      c.fromNode === fromNodeId && c.toNode === toNodeId &&
      c.fromOutput === fromOutput && c.toInput === toInput
    );
    if (exists) {
      console.log('[AudioEngine] connect: already exists');
      return false;
    }

    // Make audio connection using the helper
    if (fromNode.audioNode && toNode.audioNode) {
      try {
        const target = this._getConnectionTarget(toNode, toInput);
        if (target) {
          fromNode.audioNode.connect(target);
        }
      } catch (e) {
        console.log('[AudioEngine] audio connect error:', e);
        return false;
      }
    }

    this.connections.push({
      fromNode: fromNodeId,
      fromOutput: fromOutput,
      toNode: toNodeId,
      toInput: toInput
    });

    console.log('[AudioEngine] connect success, total connections:', this.connections.length);
    return true;
  },

  // Disconnect nodes
  disconnect: function(fromNodeId, toNodeId, toInput) {
    this._disconnectNodes(fromNodeId, toNodeId);

    // Find the connection being removed to get the target input
    const conn = this.connections.find(c =>
      c.fromNode === fromNodeId && c.toNode === toNodeId &&
      (toInput === undefined || c.toInput === toInput)
    );

    // Reset the target parameter to its default value
    if (conn) {
      const toNode = this.nodes[toNodeId];
      if (toNode) {
        const nodeType = this.nodeTypes[toNode.type];
        if (nodeType?.params?.[conn.toInput]) {
          const defaultValue = nodeType.params[conn.toInput].default;
          this.setParam(toNodeId, conn.toInput, defaultValue);
        }
      }
    }

    this.connections = this.connections.filter(c =>
      !(c.fromNode === fromNodeId && c.toNode === toNodeId &&
        (toInput === undefined || c.toInput === toInput))
    );
  },

  _disconnectNodes: function(fromNodeId, toNodeId) {
    const fromNode = this.nodes[fromNodeId];
    const toNode = this.nodes[toNodeId];

    if (fromNode?.audioNode && toNode?.audioNode) {
      try {
        fromNode.audioNode.disconnect(toNode.audioNode);
      } catch (e) {}
    }
  },

  // Update node parameter
  setParam: function(nodeId, param, value) {
    const node = this.nodes[nodeId];
    if (!node) return;

    node.params[param] = value;

    // Check if this parameter change requires node recreation
    const needsRecreation = this._paramRequiresRecreation(node.type, param, value, node);
    if (needsRecreation) {
      this._recreateAudioNode(nodeId);
      return;
    }

    // Update audio node in real-time
    if (node.audioNode) {
      this._applyParamToAudioNode(node, param, value);
    }
  },

  // Check if a param change requires full node recreation
  _paramRequiresRecreation: function(type, param, value, node) {
    // toneGenerator: mode switch between oscillator/noise
    if (type === 'toneGenerator' && param === 'mode') {
      return true;
    }
    // toneGenerator: noise type change when in noise mode
    if (type === 'toneGenerator' && param === 'noiseType' && node.params.mode === 'noise') {
      return true;
    }
    // effects: effect type change
    if (type === 'effects' && param === 'type') {
      return true;
    }
    // effects: reverb decay requires recreation (new impulse response)
    if (type === 'effects' && param === 'decay' && node.params.type === 'reverb') {
      return true;
    }
    return false;
  },

  // Apply a parameter change to the audio node
  _applyParamToAudioNode: function(node, param, value) {
    const audioNode = node.audioNode;
    if (!audioNode) return;

    switch (param) {
      case 'frequency':
        if (audioNode.frequency) {
          audioNode.frequency.setValueAtTime(value, this.ctx.currentTime);
        }
        // For toneGenerator, frequency is on the internal oscillator
        if (audioNode._oscillator?.frequency) {
          audioNode._oscillator.frequency.setValueAtTime(value, this.ctx.currentTime);
        }
        break;
      case 'gain':
        if (audioNode.gain) {
          audioNode.gain.setValueAtTime(value, this.ctx.currentTime);
        }
        break;
      case 'Q':
        if (audioNode.Q) {
          audioNode.Q.setValueAtTime(value, this.ctx.currentTime);
        }
        break;
      case 'detune':
        if (audioNode.detune) {
          audioNode.detune.setValueAtTime(value, this.ctx.currentTime);
        }
        if (audioNode._oscillator?.detune) {
          audioNode._oscillator.detune.setValueAtTime(value, this.ctx.currentTime);
        }
        break;
      case 'waveform':
        // For toneGenerator oscillator mode
        if (audioNode._oscillator) {
          audioNode._oscillator.type = value;
        }
        // For LFO
        if (audioNode.type !== undefined && node.type === 'lfo') {
          audioNode.type = value;
        }
        break;
      case 'mode':
        // Filter mode (lpf/hpf/bpf) - can change without recreation
        if (node.type === 'filter' && audioNode.type !== undefined) {
          const filterTypeMap = { 'lpf': 'lowpass', 'hpf': 'highpass', 'bpf': 'bandpass' };
          audioNode.type = filterTypeMap[value] || 'lowpass';
        }
        break;
      case 'delayTime':
        if (audioNode._delay?.delayTime) {
          audioNode._delay.delayTime.setValueAtTime(value, this.ctx.currentTime);
        }
        break;
      case 'feedback':
        if (audioNode._feedback?.gain) {
          audioNode._feedback.gain.setValueAtTime(value, this.ctx.currentTime);
        }
        break;
      case 'mix':
        if (audioNode._dry?.gain && audioNode._wet?.gain) {
          audioNode._dry.gain.setValueAtTime(1 - value, this.ctx.currentTime);
          audioNode._wet.gain.setValueAtTime(value, this.ctx.currentTime);
        }
        break;
      case 'rate':
        if (audioNode.frequency) {
          audioNode.frequency.setValueAtTime(value, this.ctx.currentTime);
        }
        // For chorus LFO
        if (audioNode._chorusLfo?.frequency) {
          audioNode._chorusLfo.frequency.setValueAtTime(value, this.ctx.currentTime);
        }
        break;
      case 'depth':
        // For chorus depth
        if (audioNode._chorusLfoGain?.gain) {
          audioNode._chorusLfoGain.gain.setValueAtTime(value * 0.01, this.ctx.currentTime);
        }
        break;
      case 'decay':
        // Reverb decay requires recreation
        // Handled by _paramRequiresRecreation for now
        break;
      case 'speed':
        // For sampler nodes
        if (audioNode._source?.playbackRate) {
          audioNode._source.playbackRate.setValueAtTime(value, this.ctx.currentTime);
        } else if (audioNode.playbackRate) {
          audioNode.playbackRate.setValueAtTime(value, this.ctx.currentTime);
        }
        break;
      case 'loop':
        if (node.type === 'sampler') {
          this._startSamplerPlayback(node.id);
        } else if (audioNode.loop !== undefined) {
          audioNode.loop = value;
        }
        break;
    }
  },

  // Recreate an audio node while preserving connections
  _recreateAudioNode: function(nodeId) {
    const node = this.nodes[nodeId];
    if (!node) return;

    // Store current connections from the connections array
    const incomingConnections = this.connections.filter(c => c.toNode === nodeId);
    const outgoingConnections = this.connections.filter(c => c.fromNode === nodeId);

    // Disconnect and cleanup old audio node
    if (node.audioNode) {
      try {
        // Stop oscillators/sources
        if (node.audioNode._oscillator) {
          node.audioNode._oscillator.stop();
          node.audioNode._oscillator.disconnect();
        }
        if (node.audioNode._noiseSource) {
          node.audioNode._noiseSource.stop();
          node.audioNode._noiseSource.disconnect();
        }
        if (node.audioNode._chorusLfo) {
          node.audioNode._chorusLfo.stop();
          node.audioNode._chorusLfo.disconnect();
        }
        node.audioNode.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }

    // Create new audio node with current params
    node.audioNode = this._createAudioNode(node.type, node.params);

    // Restore incoming connections (other nodes -> this node)
    for (const conn of incomingConnections) {
      const fromNode = this.nodes[conn.fromNode];
      if (fromNode?.audioNode && node.audioNode) {
        this._connectAudioNodes(fromNode, node, conn.toInput);
      }
    }

    // Restore outgoing connections (this node -> other nodes)
    for (const conn of outgoingConnections) {
      const toNode = this.nodes[conn.toNode];
      if (node.audioNode && toNode?.audioNode) {
        this._connectAudioNodes(node, toNode, conn.toInput);
      }
    }
  },

  // Helper to connect audio nodes with proper routing
  _connectAudioNodes: function(fromNode, toNode, toInput) {
    if (!fromNode.audioNode || !toNode.audioNode) return;

    try {
      // Get the actual target for the connection
      const target = this._getConnectionTarget(toNode, toInput);
      if (target) {
        fromNode.audioNode.connect(target);
      }
    } catch (e) {
      // Connection may not be valid
    }
  },

  // Get the correct audio node/param to connect to based on input name
  _getConnectionTarget: function(toNode, toInput) {
    const audioNode = toNode.audioNode;
    if (!audioNode) return null;

    switch (toInput) {
      case 'audio':
        // For effects, connect to the input gain
        if (audioNode._input) {
          return audioNode._input;
        }
        return audioNode;

      case 'frequency':
        // For toneGenerator, frequency is on the internal oscillator
        if (audioNode._oscillator?.frequency) {
          return audioNode._oscillator.frequency;
        }
        if (audioNode.frequency) {
          return audioNode.frequency;
        }
        return null;

      case 'detune':
        if (audioNode._oscillator?.detune) {
          return audioNode._oscillator.detune;
        }
        if (audioNode.detune) {
          return audioNode.detune;
        }
        return null;

      case 'gain':
        if (audioNode.gain) {
          return audioNode.gain;
        }
        return null;

      case 'Q':
        if (audioNode.Q) {
          return audioNode.Q;
        }
        return null;

      case 'mix':
        // For effects mix control
        if (audioNode._wet?.gain) {
          return audioNode._wet.gain;
        }
        return null;

      case 'delayTime':
        if (audioNode._delay?.delayTime) {
          return audioNode._delay.delayTime;
        }
        return null;

      case 'feedback':
        if (audioNode._feedback?.gain) {
          return audioNode._feedback.gain;
        }
        return null;

      default:
        // For modulator connections to any param, just return the node
        return audioNode;
    }
  },

  // Update data from EEG/CV
  updateData: function(dataType, values) {
    if (dataType === 'bands') {
      this.data.bands = { ...this.data.bands, ...values };
    } else if (dataType === 'cv') {
      this.data.cv = { ...this.data.cv, ...values };
    } else if (dataType === 'gaze') {
      this.data.gaze = values;
    } else if (dataType === 'hands') {
      this.data.hands = values;
    } else if (dataType === 'engagement') {
      this.data.engagement = values;
    }

    // Update EEG/CV modulator nodes
    this._updateModulators();
  },

  // Push time series data into visualization buffers
  pushTimeSeries: function(channelData) {
    if (!channelData || !Array.isArray(channelData)) return;

    const maxPoints = this.vizData.timeSeries.maxPoints;

    channelData.forEach((samples, chIndex) => {
      if (chIndex >= this.vizData.timeSeries.channels.length) return;

      const buffer = this.vizData.timeSeries.channels[chIndex];

      // Add new samples
      if (Array.isArray(samples)) {
        buffer.push(...samples);
      }

      // Trim to max points
      while (buffer.length > maxPoints) {
        buffer.shift();
      }
    });
  },

  // Push FFT data into visualization buffers
  pushFFT: function(freqs, psdData) {
    if (!psdData || !Array.isArray(psdData)) return;

    this.vizData.fft.freqs = freqs || [];

    psdData.forEach((psd, chIndex) => {
      if (chIndex >= this.vizData.fft.psd.length) return;
      this.vizData.fft.psd[chIndex] = psd || [];
    });
  },

  // Update modulator nodes with current data
  _updateModulators: function() {
    // Step 1: Update all source modulators with 0-1 values
    for (const [id, node] of Object.entries(this.nodes)) {
      const smoothing = node.params?.smoothing || 0.1;

      // ============ FACE MODULATOR ============
      if (node.type === 'face') {
        // Multi-output face tracking modulator
        const applySmooth = (newVal, prevVal) => {
          if (prevVal !== undefined && smoothing > 0) {
            return prevVal * smoothing + newVal * (1 - smoothing);
          }
          return newVal;
        };

        node.outputs = node.outputs || {};
        node.outputs.mouth = applySmooth(
          this.data.cv['mouth_openness'] || this.data.cv['mouth'] || 0,
          node.outputs.mouth
        );
        node.outputs.smile = applySmooth(
          this.data.cv['smile_curvature'] || this.data.cv['smile'] || 0,
          node.outputs.smile
        );
        node.outputs.yaw = applySmooth(
          (this.data.cv['head_yaw'] || 0) + 0.5, // Normalize -0.5 to 0.5 -> 0 to 1
          node.outputs.yaw
        );
        node.outputs.roll = applySmooth(
          this.data.cv['head_roll_relative'] || this.data.cv['roll'] || 0,
          node.outputs.roll
        );
        node.outputs.brow = applySmooth(
          this.data.cv['brow_raise'] || this.data.cv['brow'] || 0,
          node.outputs.brow
        );
        // Primary output is mouth openness
        node.outputValue = node.outputs.mouth;
      }

      // ============ HANDS MODULATOR ============
      else if (node.type === 'hands') {
        const leftHand = this.data.hands?.left;
        const rightHand = this.data.hands?.right;

        node.outputs = node.outputs || {};
        node.outputs.leftX = leftHand?.detected ? (leftHand.palm_x || 0.5) : 0.5;
        node.outputs.leftY = leftHand?.detected ? (leftHand.palm_y || 0.5) : 0.5;
        node.outputs.leftPinch = leftHand?.detected ? (leftHand.pinch_distance || 0) : 0;
        node.outputs.leftOpen = leftHand?.detected ? (leftHand.openness || 0) : 0;
        node.outputs.rightX = rightHand?.detected ? (rightHand.palm_x || 0.5) : 0.5;
        node.outputs.rightY = rightHand?.detected ? (rightHand.palm_y || 0.5) : 0.5;
        node.outputs.rightPinch = rightHand?.detected ? (rightHand.pinch_distance || 0) : 0;
        node.outputs.rightOpen = rightHand?.detected ? (rightHand.openness || 0) : 0;
        // Primary output is max pinch
        node.outputValue = Math.max(node.outputs.leftPinch, node.outputs.rightPinch);
      }

      // ============ EEG MODULATOR (unified bands/timeseries/fft) ============
      else if (node.type === 'eeg') {
        const mode = node.params.mode || 'bands';
        let value = 0;

        if (mode === 'bands') {
          const band = node.params.band || 'alpha';
          value = (this.data.bands[band] || 0) / 100;
        } else if (mode === 'timeseries') {
          const channel = (node.params.channel || 1) - 1;
          const metric = node.params.metric || 'amplitude';
          const buffer = this.vizData.timeSeries.channels[channel] || [];

          if (buffer.length > 0) {
            if (metric === 'amplitude') {
              value = Math.abs(buffer[buffer.length - 1] || 0) / 100;
            } else if (metric === 'rms') {
              const recent = buffer.slice(-50);
              const sumSq = recent.reduce((sum, s) => sum + s * s, 0);
              value = Math.sqrt(sumSq / recent.length) / 100;
            } else if (metric === 'peak') {
              const recent = buffer.slice(-50);
              value = Math.max(...recent.map(Math.abs)) / 100;
            } else if (metric === 'mean') {
              const recent = buffer.slice(-50);
              value = Math.abs(recent.reduce((sum, s) => sum + s, 0) / recent.length) / 100;
            }
          }
        } else if (mode === 'fft') {
          const channel = (node.params.channel || 1) - 1;
          const fftBin = node.params.fftBin || 10;
          const psd = this.vizData.fft.psd[channel] || [];
          if (psd.length > fftBin) {
            value = Math.min(psd[fftBin] / 100, 1);
          }
        }

        // Clamp and smooth
        value = Math.max(0, Math.min(1, value));
        if (node.outputValue !== undefined && smoothing > 0) {
          value = node.outputValue * smoothing + value * (1 - smoothing);
        }
        node.outputValue = value;
      }

      // ============ EYES MODULATOR ============
      else if (node.type === 'eyes') {
        node.outputs = node.outputs || {};
        node.outputs.x = (this.data.gaze.x + 1) / 2; // -1 to 1 -> 0 to 1
        node.outputs.y = (this.data.gaze.y + 1) / 2;
        node.outputs.confidence = this.data.gaze.confidence || 0;
        node.outputValue = node.outputs.confidence;
      }

      // ============ LFO MODULATOR ============
      else if (node.type === 'lfo') {
        // LFO runs via Web Audio, just expose the current phase
        const rate = node.params.rate || 1;
        const depth = node.params.depth || 1;
        const time = this.ctx ? this.ctx.currentTime : 0;
        const phase = (time * rate) % 1;

        let value = 0;
        const waveform = node.params.waveform || 'sine';
        if (waveform === 'sine') {
          value = (Math.sin(phase * Math.PI * 2) + 1) / 2;
        } else if (waveform === 'square') {
          value = phase < 0.5 ? 1 : 0;
        } else if (waveform === 'sawtooth') {
          value = phase;
        } else if (waveform === 'triangle') {
          value = phase < 0.5 ? phase * 2 : 2 - phase * 2;
        }
        node.outputValue = value * depth;
      }

      // ============ OSC SENDER ============
      else if (node.type === 'osc') {
        const inputConn = this.connections.find(c => c.toNode === id && c.toInput === 'value');
        if (inputConn) {
          const sourceNode = this.nodes[inputConn.fromNode];
          if (sourceNode) {
            const rawValue = this._getOutputValue(sourceNode, inputConn.fromOutput);
            const scaledValue = rawValue * (node.params.scale || 1);
            if (Math.abs(scaledValue - (node._lastSent || 0)) > 0.001) {
              node._lastSent = scaledValue;
              this.sendOSC(node.params.address, scaledValue, node.params.ip, node.params.port);
            }
          }
        }
      }

      // ============ MIDI SENDER (unified CC/Note) ============
      else if (node.type === 'midi') {
        const mode = node.params.mode || 'cc';

        if (mode === 'cc') {
          const inputConn = this.connections.find(c => c.toNode === id && c.toInput === 'value');
          if (inputConn) {
            const sourceNode = this.nodes[inputConn.fromNode];
            if (sourceNode) {
              const rawValue = this._getOutputValue(sourceNode, inputConn.fromOutput);
              const value = Math.round(rawValue * 127);
              const clampedValue = Math.max(0, Math.min(127, value));
              if (clampedValue !== node._lastSent) {
                node._lastSent = clampedValue;
                this.sendMIDICC(node.params.cc, clampedValue, node.params.channel);
              }
            }
          }
        } else if (mode === 'note') {
          const triggerConn = this.connections.find(c => c.toNode === id && c.toInput === 'trigger');
          let triggerValue = 0;

          if (triggerConn) {
            const sourceNode = this.nodes[triggerConn.fromNode];
            if (sourceNode) {
              triggerValue = this._getOutputValue(sourceNode, triggerConn.fromOutput);
            }
          }

          const prevTrigger = node._prevTrigger || 0;
          node._prevTrigger = triggerValue;

          if (triggerValue > 0.5 && prevTrigger <= 0.5) {
            const velocity = Math.max(1, Math.min(127, node.params.velocity || 100));
            this.sendMIDINote(node.params.note, velocity, node.params.channel, node.params.duration);
          }
        }
      }

      // ============ EEG VISUALIZER ============
      else if (node.type === 'eegViz') {
        // Connect to EEG modulator if linked
        const inputConn = this.connections.find(c => c.toNode === id && c.toInput === 'eegSignal');
        if (inputConn) {
          const sourceNode = this.nodes[inputConn.fromNode];
          if (sourceNode && sourceNode.type === 'eeg') {
            // Mirror the EEG node's mode for visualization
            node._linkedEegMode = sourceNode.params.mode;
            node._linkedChannel = sourceNode.params.channel;
          }
        }
        // Store band values for visualization
        node.bandValues = {
          delta: (this.data.bands.delta || 0) / 100,
          theta: (this.data.bands.theta || 0) / 100,
          alpha: (this.data.bands.alpha || 0) / 100,
          beta: (this.data.bands.beta || 0) / 100,
          gamma: (this.data.bands.gamma || 0) / 100
        };
      }

      // ============ CV VISUALIZER ============
      else if (node.type === 'cvViz') {
        // Store all CV values for overlay display
        node.cvValues = {
          mouth: this.data.cv['mouth_openness'] || this.data.cv['mouth'] || 0,
          smile: this.data.cv['smile_curvature'] || this.data.cv['smile'] || 0,
          yaw: this.data.cv['head_yaw'] || 0,
          roll: this.data.cv['head_roll_relative'] || 0,
          brow: this.data.cv['brow_raise'] || 0,
          gazeX: this.data.gaze.x || 0,
          gazeY: this.data.gaze.y || 0
        };
        node.handsData = this.data.hands;
      }
    }

    // Step 2: Propagate through scale nodes
    for (const [id, node] of Object.entries(this.nodes)) {
      if (node.type === 'scale') {
        const inputConn = this.connections.find(c => c.toNode === id);
        if (inputConn) {
          const sourceNode = this.nodes[inputConn.fromNode];
          if (sourceNode) {
            const rawValue = this._getOutputValue(sourceNode, inputConn.fromOutput);
            const min = node.params.min;
            const max = node.params.max;
            node.outputValue = min + rawValue * (max - min);
          }
        }
      }
    }

    // Step 3: Apply all modulations to targets
    for (const [id, node] of Object.entries(this.nodes)) {
      if (node.outputValue !== undefined || node.outputs) {
        this._applyModulation(node);
      }
    }
  },

  // Helper to get output value from a node (supports multi-output nodes)
  _getOutputValue: function(node, outputName) {
    if (node.outputs && outputName && node.outputs[outputName] !== undefined) {
      return node.outputs[outputName];
    }
    return node.outputValue || 0;
  },

  // Apply modulation from modulator nodes
  _applyModulation: function(modulatorNode) {
    const connections = this.connections.filter(c => c.fromNode === modulatorNode.id);

    for (const conn of connections) {
      const targetNode = this.nodes[conn.toNode];
      if (!targetNode) continue;

      if (targetNode.type === 'scale') continue;

      // Get value from the specific output port (supports multi-output nodes)
      const value = this._getOutputValue(modulatorNode, conn.fromOutput);
      const input = conn.toInput;
      const isFromRange = modulatorNode.type === 'scale';
      const nodeType = this.nodeTypes[targetNode.type];
      const isVisualNode = nodeType && nodeType.category === 'visual';
      const isAICanvas = targetNode.type === 'aiCanvas';

      // Handle AI Canvas dynamic parameters
      if (isAICanvas && targetNode.aiParameters) {
        const aiParam = targetNode.aiParameters.find(p => p.name === input);
        if (aiParam) {
          targetNode.params[input] = isFromRange ? value :
            aiParam.min + value * (aiParam.max - aiParam.min);
        }
        continue;
      }

      if (isVisualNode) {
        if (input in targetNode.params) {
          const paramConfig = nodeType.params[input];
          if (paramConfig && paramConfig.min !== undefined) {
            targetNode.params[input] = isFromRange ? value :
              paramConfig.min + value * (paramConfig.max - paramConfig.min);
          } else {
            targetNode.params[input] = value;
          }
        }
        continue;
      }

      if (!targetNode.audioNode) continue;

      // Handle toneGenerator's internal oscillator
      if (targetNode.type === 'toneGenerator' && targetNode.audioNode._oscillator) {
        if (input === 'frequency') {
          const freq = isFromRange ? value : (100 + value * 2000);
          targetNode.audioNode._oscillator.frequency?.setValueAtTime(freq, this.ctx.currentTime);
        } else if (input === 'detune') {
          const detune = isFromRange ? value : (value * 1200 - 600);
          targetNode.audioNode._oscillator.detune?.setValueAtTime(detune, this.ctx.currentTime);
        } else if (input === 'gain') {
          const gain = isFromRange ? value : value;
          targetNode.audioNode.gain?.setValueAtTime(Math.min(gain, 2), this.ctx.currentTime);
        }
        continue;
      }

      if (input === 'frequency') {
        const freq = isFromRange ? value : (100 + value * 2000);
        targetNode.audioNode.frequency?.setValueAtTime(freq, this.ctx.currentTime);
      } else if (input === 'gain') {
        const gain = isFromRange ? value : value;
        targetNode.audioNode.gain?.setValueAtTime(Math.min(gain, 2), this.ctx.currentTime);
      } else if (input === 'Q') {
        const q = isFromRange ? value : (0.5 + value * 10);
        targetNode.audioNode.Q?.setValueAtTime(q, this.ctx.currentTime);
      } else if (input === 'detune') {
        const detune = isFromRange ? value : (value * 1200 - 600);
        targetNode.audioNode.detune?.setValueAtTime(detune, this.ctx.currentTime);
      } else if (input === 'speed') {
        const speed = isFromRange ? value : (0.25 + value * 3.75);
        if (targetNode.audioNode._source?.playbackRate) {
          targetNode.audioNode._source.playbackRate.setValueAtTime(speed, this.ctx.currentTime);
        } else if (targetNode.audioNode.playbackRate) {
          targetNode.audioNode.playbackRate.setValueAtTime(speed, this.ctx.currentTime);
        }
      } else if (input === 'mix' && targetNode.audioNode._wet && targetNode.audioNode._dry) {
        // Effects mix
        targetNode.audioNode._wet.gain.setValueAtTime(value, this.ctx.currentTime);
        targetNode.audioNode._dry.gain.setValueAtTime(1 - value, this.ctx.currentTime);
      }
    }
  },

  // Get all visual nodes for rendering
  getVisualNodes: function() {
    const visualNodes = [];
    for (const [id, node] of Object.entries(this.nodes)) {
      const nodeType = this.nodeTypes[node.type];
      if (nodeType && (nodeType.category === 'visual' || nodeType.category === 'visual_output')) {
        visualNodes.push({ id, ...node });
      }
    }
    return visualNodes;
  },

  // Get only visual nodes connected to the canvas
  getConnectedVisualNodes: function() {
    const canvasNode = this.getCanvasNode();
    if (!canvasNode) {
      console.log('[AudioEngine] No canvas/output node found');
      return [];
    }

    // Debug: log connections (throttled)
    if (!this._lastConnLog || Date.now() - this._lastConnLog > 2000) {
      console.log('[AudioEngine] Canvas/Output node:', canvasNode.id, canvasNode.type);
      console.log('[AudioEngine] All connections:', this.connections);
      this._lastConnLog = Date.now();
    }

    // Find all nodes connected to canvas/output (trace back through 'draw' or 'visual' connections)
    const connectedIds = new Set();

    const traceConnections = (nodeId) => {
      // Find all connections where this node is the target
      for (const conn of this.connections) {
        // Check for both 'draw' (canvas) and 'visual' (output) inputs
        if (conn.toNode === nodeId && (conn.toInput === 'draw' || conn.toInput === 'visual')) {
          const fromNode = this.nodes[conn.fromNode];
          if (fromNode) {
            const nodeType = this.nodeTypes[fromNode.type];
            console.log('[AudioEngine] Found visual connection:', conn.fromNode, '->', conn.toNode, 'type:', fromNode.type, 'category:', nodeType?.category);
            if (nodeType && nodeType.category === 'visual') {
              connectedIds.add(conn.fromNode);
              // Recursively trace (for transform nodes that chain)
              traceConnections(conn.fromNode);
            }
          }
        }
      }
    };

    traceConnections(canvasNode.id);

    // Return the connected nodes
    const result = [];
    for (const id of connectedIds) {
      const node = this.nodes[id];
      if (node) {
        result.push({ id, ...node });
      }
    }
    return result;
  },

  // Get canvas/output node for visual rendering
  getCanvasNode: function() {
    // First look for unified output node
    for (const [id, node] of Object.entries(this.nodes)) {
      if (node.type === 'output') {
        return { id, ...node, isUnifiedOutput: true };
      }
    }
    // Fallback to legacy canvas node
    for (const [id, node] of Object.entries(this.nodes)) {
      if (node.type === 'canvas') {
        return { id, ...node };
      }
    }
    return null;
  },

  // Get the output node
  getOutputNode: function() {
    for (const [id, node] of Object.entries(this.nodes)) {
      if (node.type === 'output') {
        return { id, ...node };
      }
    }
    return null;
  },

  // ============ AI CANVAS METHODS ============

  // Generate p5.js code from a text prompt
  generateAICanvas: async function(nodeId, prompt) {
    const node = this.nodes[nodeId];
    if (!node || node.type !== 'aiCanvas') return null;

    // Get color settings from node params
    const backgroundColor = node.params?.background || '#0d1117';

    // Get previous code for context-aware iteration
    const previousCode = node.aiCode || null;
    const previousPrompt = node.aiPrompt || null;

    try {
      const response = await fetch('/api/ai/generate-visual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          backgroundColor,
          previousCode,
          previousPrompt
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate visual');
      }

      const result = await response.json();

      if (result.code) {
        // Store the generated code
        node.aiCode = result.code;
        node.aiPrompt = prompt;

        // Extract parameters
        const params = await this.extractAIParameters(nodeId, result.code);
        node.aiParameters = params || [];

        // Add dynamic inputs based on extracted parameters
        node.aiParameters.forEach(param => {
          node.params[param.name] = param.default;
        });

        // Save to version history
        const snapshot = {
          prompt: prompt,
          code: result.code,
          parameters: node.aiParameters,
          backgroundColor: node.params?.background || '#0d1117',
          timestamp: Date.now()
        };

        if (!node.aiHistory) node.aiHistory = [];
        node.aiHistory.push(snapshot);

        // Limit to 10 versions (remove oldest if exceeded)
        if (node.aiHistory.length > 10) {
          node.aiHistory.shift();
        }

        // Set index to latest version
        node.aiHistoryIndex = node.aiHistory.length - 1;

        return { status: 'ok', code: result.code, parameters: node.aiParameters };
      } else if (result.message) {
        return { status: 'error', message: result.message };
      }
    } catch (err) {
      console.error('AI Canvas generation error:', err);
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'Unknown error' };
  },

  // Extract controllable parameters from p5.js code
  extractAIParameters: async function(nodeId, code) {
    try {
      const response = await fetch('/api/ai/extract-parameters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });

      if (!response.ok) {
        throw new Error('Failed to extract parameters');
      }

      const result = await response.json();
      return result.parameters || [];
    } catch (err) {
      console.error('Parameter extraction error:', err);
    }
    return [];
  },

  // ============ AI CANVAS HISTORY METHODS ============

  // Navigate to previous version in history
  aiCanvasHistoryPrev: function(nodeId) {
    const node = this.nodes[nodeId];
    if (!node || !node.aiHistory || node.aiHistory.length === 0) return false;

    if (node.aiHistoryIndex > 0) {
      node.aiHistoryIndex--;
      this._restoreAICanvasVersion(nodeId);
      return true;
    }
    return false;
  },

  // Navigate to next version in history
  aiCanvasHistoryNext: function(nodeId) {
    const node = this.nodes[nodeId];
    if (!node || !node.aiHistory) return false;

    if (node.aiHistoryIndex < node.aiHistory.length - 1) {
      node.aiHistoryIndex++;
      this._restoreAICanvasVersion(nodeId);
      return true;
    }
    return false;
  },

  // Restore a version from history
  _restoreAICanvasVersion: function(nodeId) {
    const node = this.nodes[nodeId];
    const snapshot = node.aiHistory[node.aiHistoryIndex];
    if (!snapshot) return;

    // Restore state from snapshot
    node.aiCode = snapshot.code;
    node.aiPrompt = snapshot.prompt;
    node.aiParameters = snapshot.parameters;
    node.params.prompt = snapshot.prompt;
    node.params.background = snapshot.backgroundColor;

    // Update inputs from parameters
    node.inputs = snapshot.parameters.map(p => p.name);

    // Reset parameter values to defaults
    snapshot.parameters.forEach(param => {
      node.params[param.name] = param.default;
    });

    // Reset visual renderer state to reinitialize with new code
    if (typeof VisualRenderer !== 'undefined') {
      delete VisualRenderer.aiCanvasInitialized[nodeId];
      delete VisualRenderer.aiCanvasDrawFunctions[nodeId];
    }

    console.log(`[AudioEngine] Restored AI Canvas to version ${node.aiHistoryIndex + 1}`);
  },

  // Get history info for UI display
  getAICanvasHistoryInfo: function(nodeId) {
    const node = this.nodes[nodeId];
    if (!node || !node.aiHistory || node.aiHistory.length === 0) {
      return { total: 0, current: 0, hasHistory: false, canPrev: false, canNext: false };
    }
    return {
      total: node.aiHistory.length,
      current: node.aiHistoryIndex + 1,
      hasHistory: node.aiHistory.length > 1,
      canPrev: node.aiHistoryIndex > 0,
      canNext: node.aiHistoryIndex < node.aiHistory.length - 1
    };
  },

  // Update AI Canvas code directly (for manual editing)
  updateAICanvasCode: async function(nodeId, newCode) {
    const node = this.nodes[nodeId];
    if (!node || node.type !== 'aiCanvas') return { status: 'error', message: 'Invalid node' };

    try {
      // Update the code
      node.aiCode = newCode;

      // Re-extract parameters from the new code
      const params = await this.extractAIParameters(nodeId, newCode);
      node.aiParameters = params || [];

      // Update inputs
      node.inputs = node.aiParameters.map(p => p.name);

      // Reset parameter values to defaults
      node.aiParameters.forEach(param => {
        node.params[param.name] = param.default;
      });

      // Save to history as a manual edit
      const snapshot = {
        prompt: node.aiPrompt || '(manual edit)',
        code: newCode,
        parameters: node.aiParameters,
        backgroundColor: node.params?.background || '#0d1117',
        timestamp: Date.now()
      };

      if (!node.aiHistory) node.aiHistory = [];
      node.aiHistory.push(snapshot);

      if (node.aiHistory.length > 10) {
        node.aiHistory.shift();
      }

      node.aiHistoryIndex = node.aiHistory.length - 1;

      // Reset visual renderer state
      if (typeof VisualRenderer !== 'undefined') {
        delete VisualRenderer.aiCanvasInitialized[nodeId];
        delete VisualRenderer.aiCanvasDrawFunctions[nodeId];
      }

      return { status: 'ok', parameters: node.aiParameters };
    } catch (err) {
      console.error('Error updating AI Canvas code:', err);
      return { status: 'error', message: err.message };
    }
  },

  // Execute AI Canvas in a container element
  executeAICanvas: function(nodeId, containerElement) {
    const node = this.nodes[nodeId];
    if (!node || !node.aiCode) return null;

    // Clean up existing instance
    if (this.aiCanvasInstances[nodeId]) {
      this.aiCanvasInstances[nodeId].remove();
      delete this.aiCanvasInstances[nodeId];
    }

    const self = this;

    // Create wrapper that injects parameter access
    const wrappedSketch = function(p) {
      // Inject getParam function for dynamic parameter access
      p.getParam = function(name) {
        const n = self.nodes[nodeId];
        if (n && n.params && name in n.params) {
          return n.params[name];
        }
        // Check AI parameters for defaults
        if (n && n.aiParameters) {
          const aiParam = n.aiParameters.find(ap => ap.name === name);
          if (aiParam) return aiParam.default;
        }
        return 0;
      };

      // Execute the user's generated code
      try {
        const userSketch = new Function('p', `
          return (${node.aiCode})(p);
        `);
        userSketch(p);
      } catch (err) {
        console.error('AI Canvas execution error:', err);
        // Fallback to error display
        p.setup = function() {
          p.createCanvas(containerElement.offsetWidth || 400, containerElement.offsetHeight || 300);
          p.background(20);
          p.fill(255, 100, 100);
          p.textAlign(p.CENTER);
          p.text('Error in generated code', p.width/2, p.height/2);
        };
      }
    };

    // Create p5 instance
    this.aiCanvasInstances[nodeId] = new p5(wrappedSketch, containerElement);
    return this.aiCanvasInstances[nodeId];
  },

  // Stop and remove AI Canvas instance
  stopAICanvas: function(nodeId) {
    if (this.aiCanvasInstances[nodeId]) {
      this.aiCanvasInstances[nodeId].remove();
      delete this.aiCanvasInstances[nodeId];
    }
  },

  // Get all AI Canvas nodes
  getAICanvasNodes: function() {
    const result = [];
    for (const [id, node] of Object.entries(this.nodes)) {
      if (node.type === 'aiCanvas') {
        result.push({ id, ...node });
      }
    }
    return result;
  },

  // Get analyzer data for visualization
  getAnalyzerData: function() {
    if (!this.analyzer) return null;
    const data = new Uint8Array(this.analyzer.frequencyBinCount);
    this.analyzer.getByteFrequencyData(data);
    return data;
  },

  // Save patch to JSON
  savePatch: function(name) {
    const patch = {
      name: name,
      nodes: {},
      connections: this.connections.slice()
    };

    for (const [id, node] of Object.entries(this.nodes)) {
      patch.nodes[id] = {
        type: node.type,
        x: node.x,
        y: node.y,
        params: { ...node.params }
      };
    }

    return patch;
  },

  // Load patch from JSON
  loadPatch: function(patch) {
    // Clear existing
    for (const id of Object.keys(this.nodes)) {
      this.deleteNode(id);
    }

    // Create nodes
    for (const [id, nodeData] of Object.entries(patch.nodes)) {
      const node = this.createNode(nodeData.type, nodeData.x, nodeData.y);
      if (node) {
        for (const [param, value] of Object.entries(nodeData.params)) {
          this.setParam(node.id, param, value);
        }
      }
    }

    // Create connections
    for (const conn of patch.connections) {
      this.connect(conn.fromNode, conn.fromOutput, conn.toNode, conn.toInput);
    }
  },

  // Cleanup
  destroy: function() {
    for (const id of Object.keys(this.nodes)) {
      this.deleteNode(id);
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioEngine;
}
