// visual.js - p5.js Visual Renderer for HeadWave
// Renders visual nodes from the unified NodeEngine

const VisualRenderer = {
  p5Instance: null,
  previewContainer: null,
  fullscreenContainer: null,
  isFullscreen: false,
  enabled: false,

  particleState: {},

  // AI Canvas state
  aiCanvasInitialized: {},
  aiCanvasDrawFunctions: {},

  // Error tracking for graceful degradation
  _errorCounts: {},
  _maxErrorsBeforeFallback: 3,
  _fallbackActive: {},

  // Performance tracking
  _frameTime: 0,
  _lastFrameTime: 0,

  // Fallback sketch for error recovery
  _fallbackSketch: function(p) {
    let t = 0;
    p.setup = function() {
      p.createCanvas(400, 400);
      p.colorMode(p.HSB, 360, 100, 100, 100);
      p.noStroke();
    };
    p.draw = function() {
      let intensity = p.getParam ? (p.getParam('intensity') || 0.5) : 0.5;
      p.background(220, 20, 10);
      t += 0.02;
      p.translate(p.width/2, p.height/2);
      for (let i = 0; i < 5; i++) {
        let r = 50 + i * 30 + p.sin(t + i * 0.5) * 20 * intensity;
        let alpha = 60 - i * 10;
        p.fill(200 + i * 20, 50, 80, alpha);
        p.ellipse(0, 0, r * 2, r * 2);
      }
    };
  },

  init: function(previewContainerId) {
    this.previewContainer = document.getElementById(previewContainerId);
    if (!this.previewContainer) {
      console.warn('[VisualRenderer] Preview container not found:', previewContainerId);
      return false;
    }

    this.createP5Instance(this.previewContainer);
    return true;
  },

  // Track if current canvas is WebGL
  isWebGL: false,

  // WebGL function patterns to detect
  webglPatterns: /\b(rotateX|rotateY|rotateZ|box|sphere|cylinder|cone|torus|plane|camera|perspective|ortho|ambientLight|directionalLight|pointLight|spotLight|normalMaterial|ambientMaterial|specularMaterial|shininess|texture|createGraphics.*WEBGL|WEBGL)\b/,

  // Check if code needs WebGL
  needsWebGL: function(code) {
    return this.webglPatterns.test(code);
  },

  createP5Instance: function(container, useWebGL = false) {
    const self = this;
    this.isWebGL = useWebGL;

    const sketch = function(p) {
      p.setup = function() {
        const w = container.clientWidth || 800;
        const h = container.clientHeight || 600;
        const canvas = useWebGL
          ? p.createCanvas(w, h, p.WEBGL)
          : p.createCanvas(w, h);
        canvas.parent(container);
        if (!useWebGL) {
          p.colorMode(p.HSB, 360, 100, 100, 255);
        }
        p.frameRate(60);
      };

      p.windowResized = function() {
        const w = container.clientWidth || 800;
        const h = container.clientHeight || 600;
        if (useWebGL) {
          p.resizeCanvas(w, h, p.WEBGL);
        } else {
          p.resizeCanvas(w, h);
        }
      };

      p.draw = function() {
        if (typeof AudioEngine !== 'undefined') {
          const canvasNode = AudioEngine.getCanvasNode?.();
          const connectedVisuals = AudioEngine.getConnectedVisualNodes?.() || [];
          if (canvasNode && connectedVisuals.length > 0) {
            self.enabled = true;
          } else if (canvasNode) {
            // Canvas exists but no visuals connected
            self.enabled = false;
          }
        }

        if (!self.enabled) {
          p.background(13, 17, 23);
          p.fill(100);
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(12);
          p.text('Connect a visual node to Output', p.width / 2, p.height / 2);
          return;
        }

        self.render(p);
      };
    };

    this.p5Instance = new p5(sketch);
  },

  enable: function() {
    this.enabled = true;
  },

  disable: function() {
    this.enabled = false;
  },

  toggleFullscreen: function() {
    if (this.isFullscreen) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen();
    }
  },

  enterFullscreen: function() {
    if (!this.fullscreenContainer) {
      this.fullscreenContainer = document.createElement('div');
      this.fullscreenContainer.id = 'visual-fullscreen';
      this.fullscreenContainer.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: #0d1117; z-index: 9999;
      `;

      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '✕';
      closeBtn.style.cssText = `
        position: absolute; top: 20px; right: 20px; z-index: 10000;
        width: 40px; height: 40px; border-radius: 50%;
        background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
        color: white; font-size: 20px; cursor: pointer;
      `;
      closeBtn.onclick = () => this.exitFullscreen();
      this.fullscreenContainer.appendChild(closeBtn);

      document.body.appendChild(this.fullscreenContainer);
    }

    this.fullscreenContainer.style.display = 'block';

    if (this.p5Instance) {
      this.p5Instance.remove();
    }

    // Reset AI Canvas state so it reinitializes with new p5 instance
    this.aiCanvasInitialized = {};
    this.aiCanvasDrawFunctions = {};

    // Force enable since we're entering fullscreen
    this.enabled = true;

    // Check if any connected AI Canvas needs WebGL
    let needsWebGL = false;
    if (typeof AudioEngine !== 'undefined') {
      const connectedNodes = AudioEngine.getConnectedVisualNodes?.() || [];
      for (const node of connectedNodes) {
        if (node.type === 'aiCanvas') {
          const liveNode = AudioEngine.nodes[node.id];
          const aiCode = liveNode?.aiCode || node.aiCode;
          if (aiCode && this.needsWebGL(aiCode)) {
            needsWebGL = true;
            break;
          }
        }
      }
    }

    this.createP5Instance(this.fullscreenContainer, needsWebGL);
    this.isFullscreen = true;

    console.log('[VisualRenderer] Entered fullscreen mode');

    document.addEventListener('keydown', this._escHandler = (e) => {
      if (e.key === 'Escape') this.exitFullscreen();
    });
  },

  exitFullscreen: function() {
    if (this.fullscreenContainer) {
      this.fullscreenContainer.style.display = 'none';
    }

    if (this.p5Instance) {
      this.p5Instance.remove();
    }

    // Reset AI Canvas state
    this.aiCanvasInitialized = {};
    this.aiCanvasDrawFunctions = {};

    this.createP5Instance(this.previewContainer);
    this.isFullscreen = false;

    document.removeEventListener('keydown', this._escHandler);
  },

  render: function(p) {
    if (typeof AudioEngine === 'undefined') {
      console.log('[VisualRenderer] AudioEngine not defined');
      return;
    }

    // Check for Output node or Canvas node
    const outputNode = AudioEngine.getOutputNode?.() || AudioEngine.getCanvasNode?.();
    if (!outputNode) {
      p.background(13, 17, 23);
      p.fill(150);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(12);
      p.text('Add an Output node', p.width / 2, p.height / 2);
      return;
    }

    p.colorMode(p.RGB, 255);

    const bgColor = outputNode.params?.background || '#0d1117';
    const trails = outputNode.params?.trails || 0;

    if (trails > 0) {
      const alpha = p.map(trails, 0, 100, 255, 10);
      const c = p.color(bgColor);
      c.setAlpha(alpha);
      p.background(c);
    } else {
      p.background(bgColor);
    }

    // Check for connected AI Canvas nodes
    const connectedNodes = AudioEngine.getConnectedVisualNodes?.() || [];

    // Debug logging (only once per second to avoid spam)
    if (!this._lastDebugLog || Date.now() - this._lastDebugLog > 1000) {
      console.log('[VisualRenderer] Connected visual nodes:', connectedNodes.length, connectedNodes.map(n => n.type));
      this._lastDebugLog = Date.now();
    }

    if (connectedNodes.length === 0) {
      p.fill(100);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(12);
      p.text('No visual nodes connected', p.width / 2, p.height / 2);
      return;
    }

    // Render each connected visual node
    let renderedCount = 0;
    for (const node of connectedNodes) {
      if (node.type === 'aiCanvas') {
        this.renderAICanvas(p, node);
        renderedCount++;
      } else {
        this.renderNode(p, node);
        renderedCount++;
      }
    }

    // If we have nodes but nothing rendered, show debug info
    if (connectedNodes.length > 0 && renderedCount === 0) {
      p.fill(255, 200, 0);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(14);
      p.text(`${connectedNodes.length} nodes found but nothing rendered`, p.width / 2, p.height / 2);
    }
  },

  // Render AI Canvas node
  renderAICanvas: function(p, node) {
    const nodeId = node.id;

    // Get live node data from AudioEngine to ensure we have latest aiCode
    const liveNode = AudioEngine.nodes[nodeId];
    const aiCode = liveNode?.aiCode || node.aiCode;
    const aiParams = liveNode?.aiParameters || node.aiParameters;

    // Debug: log code status (throttled)
    if (!this._lastCodeLog || Date.now() - this._lastCodeLog > 2000) {
      console.log('[VisualRenderer] AI Canvas node:', nodeId);
      console.log('[VisualRenderer] Has aiCode:', !!aiCode);
      console.log('[VisualRenderer] Code length:', aiCode?.length || 0);
      console.log('[VisualRenderer] Code preview:', aiCode?.substring(0, 100));
      this._lastCodeLog = Date.now();
    }

    if (!aiCode) {
      p.fill(150);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(12);
      p.text('No AI code generated', p.width / 2, p.height / 2);
      return;
    }

    // Check if we need to switch to WebGL mode
    const codeNeedsWebGL = this.needsWebGL(aiCode);
    if (codeNeedsWebGL && !this.isWebGL) {
      console.log('[VisualRenderer] AI code requires WebGL, recreating canvas...');
      // Need to recreate canvas with WebGL
      if (this.p5Instance) {
        this.p5Instance.remove();
      }
      this.aiCanvasInitialized = {};
      this.aiCanvasDrawFunctions = {};
      const container = this.isFullscreen ? this.fullscreenContainer : this.previewContainer;
      this.createP5Instance(container, true);
      return; // Will reinitialize on next frame
    }

    // Initialize the AI canvas code if not done yet
    if (!this.aiCanvasInitialized[nodeId]) {
      console.log('[VisualRenderer] Initializing AI Canvas:', nodeId);
      console.log('[VisualRenderer] Full code:\n', aiCode);
      try {
        const self = this;

        // Create a proxy p5 object that captures setup/draw and mouse events
        const capturedSetup = { fn: null };
        const capturedDraw = { fn: null };
        const capturedMousePressed = { fn: null };
        const capturedMouseReleased = { fn: null };
        const capturedMouseDragged = { fn: null };
        const capturedMouseWheel = { fn: null };
        const capturedMouseMoved = { fn: null };
        const capturedKeyPressed = { fn: null };

        const proxyP = new Proxy(p, {
          set: function(target, prop, value) {
            if (prop === 'setup') {
              capturedSetup.fn = value;
              return true;
            }
            if (prop === 'draw') {
              capturedDraw.fn = value;
              return true;
            }
            if (prop === 'mousePressed') {
              capturedMousePressed.fn = value;
              return true;
            }
            if (prop === 'mouseReleased') {
              capturedMouseReleased.fn = value;
              return true;
            }
            if (prop === 'mouseDragged') {
              capturedMouseDragged.fn = value;
              return true;
            }
            if (prop === 'mouseWheel') {
              capturedMouseWheel.fn = value;
              return true;
            }
            if (prop === 'mouseMoved') {
              capturedMouseMoved.fn = value;
              return true;
            }
            if (prop === 'keyPressed') {
              capturedKeyPressed.fn = value;
              return true;
            }
            target[prop] = value;
            return true;
          },
          get: function(target, prop) {
            if (prop === 'getParam') {
              return function(name) {
                const ln = AudioEngine.nodes[nodeId];
                if (ln?.params && name in ln.params) {
                  return ln.params[name];
                }
                const ap = (ln?.aiParameters || []).find(x => x.name === name);
                return ap ? ap.default : 0;
              };
            }
            return target[prop];
          }
        });

        // Parse and execute the AI code
        console.log('[VisualRenderer] Parsing AI code, length:', aiCode.length);
        console.log('[VisualRenderer] Code starts with:', aiCode.substring(0, 100));
        try {
          const sketchFn = new Function('return ' + aiCode)();
          console.log('[VisualRenderer] Got sketch function:', typeof sketchFn);
          if (typeof sketchFn !== 'function') {
            console.error('[VisualRenderer] sketchFn is not a function!');
            throw new Error('Generated code did not return a function');
          }
          sketchFn(proxyP);
          console.log('[VisualRenderer] Executed sketch function');
        } catch (parseErr) {
          console.error('[VisualRenderer] Parse error:', parseErr);
          console.error('[VisualRenderer] Full code:', aiCode);
          throw parseErr;
        }
        console.log('[VisualRenderer] Captured setup:', !!capturedSetup.fn);
        console.log('[VisualRenderer] Captured draw:', !!capturedDraw.fn);
        console.log('[VisualRenderer] Captured mouse events:', {
          mousePressed: !!capturedMousePressed.fn,
          mouseDragged: !!capturedMouseDragged.fn,
          mouseWheel: !!capturedMouseWheel.fn
        });

        // Store the captured functions
        if (capturedSetup.fn) {
          // Run setup once, but don't create a new canvas
          const origCreate = p.createCanvas;
          p.createCanvas = function() { return p.canvas; };
          try {
            capturedSetup.fn.call(proxyP);
          } catch (e) {
            console.error('AI Canvas setup error:', e);
          }
          p.createCanvas = origCreate;
        }

        if (capturedDraw.fn) {
          this.aiCanvasDrawFunctions[nodeId] = capturedDraw.fn;
        }

        // Attach mouse event handlers to the p5 instance
        if (capturedMousePressed.fn) {
          p.mousePressed = capturedMousePressed.fn;
        }
        if (capturedMouseReleased.fn) {
          p.mouseReleased = capturedMouseReleased.fn;
        }
        if (capturedMouseDragged.fn) {
          p.mouseDragged = capturedMouseDragged.fn;
        }
        if (capturedMouseWheel.fn) {
          p.mouseWheel = capturedMouseWheel.fn;
        }
        if (capturedMouseMoved.fn) {
          p.mouseMoved = capturedMouseMoved.fn;
        }
        if (capturedKeyPressed.fn) {
          p.keyPressed = capturedKeyPressed.fn;
        }

        this.aiCanvasInitialized[nodeId] = true;
        console.log('[VisualRenderer] AI Canvas initialized successfully');
      } catch (err) {
        console.error('AI Canvas init error:', err);
        this.aiCanvasInitialized[nodeId] = true;
        // Show error
        p.fill(255, 100, 100);
        p.textAlign(p.CENTER, p.CENTER);
        p.text('Code Error: ' + err.message, p.width / 2, p.height / 2);
        return;
      }
    }

    // Track frame time for graceful degradation
    const frameStart = performance.now();

    // Run the draw function each frame
    if (this.aiCanvasDrawFunctions[nodeId]) {
      try {
        // Create getParam function for this frame
        p.getParam = function(name) {
          const ln = AudioEngine.nodes[nodeId];
          if (ln?.params && name in ln.params) {
            return ln.params[name];
          }
          const ap = (ln?.aiParameters || []).find(x => x.name === name);
          return ap ? ap.default : 0;
        };

        this.aiCanvasDrawFunctions[nodeId].call(p);

        // Reset error count on successful frame
        if (this._errorCounts[nodeId]) {
          this._errorCounts[nodeId] = Math.max(0, this._errorCounts[nodeId] - 0.1);
        }

        // Track frame time and apply graceful degradation
        this._frameTime = performance.now() - frameStart;
        this._applyGracefulDegradation(nodeId, this._frameTime);

      } catch (err) {
        console.error('AI Canvas draw error:', err);

        // Track errors
        this._errorCounts[nodeId] = (this._errorCounts[nodeId] || 0) + 1;

        // If too many errors, load fallback sketch
        if (this._errorCounts[nodeId] >= this._maxErrorsBeforeFallback) {
          this._loadFallbackSketch(nodeId, p);
        } else {
          p.fill(255, 100, 100);
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(14);
          p.text('Draw Error: ' + err.message, p.width / 2, p.height / 2);
        }
      }
    } else {
      // No draw function captured - show fallback
      p.fill(255, 200, 0);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(14);
      p.text('No draw function captured', p.width / 2, p.height / 2);
    }
  },

  // Load fallback sketch when too many errors occur
  _loadFallbackSketch: function(nodeId, p) {
    if (this._fallbackActive[nodeId]) return;

    console.log('[VisualRenderer] Loading fallback sketch for node:', nodeId);
    this._fallbackActive[nodeId] = true;

    // Replace the draw function with fallback
    const fallbackDraw = () => {
      p.background(220, 20, 10);
      const t = p.frameCount * 0.02;
      p.translate(p.width/2, p.height/2);
      p.noStroke();
      for (let i = 0; i < 5; i++) {
        const r = 50 + i * 30 + p.sin(t + i * 0.5) * 20 * 0.5;
        const alpha = 60 - i * 10;
        p.fill(200 + i * 20, 50, 80, alpha);
        p.ellipse(0, 0, r * 2, r * 2);
      }
    };

    this.aiCanvasDrawFunctions[nodeId] = fallbackDraw;
  },

  // Graceful degradation: reduce complexity when frame time is too high
  _applyGracefulDegradation: function(nodeId, frameTime) {
    // Target 60fps = 16.67ms per frame, allow up to 33ms (30fps)
    if (frameTime > 33) {
      const node = AudioEngine?.nodes?.[nodeId];
      if (node?.params?.complexity !== undefined) {
        // Reduce complexity by 20%
        node.params.complexity = Math.max(1, node.params.complexity * 0.8);
        console.log('[VisualRenderer] Reducing complexity for performance:', node.params.complexity);
      }
    }
  },

  renderNode: function(p, node) {
    const params = node.params;
    const w = p.width;
    const h = p.height;

    p.push();

    switch (node.type) {
      case 'ellipse':
        this.applyFillStroke(p, params);
        if (params.rotation) {
          p.translate(params.x * w, params.y * h);
          p.rotate(p.radians(params.rotation));
          p.ellipse(0, 0, params.width * w, params.height * h);
        } else {
          p.ellipse(params.x * w, params.y * h, params.width * w, params.height * h);
        }
        break;

      case 'rect':
        this.applyFillStroke(p, params);
        if (params.rotation) {
          p.translate(params.x * w, params.y * h);
          p.rotate(p.radians(params.rotation));
          p.rectMode(p.CENTER);
          p.rect(0, 0, params.width * w, params.height * h, params.cornerRadius || 0);
        } else {
          p.rectMode(p.CENTER);
          p.rect(params.x * w, params.y * h, params.width * w, params.height * h, params.cornerRadius || 0);
        }
        break;

      case 'line':
        if (params.stroke && params.stroke !== 'none') {
          p.stroke(p.color(params.stroke));
          p.strokeWeight(params.strokeWeight || 2);
        }
        p.line(params.x1 * w, params.y1 * h, params.x2 * w, params.y2 * h);
        break;

      case 'polygon':
        this.applyFillStroke(p, params);
        p.translate(params.x * w, params.y * h);
        p.rotate(p.radians(params.rotation || 0));
        this.drawPolygon(p, 0, 0, params.radius * Math.min(w, h), params.sides || 6);
        break;

      case 'text':
        p.fill(p.color(params.fill || '#ffffff'));
        p.noStroke();
        p.textSize(params.size || 32);
        p.textAlign(params.align === 'left' ? p.LEFT : params.align === 'right' ? p.RIGHT : p.CENTER, p.CENTER);
        p.text(params.text || '', params.x * w, params.y * h);
        break;

      case 'particles':
        this.renderParticles(p, node, w, h);
        break;

      case 'transform':
        break;
    }

    p.pop();
  },

  applyFillStroke: function(p, params) {
    if (params.fill && params.fill !== 'none') {
      p.fill(p.color(params.fill));
    } else {
      p.noFill();
    }

    if (params.stroke && params.stroke !== 'none') {
      p.stroke(p.color(params.stroke));
      p.strokeWeight(params.strokeWeight || 2);
    } else {
      p.noStroke();
    }
  },

  drawPolygon: function(p, x, y, radius, sides) {
    const angle = p.TWO_PI / sides;
    p.beginShape();
    for (let i = 0; i < sides; i++) {
      const sx = x + p.cos(angle * i - p.HALF_PI) * radius;
      const sy = y + p.sin(angle * i - p.HALF_PI) * radius;
      p.vertex(sx, sy);
    }
    p.endShape(p.CLOSE);
  },

  renderParticles: function(p, node, w, h) {
    const params = node.params;
    const id = node.id;

    if (!this.particleState[id]) {
      this.particleState[id] = {
        particles: [],
        lastSpawn: 0
      };
    }

    const state = this.particleState[id];
    const count = params.count || 50;
    const lifetime = (params.lifetime || 2) * 60;
    const speed = params.speed || 1;
    const spread = params.spread || 0.2;
    const size = params.size || 5;
    const fill = params.fill || '#ffffff';

    const spawnRate = Math.max(1, Math.floor(60 / count));
    if (p.frameCount % spawnRate === 0 && state.particles.length < count) {
      const angle = p.random(p.TWO_PI);
      const vel = p.random(0.5, 2) * speed;
      state.particles.push({
        x: params.x * w,
        y: params.y * h,
        vx: p.cos(angle) * vel * spread * 10,
        vy: p.sin(angle) * vel * spread * 10,
        life: lifetime,
        maxLife: lifetime,
        size: size * p.random(0.5, 1.5)
      });
    }

    p.noStroke();
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const particle = state.particles[i];

      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.05;
      particle.life--;

      if (particle.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }

      const alpha = p.map(particle.life, 0, particle.maxLife, 0, 255);
      const col = p.color(fill);
      col.setAlpha(alpha);
      p.fill(col);
      p.ellipse(particle.x, particle.y, particle.size);
    }
  },

  // Render visual nodes directly to a 2D canvas context (for in-node preview)
  renderToContext: function(ctx, x, y, w, h) {
    if (typeof AudioEngine === 'undefined') return;

    const canvasNode = AudioEngine.getCanvasNode();
    if (!canvasNode) return;

    // Only render nodes that are connected to the canvas
    const connectedNodes = AudioEngine.getConnectedVisualNodes();

    ctx.save();

    // Clip to preview area
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.clip();

    for (const node of connectedNodes) {
      this.renderNodeToContext(ctx, node, x, y, w, h);
    }

    ctx.restore();
  },

  // Render a single node to 2D context
  renderNodeToContext: function(ctx, node, ox, oy, w, h) {
    const params = node.params;

    ctx.save();

    switch (node.type) {
      case 'aiCanvas':
        // AI Canvas preview - draw actual p5 canvas content if available
        const liveNode = AudioEngine.nodes[node.id];
        if (liveNode?.aiCode) {
          // Try to get the p5 canvas from the preview container
          let p5Canvas = null;
          if (this.previewContainer) {
            p5Canvas = this.previewContainer.querySelector('canvas');
          }
          if (!p5Canvas && this.p5Instance) {
            p5Canvas = this.p5Instance.canvas;
          }

          if (p5Canvas && p5Canvas.width > 0 && p5Canvas.height > 0) {
            // Draw the actual p5 canvas content scaled to fit preview
            try {
              ctx.drawImage(p5Canvas, ox, oy, w, h);
            } catch (e) {
              // Fallback to indicator if canvas draw fails
              ctx.fillStyle = '#666';
              ctx.font = '10px -apple-system';
              ctx.textAlign = 'center';
              ctx.fillText('AI Visual Active', ox + w/2, oy + h/2);
            }
          } else {
            // Canvas not ready yet
            ctx.fillStyle = '#666';
            ctx.font = '10px -apple-system';
            ctx.textAlign = 'center';
            ctx.fillText('AI Visual Active', ox + w/2, oy + h/2);
          }
        } else {
          ctx.fillStyle = '#666';
          ctx.font = '10px -apple-system';
          ctx.textAlign = 'center';
          ctx.fillText('No AI code', ox + w/2, oy + h/2);
        }
        break;

      case 'ellipse':
        this.applyFillStrokeCtx(ctx, params);
        if (params.rotation) {
          ctx.translate(ox + params.x * w, oy + params.y * h);
          ctx.rotate(params.rotation * Math.PI / 180);
          ctx.beginPath();
          ctx.ellipse(0, 0, params.width * w / 2, params.height * h / 2, 0, 0, Math.PI * 2);
        } else {
          ctx.beginPath();
          ctx.ellipse(ox + params.x * w, oy + params.y * h, params.width * w / 2, params.height * h / 2, 0, 0, Math.PI * 2);
        }
        if (params.fill && params.fill !== 'none') ctx.fill();
        if (params.stroke && params.stroke !== 'none') ctx.stroke();
        break;

      case 'rect':
        this.applyFillStrokeCtx(ctx, params);
        const rw = params.width * w;
        const rh = params.height * h;
        if (params.rotation) {
          ctx.translate(ox + params.x * w, oy + params.y * h);
          ctx.rotate(params.rotation * Math.PI / 180);
          ctx.beginPath();
          ctx.roundRect(-rw/2, -rh/2, rw, rh, params.cornerRadius || 0);
        } else {
          ctx.beginPath();
          ctx.roundRect(ox + params.x * w - rw/2, oy + params.y * h - rh/2, rw, rh, params.cornerRadius || 0);
        }
        if (params.fill && params.fill !== 'none') ctx.fill();
        if (params.stroke && params.stroke !== 'none') ctx.stroke();
        break;

      case 'line':
        if (params.stroke && params.stroke !== 'none') {
          ctx.strokeStyle = params.stroke;
          ctx.lineWidth = params.strokeWeight || 2;
          ctx.beginPath();
          ctx.moveTo(ox + params.x1 * w, oy + params.y1 * h);
          ctx.lineTo(ox + params.x2 * w, oy + params.y2 * h);
          ctx.stroke();
        }
        break;

      case 'polygon':
        this.applyFillStrokeCtx(ctx, params);
        ctx.translate(ox + params.x * w, oy + params.y * h);
        ctx.rotate((params.rotation || 0) * Math.PI / 180);
        this.drawPolygonCtx(ctx, 0, 0, params.radius * Math.min(w, h), params.sides || 6);
        if (params.fill && params.fill !== 'none') ctx.fill();
        if (params.stroke && params.stroke !== 'none') ctx.stroke();
        break;

      case 'text':
        ctx.fillStyle = params.fill || '#ffffff';
        ctx.font = `${params.size || 32}px -apple-system, system-ui, sans-serif`;
        ctx.textAlign = params.align === 'left' ? 'left' : params.align === 'right' ? 'right' : 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(params.text || '', ox + params.x * w, oy + params.y * h);
        break;

      case 'particles':
        this.renderParticlesToContext(ctx, node, ox, oy, w, h);
        break;
    }

    ctx.restore();
  },

  applyFillStrokeCtx: function(ctx, params) {
    if (params.fill && params.fill !== 'none') {
      ctx.fillStyle = params.fill;
    }
    if (params.stroke && params.stroke !== 'none') {
      ctx.strokeStyle = params.stroke;
      ctx.lineWidth = params.strokeWeight || 2;
    }
  },

  drawPolygonCtx: function(ctx, x, y, radius, sides) {
    const angle = Math.PI * 2 / sides;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const sx = x + Math.cos(angle * i - Math.PI / 2) * radius;
      const sy = y + Math.sin(angle * i - Math.PI / 2) * radius;
      if (i === 0) {
        ctx.moveTo(sx, sy);
      } else {
        ctx.lineTo(sx, sy);
      }
    }
    ctx.closePath();
  },

  renderParticlesToContext: function(ctx, node, ox, oy, w, h) {
    const params = node.params;
    const id = node.id;

    if (!this.particleState[id]) {
      this.particleState[id] = {
        particles: [],
        lastSpawn: 0,
        frameCount: 0
      };
    }

    const state = this.particleState[id];
    state.frameCount++;

    const count = params.count || 50;
    const lifetime = (params.lifetime || 2) * 60;
    const speed = params.speed || 1;
    const spread = params.spread || 0.2;
    const size = params.size || 5;
    const fill = params.fill || '#ffffff';

    const spawnRate = Math.max(1, Math.floor(60 / count));
    if (state.frameCount % spawnRate === 0 && state.particles.length < count) {
      const angle = Math.random() * Math.PI * 2;
      const vel = (0.5 + Math.random() * 1.5) * speed;
      state.particles.push({
        x: params.x * w,
        y: params.y * h,
        vx: Math.cos(angle) * vel * spread * 10,
        vy: Math.sin(angle) * vel * spread * 10,
        life: lifetime,
        maxLife: lifetime,
        size: size * (0.5 + Math.random())
      });
    }

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const particle = state.particles[i];

      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.05;
      particle.life--;

      if (particle.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }

      const alpha = particle.life / particle.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(ox + particle.x, oy + particle.y, particle.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  destroy: function() {
    if (this.p5Instance) {
      this.p5Instance.remove();
      this.p5Instance = null;
    }
    if (this.fullscreenContainer) {
      this.fullscreenContainer.remove();
      this.fullscreenContainer = null;
    }
    this.particleState = {};
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VisualRenderer;
}
