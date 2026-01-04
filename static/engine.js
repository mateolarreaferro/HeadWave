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
    gaze: { x: 0, y: 0 },
    hands: { left: null, right: null },
    engagement: 0
  },

  // Node type definitions
  nodeTypes: {
    // Sources
    oscillator: {
      name: 'Oscillator',
      category: 'source',
      inputs: ['frequency', 'detune'],
      outputs: ['audio'],
      params: {
        type: { default: 'sine', options: ['sine', 'square', 'sawtooth', 'triangle'] },
        frequency: { default: 440, min: 20, max: 2000 },
        detune: { default: 0, min: -1200, max: 1200 }
      }
    },
    noise: {
      name: 'Noise',
      category: 'source',
      inputs: [],
      outputs: ['audio'],
      params: {
        type: { default: 'white', options: ['white', 'pink', 'brown'] }
      }
    },
    sampler: {
      name: 'Sampler',
      category: 'source',
      inputs: ['speed'],
      outputs: ['audio'],
      params: {
        speed: { default: 1, min: 0.1, max: 4 },
        loop: { default: true, options: [true, false] }
      }
    },

    // Processors
    filter: {
      name: 'Filter',
      category: 'processor',
      inputs: ['audio', 'frequency', 'Q'],
      outputs: ['audio'],
      params: {
        type: { default: 'lowpass', options: ['lowpass', 'highpass', 'bandpass', 'notch'] },
        frequency: { default: 1000, min: 20, max: 20000 },
        Q: { default: 1, min: 0.1, max: 20 }
      }
    },
    gain: {
      name: 'Gain',
      category: 'processor',
      inputs: ['audio', 'gain'],
      outputs: ['audio'],
      params: {
        gain: { default: 0.5, min: 0, max: 2 }
      }
    },
    delay: {
      name: 'Delay',
      category: 'processor',
      inputs: ['audio', 'time'],
      outputs: ['audio'],
      params: {
        time: { default: 0.3, min: 0, max: 2 },
        feedback: { default: 0.3, min: 0, max: 0.95 }
      }
    },
    reverb: {
      name: 'Reverb',
      category: 'processor',
      inputs: ['audio'],
      outputs: ['audio'],
      params: {
        decay: { default: 2, min: 0.1, max: 10 },
        wet: { default: 0.3, min: 0, max: 1 }
      }
    },

    // Modulators
    lfo: {
      name: 'LFO',
      category: 'modulator',
      inputs: ['rate'],
      outputs: ['signal'],
      params: {
        type: { default: 'sine', options: ['sine', 'square', 'sawtooth', 'triangle'] },
        rate: { default: 1, min: 0.01, max: 20 },
        depth: { default: 1, min: 0, max: 1 }
      }
    },
    eegBand: {
      name: 'EEG Band',
      category: 'modulator',
      inputs: [],
      outputs: ['signal'],
      params: {
        band: { default: 'alpha', options: ['delta', 'theta', 'alpha', 'beta', 'gamma'] },
        smoothing: { default: 0.1, min: 0, max: 1 }
      }
    },
    cvFeature: {
      name: 'CV Feature',
      category: 'modulator',
      inputs: [],
      outputs: ['signal'],
      params: {
        feature: { default: 'mouth', options: ['mouth', 'yaw', 'roll', 'smile', 'gaze_x', 'gaze_y', 'engagement'] },
        smoothing: { default: 0.1, min: 0, max: 1 }
      }
    },
    handFeature: {
      name: 'Hand Feature',
      category: 'modulator',
      inputs: [],
      outputs: ['signal'],
      params: {
        hand: { default: 'left', options: ['left', 'right'] },
        feature: { default: 'detected', options: ['detected', 'pinch', 'openness', 'x', 'y', 'z'] },
        smoothing: { default: 0.1, min: 0, max: 1 }
      }
    },
    scale: {
      name: 'Range',
      category: 'processor',
      inputs: ['signal'],
      outputs: ['signal'],
      params: {
        min: { default: 200, min: 0, max: 20000 },
        max: { default: 800, min: 0, max: 20000 }
      }
    },

    // Output
    output: {
      name: 'Output',
      category: 'output',
      inputs: ['audio'],
      outputs: [],
      params: {}
    },

    // Visual nodes
    canvas: {
      name: 'Canvas',
      category: 'visual_output',
      inputs: ['draw'],
      outputs: [],
      params: {
        background: { default: '#0d1117' },
        trails: { default: 0, min: 0, max: 100 }
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
        fill: { default: '#ffffff' },
        stroke: { default: 'none' },
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
        fill: { default: '#ffffff' },
        stroke: { default: 'none' },
        strokeWeight: { default: 2, min: 0, max: 20 }
      }
    },
    line: {
      name: 'Line',
      category: 'visual',
      inputs: ['x1', 'y1', 'x2', 'y2', 'color'],
      outputs: ['draw'],
      params: {
        x1: { default: 0.25, min: 0, max: 1 },
        y1: { default: 0.5, min: 0, max: 1 },
        x2: { default: 0.75, min: 0, max: 1 },
        y2: { default: 0.5, min: 0, max: 1 },
        stroke: { default: '#ffffff' },
        strokeWeight: { default: 2, min: 0, max: 20 }
      }
    },
    polygon: {
      name: 'Polygon',
      category: 'visual',
      inputs: ['x', 'y', 'radius', 'color', 'rotation'],
      outputs: ['draw'],
      params: {
        x: { default: 0.5, min: 0, max: 1 },
        y: { default: 0.5, min: 0, max: 1 },
        radius: { default: 0.1, min: 0, max: 0.5 },
        sides: { default: 6, min: 3, max: 12 },
        rotation: { default: 0, min: 0, max: 360 },
        fill: { default: '#ffffff' },
        stroke: { default: 'none' },
        strokeWeight: { default: 2, min: 0, max: 20 }
      }
    },
    text: {
      name: 'Text',
      category: 'visual',
      inputs: ['x', 'y', 'color', 'size'],
      outputs: ['draw'],
      params: {
        text: { default: 'Hello' },
        x: { default: 0.5, min: 0, max: 1 },
        y: { default: 0.5, min: 0, max: 1 },
        size: { default: 32, min: 8, max: 200 },
        fill: { default: '#ffffff' },
        align: { default: 'center', options: ['left', 'center', 'right'] }
      }
    },
    color: {
      name: 'Color',
      category: 'visual',
      inputs: ['h', 's', 'b', 'a'],
      outputs: ['color'],
      params: {
        h: { default: 180, min: 0, max: 360 },
        s: { default: 70, min: 0, max: 100 },
        b: { default: 80, min: 0, max: 100 },
        a: { default: 255, min: 0, max: 255 }
      }
    },
    transform: {
      name: 'Transform',
      category: 'visual',
      inputs: ['draw', 'x', 'y', 'rotation', 'scale'],
      outputs: ['draw'],
      params: {
        x: { default: 0, min: -1, max: 1 },
        y: { default: 0, min: -1, max: 1 },
        rotation: { default: 0, min: 0, max: 360 },
        scale: { default: 1, min: 0.1, max: 5 }
      }
    },
    particles: {
      name: 'Particles',
      category: 'visual',
      inputs: ['x', 'y', 'color', 'speed', 'size'],
      outputs: ['draw'],
      params: {
        x: { default: 0.5, min: 0, max: 1 },
        y: { default: 0.5, min: 0, max: 1 },
        count: { default: 50, min: 1, max: 500 },
        size: { default: 5, min: 1, max: 50 },
        speed: { default: 1, min: 0, max: 5 },
        spread: { default: 0.2, min: 0, max: 1 },
        fill: { default: '#ffffff' },
        lifetime: { default: 2, min: 0.1, max: 10 }
      }
    }
  },

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

  // Start the audio engine (called when Enable Audio is checked)
  start: function() {
    if (!this.initialized) {
      this.init();
    }
    this.resume();
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
      case 'oscillator':
        const osc = this.ctx.createOscillator();
        osc.type = params.type;
        osc.frequency.value = params.frequency;
        osc.detune.value = params.detune;
        osc.start();
        return osc;

      case 'noise':
        return this._createNoiseNode(params.type);

      case 'sampler':
        return this._createSamplerNode(params, this.nodeCounter);

      case 'filter':
        const filter = this.ctx.createBiquadFilter();
        filter.type = params.type;
        filter.frequency.value = params.frequency;
        filter.Q.value = params.Q;
        return filter;

      case 'gain':
        const gain = this.ctx.createGain();
        gain.gain.value = params.gain;
        return gain;

      case 'delay':
        const delay = this.ctx.createDelay(5);
        delay.delayTime.value = params.time;
        return delay;

      case 'lfo':
        const lfo = this.ctx.createOscillator();
        lfo.type = params.type;
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
    const fromNode = this.nodes[fromNodeId];
    const toNode = this.nodes[toNodeId];

    if (!fromNode || !toNode) {
      return false;
    }

    // Check if connection already exists
    const exists = this.connections.some(c =>
      c.fromNode === fromNodeId && c.toNode === toNodeId &&
      c.fromOutput === fromOutput && c.toInput === toInput
    );
    if (exists) return false;

    // Make audio connection
    if (fromNode.audioNode && toNode.audioNode) {
      try {
        if (toInput === 'audio') {
          fromNode.audioNode.connect(toNode.audioNode);
        } else if (toInput === 'frequency' && toNode.audioNode.frequency) {
          fromNode.audioNode.connect(toNode.audioNode.frequency);
        } else if (toInput === 'gain' && toNode.audioNode.gain) {
          fromNode.audioNode.connect(toNode.audioNode.gain);
        } else if (toInput === 'Q' && toNode.audioNode.Q) {
          fromNode.audioNode.connect(toNode.audioNode.Q);
        }
      } catch (e) {
        return false;
      }
    }

    this.connections.push({
      fromNode: fromNodeId,
      fromOutput: fromOutput,
      toNode: toNodeId,
      toInput: toInput
    });

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

    // Update audio node
    if (node.audioNode) {
      switch (param) {
        case 'frequency':
          if (node.audioNode.frequency) {
            node.audioNode.frequency.setValueAtTime(value, this.ctx.currentTime);
          }
          break;
        case 'gain':
          if (node.audioNode.gain) {
            node.audioNode.gain.setValueAtTime(value, this.ctx.currentTime);
          }
          break;
        case 'Q':
          if (node.audioNode.Q) {
            node.audioNode.Q.setValueAtTime(value, this.ctx.currentTime);
          }
          break;
        case 'detune':
          if (node.audioNode.detune) {
            node.audioNode.detune.setValueAtTime(value, this.ctx.currentTime);
          }
          break;
        case 'type':
          if (node.audioNode.type !== undefined) {
            node.audioNode.type = value;
          }
          break;
        case 'time':
          if (node.audioNode.delayTime) {
            node.audioNode.delayTime.setValueAtTime(value, this.ctx.currentTime);
          }
          break;
        case 'rate':
          if (node.audioNode.frequency) {
            node.audioNode.frequency.setValueAtTime(value, this.ctx.currentTime);
          }
          break;
        case 'speed':
          // For sampler nodes, speed is on the source
          if (node.audioNode._source?.playbackRate) {
            node.audioNode._source.playbackRate.setValueAtTime(value, this.ctx.currentTime);
          } else if (node.audioNode.playbackRate) {
            node.audioNode.playbackRate.setValueAtTime(value, this.ctx.currentTime);
          }
          break;
        case 'loop':
          // For sampler nodes, need to restart with new loop setting
          if (node.type === 'sampler') {
            this._startSamplerPlayback(node.id);
          } else if (node.audioNode.loop !== undefined) {
            node.audioNode.loop = value;
          }
          break;
      }
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

  // Update modulator nodes with current data
  _updateModulators: function() {
    // Step 1: Update all source modulators with 0-1 values
    for (const [id, node] of Object.entries(this.nodes)) {
      if (node.type === 'eegBand') {
        const band = node.params.band;
        const value = this.data.bands[band] || 0;
        node.outputValue = value / 100; // Normalize 0-100 to 0-1
      } else if (node.type === 'cvFeature') {
        const feature = node.params.feature;
        let value = 0;
        if (feature === 'gaze_x') value = (this.data.gaze.x + 1) / 2;
        else if (feature === 'gaze_y') value = (this.data.gaze.y + 1) / 2;
        else if (feature === 'engagement') value = Math.min(this.data.engagement / 5, 1);
        else value = this.data.cv[feature] || 0;
        node.outputValue = value;
      } else if (node.type === 'handFeature') {
        const hand = node.params.hand;
        const feature = node.params.feature;
        let value = 0;
        const handData = this.data.hands[hand];

        if (feature === 'detected') {
          // Binary 0 or 1 for hand detection state
          value = (handData && handData.detected) ? 1 : 0;
        } else if (handData && handData.detected) {
          if (feature === 'pinch') value = handData.pinch_distance || 0;
          else if (feature === 'openness') value = handData.openness || 0;
          else if (feature === 'x') value = handData.palm_x || 0.5;
          else if (feature === 'y') value = handData.palm_y || 0.5;
          else if (feature === 'z') value = Math.min(Math.max(handData.palm_z || 0, 0), 1);
        }
        node.outputValue = value;
      }
    }

    // Step 2: Propagate through scale/range nodes
    for (const [id, node] of Object.entries(this.nodes)) {
      if (node.type === 'scale') {
        // Find input connection to this scale node
        const inputConn = this.connections.find(c => c.toNode === id);
        if (inputConn) {
          const sourceNode = this.nodes[inputConn.fromNode];
          if (sourceNode && sourceNode.outputValue !== undefined) {
            // Map 0-1 to min-max range
            const min = node.params.min;
            const max = node.params.max;
            node.outputValue = min + sourceNode.outputValue * (max - min);
          }
        }
      }
    }

    // Step 3: Apply all modulations to targets
    for (const [id, node] of Object.entries(this.nodes)) {
      if (node.outputValue !== undefined) {
        this._applyModulation(node);
      }
    }
  },

  // Apply modulation from modulator nodes
  _applyModulation: function(modulatorNode) {
    const connections = this.connections.filter(c => c.fromNode === modulatorNode.id);

    for (const conn of connections) {
      const targetNode = this.nodes[conn.toNode];
      if (!targetNode) continue;

      if (targetNode.type === 'scale') continue;

      const value = modulatorNode.outputValue;
      const input = conn.toInput;
      const isFromRange = modulatorNode.type === 'scale';
      const nodeType = this.nodeTypes[targetNode.type];
      const isVisualNode = nodeType && (nodeType.category === 'visual' || nodeType.category === 'visual_output');

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

      if (input === 'frequency') {
        const freq = isFromRange ? value : (100 + value * 2000);
        targetNode.audioNode.frequency?.setValueAtTime(freq, this.ctx.currentTime);
      } else if (input === 'gain') {
        const gain = isFromRange ? (value / 1000) : value;
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
    if (!canvasNode) return [];

    // Find all nodes connected to canvas (trace back through 'draw' connections)
    const connectedIds = new Set();

    const traceConnections = (nodeId) => {
      // Find all connections where this node is the target
      for (const conn of this.connections) {
        if (conn.toNode === nodeId && conn.toInput === 'draw') {
          const fromNode = this.nodes[conn.fromNode];
          if (fromNode) {
            const nodeType = this.nodeTypes[fromNode.type];
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

  // Get canvas node if exists
  getCanvasNode: function() {
    for (const [id, node] of Object.entries(this.nodes)) {
      if (node.type === 'canvas') {
        return { id, ...node };
      }
    }
    return null;
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
