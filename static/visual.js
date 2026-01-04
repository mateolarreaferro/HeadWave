// visual.js - p5.js Visual Renderer for HeadWave
// Renders visual nodes from the unified NodeEngine

const VisualRenderer = {
  p5Instance: null,
  previewContainer: null,
  fullscreenContainer: null,
  isFullscreen: false,
  enabled: false,

  particleState: {},

  init: function(previewContainerId) {
    this.previewContainer = document.getElementById(previewContainerId);
    if (!this.previewContainer) {
      console.warn('[VisualRenderer] Preview container not found:', previewContainerId);
      return false;
    }

    this.createP5Instance(this.previewContainer);
    return true;
  },

  createP5Instance: function(container) {
    const self = this;

    const sketch = function(p) {
      p.setup = function() {
        const canvas = p.createCanvas(container.clientWidth, container.clientHeight);
        canvas.parent(container);
        p.colorMode(p.HSB, 360, 100, 100, 255);
        p.frameRate(60);
      };

      p.windowResized = function() {
        p.resizeCanvas(container.clientWidth, container.clientHeight);
      };

      p.draw = function() {
        if (typeof AudioEngine !== 'undefined') {
          const canvasNode = AudioEngine.getCanvasNode();
          if (canvasNode) {
            self.enabled = true;
          }
        }

        if (!self.enabled) {
          p.background(13, 17, 23);
          p.fill(100);
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(12);
          p.text('Add a Canvas node', p.width / 2, p.height / 2);
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
    this.createP5Instance(this.fullscreenContainer);
    this.isFullscreen = true;

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
    this.createP5Instance(this.previewContainer);
    this.isFullscreen = false;

    document.removeEventListener('keydown', this._escHandler);
  },

  render: function(p) {
    if (typeof AudioEngine === 'undefined') return;

    const canvasNode = AudioEngine.getCanvasNode();
    if (!canvasNode) {
      this.enabled = false;
      return;
    }

    p.colorMode(p.RGB, 255);

    const bgColor = canvasNode.params.background || '#0d1117';
    const trails = canvasNode.params.trails || 0;

    if (trails > 0) {
      const alpha = p.map(trails, 0, 100, 255, 10);
      const c = p.color(bgColor);
      c.setAlpha(alpha);
      p.background(c);
    } else {
      p.background(bgColor);
    }

    // Only render nodes that are connected to the canvas
    const connectedNodes = AudioEngine.getConnectedVisualNodes();

    for (const node of connectedNodes) {
      this.renderNode(p, node);
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
