// patcher.js - Modern Visual Patching UI for HeadWave Audio Engine
// HiDPI-aware, drag-and-drop node editor with cable connections

const Patcher = {
  // DOM elements
  canvas: null,
  ctx: null,
  container: null,
  dpr: 1, // Device pixel ratio for HiDPI

  // State
  nodes: [],
  cables: [],
  dragging: null,
  connecting: null,
  selectedNode: null,
  hoveredPort: null,
  hoveredCable: null,
  mousePos: { x: 0, y: 0 },
  isFullscreen: false,
  originalStyles: null,

  // Layout
  nodeWidth: 180,
  nodeHeight: 100,
  portRadius: 8,
  headerHeight: 32,
  cornerRadius: 12,

  // Theme
  theme: {
    bg: {
      primary: '#0d1117',
      secondary: '#161b22',
      tertiary: '#21262d'
    },
    accent: {
      source: '#f97316',      // Orange
      processor: '#06b6d4',   // Cyan
      modulator: '#a855f7',   // Purple
      output: '#22c55e',      // Green
      data: '#3b82f6'         // Blue
    },
    text: {
      primary: '#f0f6fc',
      secondary: '#8b949e',
      muted: '#484f58'
    },
    port: {
      input: '#58a6ff',
      output: '#f97316',
      hover: '#ffffff'
    },
    cable: {
      default: '#58a6ff',
      active: '#a855f7',
      glow: 'rgba(88, 166, 255, 0.3)'
    },
    node: {
      bg: '#1c2128',
      bgSelected: '#263038',
      border: '#30363d',
      borderSelected: '#58a6ff'
    }
  },

  // Initialize
  init: function(containerOrId) {
    if (typeof containerOrId === 'string') {
      this.container = document.getElementById(containerOrId);
    } else {
      this.container = containerOrId;
    }

    if (!this.container) return false;

    // Get device pixel ratio for sharp rendering
    this.dpr = window.devicePixelRatio || 1;

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: default;';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Size canvas with HiDPI support
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Create fullscreen button
    this.createFullscreenButton();

    // Event listeners
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));

    // ESC to exit fullscreen
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isFullscreen) {
        this.toggleFullscreen();
      }
    });
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e);
    });

    // Start render
    this.render();
    return true;
  },

  // Resize with HiDPI support
  resize: function() {
    if (!this.canvas || !this.container) return;

    const rect = this.container.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 600;

    // Set display size
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';

    // Set actual size in memory (scaled for HiDPI)
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;

    // Scale context
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  },

  // Create fullscreen toggle button
  createFullscreenButton: function() {
    const btn = document.createElement('button');
    btn.className = 'patcher-fullscreen-btn';
    btn.innerHTML = '⛶';
    btn.title = 'Toggle Fullscreen (ESC to exit)';
    btn.style.cssText = `
      position: absolute; top: 10px; right: 10px; z-index: 100;
      width: 32px; height: 32px; border-radius: 6px;
      background: ${this.theme.bg.tertiary}; border: 1px solid ${this.theme.node.border};
      color: ${this.theme.text.secondary}; font-size: 16px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.15s ease;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.background = this.theme.bg.secondary;
      btn.style.color = this.theme.text.primary;
      btn.style.borderColor = this.theme.port.input;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = this.theme.bg.tertiary;
      btn.style.color = this.theme.text.secondary;
      btn.style.borderColor = this.theme.node.border;
    });
    btn.addEventListener('click', () => this.toggleFullscreen());
    this.container.appendChild(btn);
    this.fullscreenBtn = btn;
  },

  // Toggle fullscreen mode
  toggleFullscreen: function() {
    if (!this.isFullscreen) {
      // Save original styles
      this.originalStyles = {
        position: this.container.style.position,
        top: this.container.style.top,
        left: this.container.style.left,
        width: this.container.style.width,
        height: this.container.style.height,
        zIndex: this.container.style.zIndex,
        borderRadius: this.container.style.borderRadius
      };

      // Go fullscreen
      this.container.style.position = 'fixed';
      this.container.style.top = '0';
      this.container.style.left = '0';
      this.container.style.width = '100vw';
      this.container.style.height = '100vh';
      this.container.style.zIndex = '9999';
      this.container.style.borderRadius = '0';
      this.fullscreenBtn.innerHTML = '⛶';
      this.fullscreenBtn.title = 'Exit Fullscreen (ESC)';
      this.isFullscreen = true;
    } else {
      // Restore original styles
      Object.assign(this.container.style, this.originalStyles);
      this.fullscreenBtn.innerHTML = '⛶';
      this.fullscreenBtn.title = 'Toggle Fullscreen (ESC to exit)';
      this.isFullscreen = false;
    }

    // Resize canvas after style change
    setTimeout(() => this.resize(), 50);
  },

  // Get mouse position adjusted for HiDPI
  getMousePos: function(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  },

  // Add node
  addNode: function(type, x, y) {
    const nodeType = AudioEngine.nodeTypes[type];
    if (!nodeType) return null;

    const audioNode = AudioEngine.createNode(type, x, y);
    if (!audioNode) return null;

    const node = {
      id: audioNode.id,
      type: type,
      name: nodeType.name,
      category: nodeType.category,
      x: x || 100,
      y: y || 100,
      inputs: nodeType.inputs || [],
      outputs: nodeType.outputs || [],
      params: { ...audioNode.params }
    };

    this.nodes.push(node);
    return node;
  },

  // Remove node
  removeNode: function(nodeId) {
    const index = this.nodes.findIndex(n => n.id === nodeId);
    if (index === -1) return;

    this.cables = this.cables.filter(c => c.fromNode !== nodeId && c.toNode !== nodeId);
    AudioEngine.deleteNode(nodeId);
    this.nodes.splice(index, 1);

    if (this.selectedNode === nodeId) {
      this.selectedNode = null;
    }
  },

  // Connect nodes
  connectNodes: function(fromNodeId, fromPort, toNodeId, toPort) {
    const exists = this.cables.some(c =>
      c.fromNode === fromNodeId && c.fromPort === fromPort &&
      c.toNode === toNodeId && c.toPort === toPort
    );
    if (exists) return false;

    if (AudioEngine.connect(fromNodeId, fromPort, toNodeId, toPort)) {
      this.cables.push({ fromNode: fromNodeId, fromPort, toNode: toNodeId, toPort });
      return true;
    }
    return false;
  },

  // Get node at position
  getNodeAt: function(x, y) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (x >= node.x && x <= node.x + this.nodeWidth &&
          y >= node.y && y <= node.y + this.nodeHeight) {
        return node;
      }
    }
    return null;
  },

  // Get port positions
  getInputPorts: function(node) {
    const ports = [];
    const inputs = node.inputs || [];
    const spacing = this.nodeWidth / (inputs.length + 1);
    for (let i = 0; i < inputs.length; i++) {
      ports.push({ name: inputs[i], x: node.x + spacing * (i + 1), y: node.y });
    }
    return ports;
  },

  getOutputPorts: function(node) {
    const ports = [];
    const outputs = node.outputs || [];
    const spacing = this.nodeWidth / (outputs.length + 1);
    for (let i = 0; i < outputs.length; i++) {
      ports.push({ name: outputs[i], x: node.x + spacing * (i + 1), y: node.y + this.nodeHeight });
    }
    return ports;
  },

  // Get port at position
  getPortAt: function(x, y) {
    const hitRadius = this.portRadius * 2;
    for (const node of this.nodes) {
      for (const port of this.getOutputPorts(node)) {
        if (Math.hypot(x - port.x, y - port.y) <= hitRadius) {
          return { node, port: port.name, type: 'output', x: port.x, y: port.y };
        }
      }
      for (const port of this.getInputPorts(node)) {
        if (Math.hypot(x - port.x, y - port.y) <= hitRadius) {
          return { node, port: port.name, type: 'input', x: port.x, y: port.y };
        }
      }
    }
    return null;
  },

  // Get cable at position (check if point is near cable path)
  getCableAt: function(x, y) {
    const hitDistance = 10;
    for (const cable of this.cables) {
      const fromNode = this.nodes.find(n => n.id === cable.fromNode);
      const toNode = this.nodes.find(n => n.id === cable.toNode);
      if (!fromNode || !toNode) continue;

      const fromPort = this.getOutputPorts(fromNode).find(p => p.name === cable.fromPort);
      const toPort = this.getInputPorts(toNode).find(p => p.name === cable.toPort);
      if (!fromPort || !toPort) continue;

      // Sample points along bezier curve and check distance
      const x1 = fromPort.x, y1 = fromPort.y;
      const x2 = toPort.x, y2 = toPort.y;
      const dy = Math.abs(y2 - y1);
      const controlY = Math.max(50, dy * 0.5);

      for (let t = 0; t <= 1; t += 0.05) {
        const mt = 1 - t;
        // Bezier curve point calculation
        const bx = mt*mt*mt*x1 + 3*mt*mt*t*x1 + 3*mt*t*t*x2 + t*t*t*x2;
        const by = mt*mt*mt*y1 + 3*mt*mt*t*(y1+controlY) + 3*mt*t*t*(y2-controlY) + t*t*t*y2;

        if (Math.hypot(x - bx, y - by) <= hitDistance) {
          return cable;
        }
      }
    }
    return null;
  },

  // Remove cable
  removeCable: function(cable) {
    const index = this.cables.indexOf(cable);
    if (index === -1) return;

    AudioEngine.disconnect(cable.fromNode, cable.toNode);
    this.cables.splice(index, 1);
  },

  // Mouse handlers
  onMouseDown: function(e) {
    const pos = this.getMousePos(e);

    // Check port click
    const port = this.getPortAt(pos.x, pos.y);
    if (port && port.type === 'output') {
      this.connecting = { fromNode: port.node.id, fromPort: port.port, x: pos.x, y: pos.y };
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // Check node click
    const node = this.getNodeAt(pos.x, pos.y);
    if (node) {
      this.selectedNode = node.id;
      this.dragging = { node, offsetX: pos.x - node.x, offsetY: pos.y - node.y };

      // Bring to front
      const idx = this.nodes.indexOf(node);
      this.nodes.splice(idx, 1);
      this.nodes.push(node);
      this.canvas.style.cursor = 'grabbing';
    } else {
      this.selectedNode = null;
    }
  },

  onMouseMove: function(e) {
    const pos = this.getMousePos(e);
    this.mousePos = pos;

    if (this.dragging) {
      this.dragging.node.x = pos.x - this.dragging.offsetX;
      this.dragging.node.y = pos.y - this.dragging.offsetY;
      if (AudioEngine.nodes[this.dragging.node.id]) {
        AudioEngine.nodes[this.dragging.node.id].x = this.dragging.node.x;
        AudioEngine.nodes[this.dragging.node.id].y = this.dragging.node.y;
      }
    } else if (this.connecting) {
      this.connecting.x = pos.x;
      this.connecting.y = pos.y;
    } else {
      // Update cursor based on hover
      const port = this.getPortAt(pos.x, pos.y);
      const node = this.getNodeAt(pos.x, pos.y);
      const cable = !port && !node ? this.getCableAt(pos.x, pos.y) : null;
      this.hoveredPort = port;
      this.hoveredCable = cable;

      if (port) {
        this.canvas.style.cursor = 'crosshair';
      } else if (node) {
        this.canvas.style.cursor = 'grab';
      } else if (cable) {
        this.canvas.style.cursor = 'pointer';
      } else {
        this.canvas.style.cursor = 'default';
      }
    }
  },

  onMouseUp: function(e) {
    const pos = this.getMousePos(e);

    if (this.connecting) {
      const port = this.getPortAt(pos.x, pos.y);
      if (port && port.type === 'input' && port.node.id !== this.connecting.fromNode) {
        this.connectNodes(this.connecting.fromNode, this.connecting.fromPort, port.node.id, port.port);
      }
      this.connecting = null;
    }

    this.dragging = null;
    this.canvas.style.cursor = 'default';
  },

  onDoubleClick: function(e) {
    const pos = this.getMousePos(e);
    const node = this.getNodeAt(pos.x, pos.y);
    if (node) {
      this.showParamsDialog(node);
    }
  },

  // Context menu
  showContextMenu: function(e) {
    const pos = this.getMousePos(e);
    const node = this.getNodeAt(pos.x, pos.y);
    const cable = !node ? this.getCableAt(pos.x, pos.y) : null;

    // Remove existing
    document.querySelectorAll('.patcher-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'patcher-menu';
    menu.style.cssText = `
      position: fixed; left: ${e.clientX}px; top: ${e.clientY}px;
      background: ${this.theme.bg.secondary}; border: 1px solid ${this.theme.node.border};
      border-radius: 8px; padding: 6px 0; z-index: 10000; min-width: 200px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4); font-family: -apple-system, system-ui, sans-serif;
    `;

    const menuItemStyle = `
      padding: 8px 16px; cursor: pointer; font-size: 13px; color: ${this.theme.text.primary};
      transition: background 0.1s;
    `;
    const menuItemDangerStyle = `
      padding: 8px 16px; cursor: pointer; font-size: 13px; color: #f85149;
      transition: background 0.1s;
    `;
    const menuHeaderStyle = `
      padding: 6px 16px; font-size: 10px; font-weight: 600; color: ${this.theme.text.muted};
      text-transform: uppercase; letter-spacing: 0.5px;
    `;

    if (node) {
      menu.innerHTML = `
        <div style="${menuItemStyle}" class="menu-item" data-action="params">Edit Parameters</div>
        <div style="${menuItemDangerStyle}" class="menu-item" data-action="delete">Delete Node</div>
      `;
    } else if (cable) {
      menu.innerHTML = `
        <div style="${menuItemDangerStyle}" class="menu-item" data-action="delete-cable">Delete Cable</div>
      `;
      menu._cable = cable;
    } else {
      const categories = {
        'Sources': [
          { type: 'oscillator', icon: '〜', desc: 'Sine/Saw/Square wave' },
          { type: 'noise', icon: '⁂', desc: 'White/Pink noise' },
          { type: 'sampler', icon: '▶', desc: 'Sample player' }
        ],
        'Effects': [
          { type: 'filter', icon: '◇', desc: 'LP/HP/BP filter' },
          { type: 'gain', icon: '▲', desc: 'Volume control' },
          { type: 'delay', icon: '◌', desc: 'Echo effect' },
          { type: 'scale', icon: '↔', desc: 'Map 0-1 to min-max' }
        ],
        'Modulators': [
          { type: 'lfo', icon: '∿', desc: 'Low freq oscillator' },
          { type: 'eegBand', icon: '◉', desc: 'EEG band power' },
          { type: 'cvFeature', icon: '◎', desc: 'Face features' },
          { type: 'handFeature', icon: '✋', desc: 'Hand tracking' }
        ],
        'Output': [
          { type: 'output', icon: '◈', desc: 'Audio output' }
        ]
      };

      let html = '';
      for (const [cat, items] of Object.entries(categories)) {
        html += `<div style="${menuHeaderStyle}">${cat}</div>`;
        for (const item of items) {
          const name = AudioEngine.nodeTypes[item.type]?.name || item.type;
          html += `
            <div style="${menuItemStyle}" class="menu-item" data-action="add" data-type="${item.type}">
              <span style="display: inline-block; width: 20px; text-align: center;">${item.icon}</span>
              <span>${name}</span>
              <span style="float: right; color: ${this.theme.text.muted}; font-size: 11px;">${item.desc}</span>
            </div>
          `;
        }
      }
      menu.innerHTML = html;
    }

    document.body.appendChild(menu);

    // Style hover
    menu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('mouseenter', () => item.style.background = this.theme.bg.tertiary);
      item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    });

    // Handle clicks
    menu.addEventListener('click', (evt) => {
      const item = evt.target.closest('.menu-item');
      if (!item) return;

      const action = item.dataset.action;
      if (action === 'add') {
        this.addNode(item.dataset.type, pos.x, pos.y);
      } else if (action === 'delete' && node) {
        this.removeNode(node.id);
      } else if (action === 'delete-cable' && menu._cable) {
        this.removeCable(menu._cable);
      } else if (action === 'params' && node) {
        this.showParamsDialog(node);
      }
      menu.remove();
    });

    // Close on outside click
    setTimeout(() => {
      const close = (evt) => {
        if (!menu.contains(evt.target)) {
          menu.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  },

  // Parameters dialog
  showParamsDialog: function(node) {
    const nodeType = AudioEngine.nodeTypes[node.type];
    if (!nodeType?.params && node.type !== 'sampler') return;

    document.querySelectorAll('.patcher-dialog').forEach(d => d.remove());

    const dialog = document.createElement('div');
    dialog.className = 'patcher-dialog';
    dialog.style.cssText = `
      position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
      background: ${this.theme.bg.secondary}; border: 1px solid ${this.theme.node.border};
      border-radius: 12px; padding: 20px; z-index: 10001; min-width: 300px;
      box-shadow: 0 16px 64px rgba(0,0,0,0.5); font-family: -apple-system, system-ui, sans-serif;
    `;

    const accentColor = this.theme.accent[node.category] || this.theme.accent.processor;
    let html = `
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid ${this.theme.node.border};">
        <div style="width: 8px; height: 8px; border-radius: 50%; background: ${accentColor};"></div>
        <h3 style="margin: 0; color: ${this.theme.text.primary}; font-size: 16px; font-weight: 600;">${node.name}</h3>
      </div>
    `;

    // Add file upload for sampler nodes
    if (node.type === 'sampler') {
      const hasFile = AudioEngine.sampleBuffers[node.id];
      html += `
        <div style="margin-bottom: 14px;">
          <label style="display: block; color: ${this.theme.text.secondary}; font-size: 12px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Audio File</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="file" id="sampler-file-${node.id}" accept="audio/*" style="display: none;">
            <button id="sampler-upload-btn-${node.id}" style="flex: 1; padding: 10px 12px; background: ${this.theme.bg.primary}; color: ${this.theme.text.primary}; border: 1px solid ${this.theme.node.border}; border-radius: 6px; cursor: pointer; font-size: 13px;">
              ${hasFile ? '✓ Sample Loaded - Click to Change' : 'Choose Audio File...'}
            </button>
          </div>
          <div id="sampler-filename-${node.id}" style="margin-top: 6px; font-size: 11px; color: ${this.theme.text.muted};"></div>
        </div>
      `;
    }

    for (const [param, config] of Object.entries(nodeType.params)) {
      const value = node.params[param];

      if (config.options) {
        html += `
          <div style="margin-bottom: 14px;">
            <label style="display: block; color: ${this.theme.text.secondary}; font-size: 12px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${param}</label>
            <select data-param="${param}" style="width: 100%; padding: 10px 12px; background: ${this.theme.bg.primary}; color: ${this.theme.text.primary}; border: 1px solid ${this.theme.node.border}; border-radius: 6px; font-size: 14px; cursor: pointer;">
              ${config.options.map(opt => `<option value="${opt}" ${opt === value ? 'selected' : ''}>${opt}</option>`).join('')}
            </select>
          </div>
        `;
      } else {
        html += `
          <div style="margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
              <label style="color: ${this.theme.text.secondary}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">${param}</label>
              <span id="val-${param}" style="color: ${accentColor}; font-size: 12px; font-weight: 600;">${typeof value === 'number' ? value.toFixed(2) : value}</span>
            </div>
            <input type="range" data-param="${param}" min="${config.min}" max="${config.max}" step="${(config.max - config.min) / 100}" value="${value}"
              style="width: 100%; height: 6px; border-radius: 3px; appearance: none; background: ${this.theme.bg.primary}; cursor: pointer;">
          </div>
        `;
      }
    }

    html += `
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button class="dialog-close" style="flex: 1; padding: 10px; background: ${this.theme.bg.tertiary}; color: ${this.theme.text.primary}; border: 1px solid ${this.theme.node.border}; border-radius: 6px; cursor: pointer; font-size: 14px;">Close</button>
      </div>
    `;

    dialog.innerHTML = html;
    document.body.appendChild(dialog);

    // Style range inputs
    dialog.querySelectorAll('input[type="range"]').forEach(range => {
      range.style.cssText += `
        --webkit-slider-thumb { appearance: none; width: 16px; height: 16px; border-radius: 50%; background: ${accentColor}; cursor: pointer; }
      `;
    });

    // Handle changes
    dialog.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', (e) => {
        const param = e.target.dataset.param;
        let value = e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value;
        node.params[param] = value;
        AudioEngine.setParam(node.id, param, value);
        const valEl = document.getElementById(`val-${param}`);
        if (valEl) valEl.textContent = typeof value === 'number' ? value.toFixed(2) : value;
      });
    });

    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.remove());

    // Handle sampler file upload
    if (node.type === 'sampler') {
      const fileInput = dialog.querySelector(`#sampler-file-${node.id}`);
      const uploadBtn = dialog.querySelector(`#sampler-upload-btn-${node.id}`);
      const filenameDiv = dialog.querySelector(`#sampler-filename-${node.id}`);

      if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;

          uploadBtn.textContent = 'Loading...';
          uploadBtn.disabled = true;

          try {
            await AudioEngine.loadSampleForNode(node.id, file);
            uploadBtn.textContent = '✓ ' + file.name;
            uploadBtn.style.borderColor = '#22c55e';
            filenameDiv.textContent = `Duration: ${(AudioEngine.sampleBuffers[node.id].duration).toFixed(2)}s`;
          } catch (err) {
            uploadBtn.textContent = 'Error - Try Again';
            uploadBtn.style.borderColor = '#f85149';
            filenameDiv.textContent = err.message;
          }

          uploadBtn.disabled = false;
        });
      }
    }
  },

  // Render
  render: function() {
    if (!this.ctx || !this.canvas) return;

    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    // Background
    ctx.fillStyle = this.theme.bg.primary;
    ctx.fillRect(0, 0, w, h);

    // Grid dots
    ctx.fillStyle = this.theme.text.muted + '30';
    const gridSize = 30;
    for (let x = gridSize; x < w; x += gridSize) {
      for (let y = gridSize; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Cables
    for (const cable of this.cables) {
      this.drawCable(cable);
    }

    // Active connection
    if (this.connecting) {
      const fromNode = this.nodes.find(n => n.id === this.connecting.fromNode);
      if (fromNode) {
        const port = this.getOutputPorts(fromNode).find(p => p.name === this.connecting.fromPort);
        if (port) {
          this.drawCablePath(port.x, port.y, this.connecting.x, this.connecting.y, this.theme.cable.active, true);
        }
      }
    }

    // Nodes
    for (const node of this.nodes) {
      this.drawNode(node);
    }

    // Instructions overlay (if no nodes)
    if (this.nodes.length === 0) {
      ctx.fillStyle = this.theme.text.muted;
      ctx.font = '14px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Right-click to add nodes', w / 2, h / 2 - 20);
      ctx.font = '12px -apple-system, system-ui, sans-serif';
      ctx.fillText('Drag from output ports to connect', w / 2, h / 2 + 10);
    }

    requestAnimationFrame(() => this.render());
  },

  // Draw node
  drawNode: function(node) {
    const ctx = this.ctx;
    const { x, y } = node;
    const w = this.nodeWidth;
    const h = this.nodeHeight;
    const r = this.cornerRadius;
    const hh = this.headerHeight;
    const isSelected = node.id === this.selectedNode;
    const accentColor = this.theme.accent[node.category] || this.theme.accent.processor;

    // Get live value from AudioEngine
    const audioNode = AudioEngine.nodes[node.id];
    const liveValue = audioNode?.outputValue;
    const hasLiveValue = liveValue !== undefined && liveValue !== null;

    // Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = isSelected ? 24 : 12;
    ctx.shadowOffsetY = isSelected ? 8 : 4;

    // Body
    ctx.fillStyle = isSelected ? this.theme.node.bgSelected : this.theme.node.bg;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Border
    ctx.strokeStyle = isSelected ? this.theme.node.borderSelected : this.theme.node.border;
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();

    // Header accent line
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 4, [r, r, 0, 0]);
    ctx.fill();

    // Title
    ctx.fillStyle = this.theme.text.primary;
    ctx.font = '600 13px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.name, x + 12, y + hh / 2 + 6);

    // Live value display (top right of node)
    if (hasLiveValue) {
      const displayValue = liveValue < 10 ? liveValue.toFixed(3) : liveValue.toFixed(1);
      const valueWidth = ctx.measureText(displayValue).width + 12;

      // Value badge background
      ctx.fillStyle = accentColor + '30';
      ctx.beginPath();
      ctx.roundRect(x + w - valueWidth - 8, y + 10, valueWidth, 18, 4);
      ctx.fill();

      // Value text
      ctx.fillStyle = accentColor;
      ctx.font = '600 11px -apple-system, system-ui, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(displayValue, x + w - 14, y + 21);
      ctx.textAlign = 'left';
    }

    // Params preview
    ctx.fillStyle = this.theme.text.secondary;
    ctx.font = '11px -apple-system, system-ui, sans-serif';
    let py = y + hh + 14;

    // Special display for sampler nodes
    if (node.type === 'sampler') {
      const hasBuffer = AudioEngine.sampleBuffers && AudioEngine.sampleBuffers[node.id];
      if (hasBuffer) {
        ctx.fillStyle = '#22c55e';
        ctx.fillText('✓ Sample loaded', x + 12, py);
        py += 16;
        ctx.fillStyle = this.theme.text.secondary;
        ctx.fillText(`speed: ${node.params.speed?.toFixed(2) || 1}`, x + 12, py);
      } else {
        ctx.fillStyle = this.theme.text.muted;
        ctx.fillText('Double-click to load', x + 12, py);
        py += 16;
        ctx.fillText('audio file...', x + 12, py);
      }
    } else {
      const paramKeys = Object.keys(node.params).slice(0, 2);
      for (const key of paramKeys) {
        let val = node.params[key];
        if (typeof val === 'number') val = val.toFixed(1);
        ctx.fillText(`${key}: ${val}`, x + 12, py);
        py += 16;
      }
    }

    // Signal flow indicator bar (for modulators)
    if (hasLiveValue && (node.category === 'modulator' || node.type === 'scale')) {
      const barY = y + h - 12;
      const barWidth = w - 24;
      const barHeight = 4;

      // Background bar
      ctx.fillStyle = this.theme.bg.primary;
      ctx.beginPath();
      ctx.roundRect(x + 12, barY, barWidth, barHeight, 2);
      ctx.fill();

      // Value bar (normalized for display)
      let normalizedValue = node.type === 'scale'
        ? (liveValue - node.params.min) / (node.params.max - node.params.min)
        : liveValue;
      normalizedValue = Math.max(0, Math.min(1, normalizedValue));

      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.roundRect(x + 12, barY, barWidth * normalizedValue, barHeight, 2);
      ctx.fill();
    }

    // Input ports
    for (const port of this.getInputPorts(node)) {
      const isHovered = this.hoveredPort?.node.id === node.id &&
                        this.hoveredPort?.port === port.name &&
                        this.hoveredPort?.type === 'input';
      this.drawPort(port.x, port.y, this.theme.port.input, isHovered, port.name, true);
    }

    // Output ports
    for (const port of this.getOutputPorts(node)) {
      const isHovered = this.hoveredPort?.node.id === node.id &&
                        this.hoveredPort?.port === port.name &&
                        this.hoveredPort?.type === 'output';
      this.drawPort(port.x, port.y, this.theme.port.output, isHovered, port.name, false);
    }
  },

  // Draw port
  drawPort: function(x, y, color, isHovered, label, isInput) {
    const ctx = this.ctx;
    const r = this.portRadius;

    // Glow
    if (isHovered) {
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.fillStyle = color + '40';
      ctx.fill();
    }

    // Port circle
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = isHovered ? this.theme.port.hover : color;
    ctx.fill();

    // Inner dot
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = this.theme.bg.primary;
    ctx.fill();

    // Label
    ctx.fillStyle = this.theme.text.muted;
    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = isInput ? 'bottom' : 'top';
    ctx.fillText(label, x, isInput ? y - r - 4 : y + r + 4);
  },

  // Draw cable
  drawCable: function(cable) {
    const fromNode = this.nodes.find(n => n.id === cable.fromNode);
    const toNode = this.nodes.find(n => n.id === cable.toNode);
    if (!fromNode || !toNode) return;

    const fromPort = this.getOutputPorts(fromNode).find(p => p.name === cable.fromPort);
    const toPort = this.getInputPorts(toNode).find(p => p.name === cable.toPort);
    if (!fromPort || !toPort) return;

    const isHovered = this.hoveredCable === cable;
    const color = isHovered ? '#f85149' : this.theme.cable.default;
    this.drawCablePath(fromPort.x, fromPort.y, toPort.x, toPort.y, color, isHovered);

    // Show value on cable (at midpoint)
    const audioNode = AudioEngine.nodes[cable.fromNode];
    if (audioNode?.outputValue !== undefined) {
      const value = audioNode.outputValue;
      const midX = (fromPort.x + toPort.x) / 2;
      const midY = (fromPort.y + toPort.y) / 2;

      // Format value for display
      const displayValue = value < 10 ? value.toFixed(2) : value.toFixed(0);

      // Draw value badge on cable
      const ctx = this.ctx;
      ctx.font = '10px -apple-system, system-ui, monospace';
      const textWidth = ctx.measureText(displayValue).width;
      const badgeWidth = textWidth + 8;
      const badgeHeight = 14;

      // Badge background
      ctx.fillStyle = this.theme.bg.secondary;
      ctx.beginPath();
      ctx.roundRect(midX - badgeWidth/2, midY - badgeHeight/2, badgeWidth, badgeHeight, 3);
      ctx.fill();

      // Badge border
      ctx.strokeStyle = isHovered ? '#f85149' : this.theme.cable.default;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Value text
      ctx.fillStyle = isHovered ? '#f85149' : this.theme.text.primary;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayValue, midX, midY);
    }
  },

  drawCablePath: function(x1, y1, x2, y2, color, isActive) {
    const ctx = this.ctx;
    const dy = Math.abs(y2 - y1);
    const controlY = Math.max(50, dy * 0.5);

    // Glow
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1, y1 + controlY, x2, y2 - controlY, x2, y2);
    ctx.strokeStyle = color + '40';
    ctx.lineWidth = isActive ? 8 : 6;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Main line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1, y1 + controlY, x2, y2 - controlY, x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = isActive ? 3 : 2;
    ctx.stroke();
  },

  // Clear all
  clear: function() {
    for (const node of [...this.nodes]) {
      this.removeNode(node.id);
    }
  },

  // Save/Load
  save: function() {
    return {
      nodes: this.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, params: n.params })),
      cables: [...this.cables]
    };
  },

  load: function(patch) {
    this.clear();
    for (const nodeData of patch.nodes || []) {
      const node = this.addNode(nodeData.type, nodeData.x, nodeData.y);
      if (node && nodeData.params) {
        Object.assign(node.params, nodeData.params);
      }
    }
    for (const cable of patch.cables || []) {
      this.connectNodes(cable.fromNode, cable.fromPort, cable.toNode, cable.toPort);
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Patcher;
}
