// p5.js Sketch with User Controls and Multiple Visualization Modes
// Data-driven artistic visualizations of EEG data

const Sketch = {
  // Configuration
  config: {
    mode: 'particles',
    count: 100,
    size: 10,
    speed: 1.0,
    trails: 50,
    colorScheme: 'cool',
    mapping: {
      movement: { source: 'bands', param: 'theta' },
      hue: { source: 'bands', param: 'beta' },
      size: { source: 'bands', param: 'alpha' },
      brightness: { source: 'bands', param: 'gamma' }
    }
  },

  // Data from multiple sources
  data: {
    bands: {
      delta: 10,
      theta: 10,
      alpha: 20,
      beta: 15,
      gamma: 5
    },
    fft: {
      lowFreq: 10,    // 0-10 Hz
      midFreq: 15,    // 10-20 Hz
      highFreq: 5,    // 20-40 Hz
      peak: 12,       // Peak frequency
      totalPower: 50  // Total spectral power
    },
    timeseries: {
      amplitude: 20,    // Current amplitude
      variance: 15,     // Signal variance
      peak: 30,         // Peak value
      rms: 25,          // RMS value
      rate: 10          // Rate of change
    },
    camera: {
      mouthOpen: 0,     // 0-1
      eyebrowRaise: 0,  // 0-1
      headYaw: 0.5,     // 0-1 (left to right)
      headRoll: 0.5,    // 0-1 (tilt)
      smile: 0          // 0-1
    }
  },

  // Visualization modes
  modes: {
    particles: null,
    waves: null,
    radial: null,
    flow: null,
    mandala: null
  },

  // Initialize sketch
  init: function(p5Instance) {
    this.p = p5Instance;
    this.initModes();
    this.setupControls();
  },

  // Initialize all visualization modes
  initModes: function() {
    const p = this.p;

    // PARTICLES MODE
    this.modes.particles = {
      elements: [],
      init: function(count) {
        this.elements = [];
        for (let i = 0; i < count; i++) {
          this.elements.push({
            x: p.random(p.width),
            y: p.random(p.height),
            vx: p.random(-2, 2),
            vy: p.random(-2, 2),
            baseSize: p.random(5, 15),
            phase: p.random(p.TWO_PI)
          });
        }
      },
      draw: function(config, sketch) {
        const movementValue = sketch.getValue('movement');
        const hueValue = sketch.getValue('hue');
        const sizeValue = sketch.getValue('size');
        const brightnessValue = sketch.getValue('brightness');

        this.elements.forEach((particle, i) => {
          // Movement influenced by selected band
          const speedFactor = config.speed * (movementValue / 50);
          particle.vx += p.random(-0.5, 0.5) * speedFactor;
          particle.vy += p.random(-0.5, 0.5) * speedFactor;
          
          // Damping
          particle.vx *= 0.99;
          particle.vy *= 0.99;
          
          particle.x += particle.vx;
          particle.y += particle.vy;

          // Wrap around
          if (particle.x < 0) particle.x = p.width;
          if (particle.x > p.width) particle.x = 0;
          if (particle.y < 0) particle.y = p.height;
          if (particle.y > p.height) particle.y = 0;

          // Color based on selected band
          const hue = p.map(hueValue, 0, 100, ...Sketch.getHueRange(config.colorScheme));
          const saturation = p.map(brightnessValue, 0, 100, 40, 100);
          const brightness = p.map(sizeValue, 0, 100, 50, 90);

          p.colorMode(p.HSB, 360, 100, 100);
          p.fill(hue, saturation, brightness, 200);
          p.noStroke();

          // Size influenced by selected band
          const size = particle.baseSize * (1 + sizeValue / 100) * (config.size / 10);
          p.ellipse(particle.x, particle.y, size);

          // Draw connections
          this.elements.slice(i + 1, i + 5).forEach(other => {
            const d = p.dist(particle.x, particle.y, other.x, other.y);
            if (d < 100) {
              const alpha = p.map(d, 0, 100, 50, 0);
              p.stroke(hue, saturation, brightness, alpha);
              p.strokeWeight(1);
              p.line(particle.x, particle.y, other.x, other.y);
            }
          });
        });
        p.colorMode(p.RGB, 255);
      }
    };

    // WAVES MODE
    this.modes.waves = {
      elements: [],
      init: function(count) {
        this.elements = [];
        for (let i = 0; i < count; i++) {
          this.elements.push({
            y: (i / count) * p.height,
            phase: p.random(p.TWO_PI),
            amplitude: p.random(20, 60)
          });
        }
      },
      draw: function(config, sketch) {
        const movementValue = sketch.getValue('movement');
        const hueValue = sketch.getValue('hue');
        const sizeValue = sketch.getValue('size');
        
        this.elements.forEach((wave, i) => {
          wave.phase += 0.02 * config.speed * (movementValue / 20);
          
          const hue = p.map(hueValue + i * 2, 0, 100, ...Sketch.getHueRange(config.colorScheme));
          const amplitude = wave.amplitude * (1 + sizeValue / 100);
          
          p.colorMode(p.HSB, 360, 100, 100);
          p.noFill();
          p.stroke(hue, 70, 80, 150);
          p.strokeWeight(config.size / 5);
          
          p.beginShape();
          for (let x = 0; x < p.width; x += 10) {
            const y = wave.y + p.sin(wave.phase + x * 0.01) * amplitude;
            p.vertex(x, y);
          }
          p.endShape();
        });
        p.colorMode(p.RGB, 255);
      }
    };

    // RADIAL MODE
    this.modes.radial = {
      elements: [],
      init: function(count) {
        this.elements = [];
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * p.TWO_PI;
          this.elements.push({
            angle: angle,
            radius: 0,
            maxRadius: p.random(50, 200),
            speed: p.random(1, 3)
          });
        }
      },
      draw: function(config, sketch) {
        const movementValue = sketch.getValue('movement');
        const hueValue = sketch.getValue('hue');
        const sizeValue = sketch.getValue('size');
        
        const centerX = p.width / 2;
        const centerY = p.height / 2;
        
        this.elements.forEach((ray, i) => {
          // Expand from center
          ray.radius += ray.speed * config.speed * (movementValue / 20);
          if (ray.radius > ray.maxRadius) {
            ray.radius = 0;
          }
          
          const hue = p.map((hueValue + i) % 100, 0, 100, ...Sketch.getHueRange(config.colorScheme));
          const x = centerX + p.cos(ray.angle) * ray.radius;
          const y = centerY + p.sin(ray.angle) * ray.radius;
          
          p.colorMode(p.HSB, 360, 100, 100);
          p.fill(hue, 70, 80, 200);
          p.noStroke();
          
          const size = config.size * (1 + sizeValue / 100);
          p.ellipse(x, y, size);
        });
        p.colorMode(p.RGB, 255);
      }
    };

    // FLOW FIELD MODE
    this.modes.flow = {
      elements: [],
      noiseScale: 0.01,
      init: function(count) {
        this.elements = [];
        for (let i = 0; i < count; i++) {
          this.elements.push({
            x: p.random(p.width),
            y: p.random(p.height),
            prevX: p.random(p.width),
            prevY: p.random(p.height)
          });
        }
      },
      draw: function(config, sketch) {
        const movementValue = sketch.getValue('movement');
        const hueValue = sketch.getValue('hue');
        
        this.elements.forEach((particle, i) => {
          // Perlin noise-based flow field
          const angle = p.noise(particle.x * this.noiseScale, particle.y * this.noiseScale, p.frameCount * 0.01) * p.TWO_PI * 2;
          const speed = config.speed * (movementValue / 20);
          
          particle.prevX = particle.x;
          particle.prevY = particle.y;
          
          particle.x += p.cos(angle) * speed;
          particle.y += p.sin(angle) * speed;
          
          // Wrap around
          if (particle.x < 0) { particle.x = p.width; particle.prevX = particle.x; }
          if (particle.x > p.width) { particle.x = 0; particle.prevX = particle.x; }
          if (particle.y < 0) { particle.y = p.height; particle.prevY = particle.y; }
          if (particle.y > p.height) { particle.y = 0; particle.prevY = particle.y; }
          
          const hue = p.map(hueValue, 0, 100, ...Sketch.getHueRange(config.colorScheme));
          p.colorMode(p.HSB, 360, 100, 100);
          p.stroke(hue, 70, 80, 150);
          p.strokeWeight(config.size / 5);
          p.line(particle.prevX, particle.prevY, particle.x, particle.y);
        });
        p.colorMode(p.RGB, 255);
      }
    };

    // MANDALA MODE
    this.modes.mandala = {
      rotation: 0,
      init: function(count) {
        // No initialization needed
      },
      draw: function(config, sketch) {
        const movementValue = sketch.getValue('movement');
        const hueValue = sketch.getValue('hue');
        const sizeValue = sketch.getValue('size');
        
        this.rotation += 0.005 * config.speed * (movementValue / 20);
        
        p.push();
        p.translate(p.width / 2, p.height / 2);
        p.rotate(this.rotation);
        
        const layers = Math.floor(config.count / 10);
        const symmetry = 8;
        
        for (let layer = 0; layer < layers; layer++) {
          const radius = (layer + 1) * (30 + sizeValue);
          const hue = p.map((hueValue + layer * 10) % 100, 0, 100, ...Sketch.getHueRange(config.colorScheme));
          
          p.colorMode(p.HSB, 360, 100, 100);
          p.stroke(hue, 70, 80);
          p.noFill();
          p.strokeWeight(config.size / 5);
          
          for (let i = 0; i < symmetry; i++) {
            const angle = (i / symmetry) * p.TWO_PI;
            const x = p.cos(angle) * radius;
            const y = p.sin(angle) * radius;
            p.ellipse(x, y, config.size * 2);
          }
        }
        
        p.pop();
        p.colorMode(p.RGB, 255);
      }
    };
  },

  // Get hue range based on color scheme
  getHueRange: function(scheme) {
    switch(scheme) {
      case 'cool': return [180, 280];  // Blue to purple
      case 'warm': return [0, 60];     // Red to orange
      case 'earth': return [60, 120];  // Yellow to green
      case 'rainbow': return [0, 360]; // Full spectrum
      case 'monochrome': return [0, 0]; // Grayscale
      default: return [180, 280];
    }
  },

  // Update data from various sources
  updateBands: function(bands) {
    this.data.bands = { ...this.data.bands, ...bands };
  },

  updateFFT: function(freqs, psd) {
    // Calculate frequency band powers from FFT
    if (!freqs || !psd || freqs.length === 0) return;
    
    // Low freq (0-10 Hz)
    const lowIdx = freqs.findIndex(f => f > 10);
    const lowPower = psd.slice(0, lowIdx).reduce((a, b) => a + b, 0) / lowIdx;
    
    // Mid freq (10-20 Hz)
    const midIdx = freqs.findIndex(f => f > 20);
    const midPower = psd.slice(lowIdx, midIdx).reduce((a, b) => a + b, 0) / (midIdx - lowIdx);
    
    // High freq (20-40 Hz)
    const highIdx = freqs.findIndex(f => f > 40) || freqs.length;
    const highPower = psd.slice(midIdx, highIdx).reduce((a, b) => a + b, 0) / (highIdx - midIdx);
    
    // Peak frequency
    const maxIdx = psd.indexOf(Math.max(...psd));
    const peak = freqs[maxIdx];
    
    // Total power
    const totalPower = psd.reduce((a, b) => a + b, 0) / psd.length;
    
    this.data.fft = {
      lowFreq: Math.min(100, lowPower * 10),
      midFreq: Math.min(100, midPower * 10),
      highFreq: Math.min(100, highPower * 10),
      peak: Math.min(100, peak * 2.5),
      totalPower: Math.min(100, totalPower * 5)
    };
  },

  updateTimeSeries: function(channels, data) {
    // Calculate time series features
    if (!data || data.length === 0 || !data[0] || data[0].length === 0) return;
    
    // Use first channel for simplicity
    const signal = data[0];
    
    // Amplitude (mean absolute value)
    const amplitude = signal.reduce((sum, val) => sum + Math.abs(val), 0) / signal.length;
    
    // Variance
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
    
    // Peak value
    const peak = Math.max(...signal.map(Math.abs));
    
    // RMS
    const rms = Math.sqrt(signal.reduce((sum, val) => sum + val * val, 0) / signal.length);
    
    // Rate of change (derivative)
    let rate = 0;
    for (let i = 1; i < signal.length; i++) {
      rate += Math.abs(signal[i] - signal[i-1]);
    }
    rate /= signal.length;
    
    this.data.timeseries = {
      amplitude: Math.min(100, amplitude * 2),
      variance: Math.min(100, variance / 10),
      peak: Math.min(100, peak * 2),
      rms: Math.min(100, rms * 2),
      rate: Math.min(100, rate * 3)
    };
  },

  updateCamera: function(features) {
    // Update camera facial features (already normalized 0-1)
    if (!features) return;
    
    this.data.camera = {
      mouthOpen: (features.mouth_openness || 0) * 100,
      eyebrowRaise: (features.brow_raise || 0) * 100,
      headYaw: ((features.head_yaw || 0) + 0.5) * 100, // -0.5 to 0.5 -> 0 to 100
      headRoll: (features.head_roll_relative || 0.5) * 100,
      smile: (features.smile_curvature || 0) * 100
    };
  },

  // Get value from mapped source
  getValue: function(mappingKey) {
    const mapping = this.config.mapping[mappingKey];
    if (!mapping) return 50; // Default
    
    const source = mapping.source;
    const param = mapping.param;
    
    if (this.data[source] && this.data[source][param] !== undefined) {
      return this.data[source][param];
    }
    
    return 50; // Default fallback
  },

  // Setup UI controls
  setupControls: function() {
    // Mode selector
    const modeSelect = document.getElementById('viz-mode');
    if (modeSelect) {
      modeSelect.addEventListener('change', (e) => {
        this.config.mode = e.target.value;
        this.modes[this.config.mode].init(this.config.count);
        console.log('[Sketch] Switched to mode:', this.config.mode);
      });
    }

    // Count slider
    const countSlider = document.getElementById('viz-count');
    const countVal = document.getElementById('viz-count-val');
    if (countSlider) {
      countSlider.addEventListener('input', (e) => {
        this.config.count = parseInt(e.target.value);
        if (countVal) countVal.textContent = this.config.count;
        this.modes[this.config.mode].init(this.config.count);
      });
    }

    // Speed slider
    const speedSlider = document.getElementById('viz-speed');
    const speedVal = document.getElementById('viz-speed-val');
    if (speedSlider) {
      speedSlider.addEventListener('input', (e) => {
        this.config.speed = parseFloat(e.target.value);
        if (speedVal) speedVal.textContent = this.config.speed.toFixed(1);
      });
    }

    // Size slider
    const sizeSlider = document.getElementById('viz-size');
    const sizeVal = document.getElementById('viz-size-val');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', (e) => {
        this.config.size = parseInt(e.target.value);
        if (sizeVal) sizeVal.textContent = this.config.size;
      });
    }

    // Trails slider
    const trailsSlider = document.getElementById('viz-trails');
    const trailsVal = document.getElementById('viz-trails-val');
    if (trailsSlider) {
      trailsSlider.addEventListener('input', (e) => {
        this.config.trails = parseInt(e.target.value);
        if (trailsVal) trailsVal.textContent = this.config.trails;
      });
    }

    // Mapping selectors - source
    ['movement', 'hue', 'size', 'brightness'].forEach(param => {
      const sourceSelect = document.getElementById(`map-${param}-source`);
      const paramSelect = document.getElementById(`map-${param}-param`);
      
      if (sourceSelect) {
        sourceSelect.addEventListener('change', (e) => {
          this.config.mapping[param].source = e.target.value;
          console.log(`[Sketch] Mapped ${param} source to ${e.target.value}`);
          
          // Update param options based on source
          this.updateParamOptions(param, e.target.value);
        });
      }
      
      if (paramSelect) {
        paramSelect.addEventListener('change', (e) => {
          this.config.mapping[param].param = e.target.value;
          console.log(`[Sketch] Mapped ${param} param to ${e.target.value}`);
        });
      }
    });

    // Color scheme
    const colorScheme = document.getElementById('viz-colorscheme');
    if (colorScheme) {
      colorScheme.addEventListener('change', (e) => {
        this.config.colorScheme = e.target.value;
      });
    }

    // Presets
    document.querySelectorAll('.viz-preset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const preset = e.target.dataset.preset;
        this.applyPreset(preset);
      });
    });
  },

  // Update parameter options based on selected source
  updateParamOptions: function(mappingKey, source) {
    const paramSelect = document.getElementById(`map-${mappingKey}-param`);
    if (!paramSelect) return;
    
    // Clear existing options
    paramSelect.innerHTML = '';
    
    let options = [];
    switch(source) {
      case 'bands':
        options = [
          { value: 'delta', label: 'Delta (0.5-4 Hz)' },
          { value: 'theta', label: 'Theta (4-8 Hz)' },
          { value: 'alpha', label: 'Alpha (8-13 Hz)' },
          { value: 'beta', label: 'Beta (13-30 Hz)' },
          { value: 'gamma', label: 'Gamma (30-50 Hz)' }
        ];
        break;
      case 'fft':
        options = [
          { value: 'lowFreq', label: 'Low (0-10 Hz)' },
          { value: 'midFreq', label: 'Mid (10-20 Hz)' },
          { value: 'highFreq', label: 'High (20-40 Hz)' },
          { value: 'peak', label: 'Peak Frequency' },
          { value: 'totalPower', label: 'Total Power' }
        ];
        break;
      case 'timeseries':
        options = [
          { value: 'amplitude', label: 'Amplitude' },
          { value: 'variance', label: 'Variance' },
          { value: 'peak', label: 'Peak Value' },
          { value: 'rms', label: 'RMS' },
          { value: 'rate', label: 'Rate of Change' }
        ];
        break;
      case 'camera':
        options = [
          { value: 'mouthOpen', label: 'Mouth Openness' },
          { value: 'eyebrowRaise', label: 'Eyebrow Raise' },
          { value: 'headYaw', label: 'Head Yaw' },
          { value: 'headRoll', label: 'Head Roll' },
          { value: 'smile', label: 'Smile' }
        ];
        break;
    }
    
    // Add options
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      paramSelect.appendChild(option);
    });
    
    // Set first option as selected
    if (options.length > 0) {
      this.config.mapping[mappingKey].param = options[0].value;
    }
  },

  // Apply visualization presets
  applyPreset: function(preset) {
    switch(preset) {
      case 'meditation':
        this.config.mode = 'waves';
        this.config.speed = 0.5;
        this.config.colorScheme = 'cool';
        document.getElementById('viz-mode').value = 'waves';
        document.getElementById('viz-speed').value = 0.5;
        document.getElementById('viz-speed-val').textContent = '0.5';
        break;
      case 'focused':
        this.config.mode = 'radial';
        this.config.speed = 2.0;
        this.config.colorScheme = 'warm';
        document.getElementById('viz-mode').value = 'radial';
        document.getElementById('viz-speed').value = 2.0;
        document.getElementById('viz-speed-val').textContent = '2.0';
        break;
      case 'psychedelic':
        this.config.mode = 'flow';
        this.config.count = 200;
        this.config.colorScheme = 'rainbow';
        document.getElementById('viz-mode').value = 'flow';
        document.getElementById('viz-count').value = 200;
        document.getElementById('viz-count-val').textContent = '200';
        break;
      case 'minimal':
        this.config.mode = 'mandala';
        this.config.count = 50;
        this.config.colorScheme = 'monochrome';
        document.getElementById('viz-mode').value = 'mandala';
        document.getElementById('viz-count').value = 50;
        document.getElementById('viz-count-val').textContent = '50';
        break;
    }
    this.modes[this.config.mode].init(this.config.count);
    console.log('[Sketch] Applied preset:', preset);
  },

  // Main draw function
  draw: function() {
    const p = this.p;
    
    // Background with trails effect
    const bgAlpha = p.map(this.config.trails, 0, 100, 255, 10);
    p.background(15, 15, 25, bgAlpha);
    
    // Draw current mode
    const mode = this.modes[this.config.mode];
    if (mode) {
      mode.draw(this.config, this);
    }
  }
};

// Export for use in main HTML
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Sketch;
}
