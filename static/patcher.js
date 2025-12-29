// patcher.js - Visual Patching UI for HeadWave Audio Engine
// Drag-and-drop node editor with cable connections

const Patcher = {
  // DOM elements
  canvas: null,
  ctx: null,
  container: null,

  // State
  nodes: [],
  cables: [],
  dragging: null,
  connecting: null,
  selectedNode: null,

  // Layout
  nodeWidth: 160,
  nodeHeight: 90,
  portRadius: 7,
  headerHeight: 28,
  cornerRadius: 10,

  // Modern colors
  colors: {
    background: '#0f0f1a',
    grid: '#1a1a2e',
    node: '#1e1e2e',
    nodeSelected: '#2a2a4a',
    nodeBorder: '#3a3a5a',
    nodeHeader: {
      source: '#ff6b9d',
      processor: '#4ecdc4',
      modulator: '#ffe66d',
      output: '#a78bfa',
      data: '#6ee7b7'
    },
    port: '#ffffff',
    portInput: '#6ee7b7',
    portOutput: '#ff6b9d',
    portHover: '#ffffff',
    cable: 'rgba(110, 231, 183, 0.8)',
    cableConnecting: 'rgba(255, 107, 157, 0.8)',
    cableGlow: 'rgba(110, 231, 183, 0.3)',
    text: '#ffffff',
    textMuted: '#8888aa',
    textParam: '#aaaacc'
  },

  // Initialize the patcher
  init: function(containerOrId) {
    // Accept either element or ID string
    if (typeof containerOrId === 'string') {
      this.container = document.getElementById(containerOrId);
    } else {
      this.container = containerOrId;
    }

    if (!this.container) {
      return false;
    }

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'patcher-canvas';
    this.canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: crosshair;';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Set size
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));

    // Context menu
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e);
    });

    // Start render loop
    this.render();

    return true;
  },

  // Resize canvas
  resize: function() {
    if (!this.canvas || !this.container) return;

    const rect = this.container.getBoundingClientRect();
    // Use parent dimensions if container has no size
    let width = rect.width || this.container.parentElement?.offsetWidth || 800;
    let height = rect.height || this.container.parentElement?.offsetHeight || 600;

    this.canvas.width = width;
    this.canvas.height = height;
  },

  // Add a node
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
      inputs: nodeType.inputs,
      outputs: nodeType.outputs,
      params: { ...audioNode.params }
    };

    this.nodes.push(node);
    return node;
  },

  // Remove a node
  removeNode: function(nodeId) {
    const index = this.nodes.findIndex(n => n.id === nodeId);
    if (index === -1) return;

    // Remove cables connected to this node
    this.cables = this.cables.filter(c =>
      c.fromNode !== nodeId && c.toNode !== nodeId
    );

    // Remove from audio engine
    AudioEngine.deleteNode(nodeId);

    this.nodes.splice(index, 1);

    if (this.selectedNode === nodeId) {
      this.selectedNode = null;
    }
  },

  // Connect nodes
  connectNodes: function(fromNodeId, fromPort, toNodeId, toPort) {
    // Check if cable already exists
    const exists = this.cables.some(c =>
      c.fromNode === fromNodeId && c.fromPort === fromPort &&
      c.toNode === toNodeId && c.toPort === toPort
    );
    if (exists) return false;

    // Create connection in audio engine
    if (AudioEngine.connect(fromNodeId, fromPort, toNodeId, toPort)) {
      this.cables.push({
        fromNode: fromNodeId,
        fromPort: fromPort,
        toNode: toNodeId,
        toPort: toPort
      });
      return true;
    }
    return false;
  },

  // Disconnect nodes
  disconnectCable: function(index) {
    const cable = this.cables[index];
    if (!cable) return;

    AudioEngine.disconnect(cable.fromNode, cable.toNode);
    this.cables.splice(index, 1);
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

  // Get port at position
  getPortAt: function(x, y) {
    for (const node of this.nodes) {
      // Check outputs
      const outputPorts = this.getOutputPorts(node);
      for (const port of outputPorts) {
        const dx = x - port.x;
        const dy = y - port.y;
        if (dx * dx + dy * dy <= this.portRadius * this.portRadius * 4) {
          return { node: node, port: port.name, type: 'output' };
        }
      }

      // Check inputs
      const inputPorts = this.getInputPorts(node);
      for (const port of inputPorts) {
        const dx = x - port.x;
        const dy = y - port.y;
        if (dx * dx + dy * dy <= this.portRadius * this.portRadius * 4) {
          return { node: node, port: port.name, type: 'input' };
        }
      }
    }
    return null;
  },

  // Get input port positions
  getInputPorts: function(node) {
    const ports = [];
    const inputs = node.inputs || [];
    const spacing = this.nodeWidth / (inputs.length + 1);

    for (let i = 0; i < inputs.length; i++) {
      ports.push({
        name: inputs[i],
        x: node.x + spacing * (i + 1),
        y: node.y
      });
    }
    return ports;
  },

  // Get output port positions
  getOutputPorts: function(node) {
    const ports = [];
    const outputs = node.outputs || [];
    const spacing = this.nodeWidth / (outputs.length + 1);

    for (let i = 0; i < outputs.length; i++) {
      ports.push({
        name: outputs[i],
        x: node.x + spacing * (i + 1),
        y: node.y + this.nodeHeight
      });
    }
    return ports;
  },

  // Mouse handlers
  onMouseDown: function(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check for port click (start connection)
    const port = this.getPortAt(x, y);
    if (port && port.type === 'output') {
      this.connecting = {
        fromNode: port.node.id,
        fromPort: port.port,
        x: x,
        y: y
      };
      return;
    }

    // Check for node click
    const node = this.getNodeAt(x, y);
    if (node) {
      this.selectedNode = node.id;
      this.dragging = {
        node: node,
        offsetX: x - node.x,
        offsetY: y - node.y
      };

      // Move to front
      const index = this.nodes.indexOf(node);
      this.nodes.splice(index, 1);
      this.nodes.push(node);
    } else {
      this.selectedNode = null;
    }
  },

  onMouseMove: function(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.dragging) {
      this.dragging.node.x = x - this.dragging.offsetX;
      this.dragging.node.y = y - this.dragging.offsetY;

      // Update audio engine node position
      if (AudioEngine.nodes[this.dragging.node.id]) {
        AudioEngine.nodes[this.dragging.node.id].x = this.dragging.node.x;
        AudioEngine.nodes[this.dragging.node.id].y = this.dragging.node.y;
      }
    }

    if (this.connecting) {
      this.connecting.x = x;
      this.connecting.y = y;
    }
  },

  onMouseUp: function(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.connecting) {
      // Check if dropped on an input port
      const port = this.getPortAt(x, y);
      if (port && port.type === 'input' && port.node.id !== this.connecting.fromNode) {
        this.connectNodes(
          this.connecting.fromNode,
          this.connecting.fromPort,
          port.node.id,
          port.port
        );
      }
      this.connecting = null;
    }

    this.dragging = null;
  },

  onDoubleClick: function(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = this.getNodeAt(x, y);
    if (node) {
      this.showParamsDialog(node);
    }
  },

  // Show context menu for adding nodes
  showContextMenu: function(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if clicking on a node
    const node = this.getNodeAt(x, y);

    // Remove existing menu
    const existing = document.querySelector('.patcher-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'patcher-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${e.clientX}px;
      top: ${e.clientY}px;
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 4px;
      padding: 4px 0;
      z-index: 1000;
      min-width: 150px;
    `;

    if (node) {
      // Node context menu
      menu.innerHTML = `
        <div class="patcher-menu-item" data-action="delete">Delete Node</div>
        <div class="patcher-menu-item" data-action="params">Edit Parameters</div>
      `;
    } else {
      // Add node menu
      const categories = {
        'source': ['oscillator', 'noise'],
        'processor': ['filter', 'gain', 'delay'],
        'modulator': ['lfo', 'eegBand', 'cvFeature'],
        'output': ['output']
      };

      let html = '';
      for (const [cat, types] of Object.entries(categories)) {
        html += `<div class="patcher-menu-header">${cat.toUpperCase()}</div>`;
        for (const type of types) {
          const name = AudioEngine.nodeTypes[type]?.name || type;
          html += `<div class="patcher-menu-item" data-action="add" data-type="${type}">${name}</div>`;
        }
      }
      menu.innerHTML = html;
    }

    document.body.appendChild(menu);

    // Handle clicks
    menu.addEventListener('click', (evt) => {
      const item = evt.target.closest('.patcher-menu-item');
      if (!item) return;

      const action = item.dataset.action;
      if (action === 'add') {
        this.addNode(item.dataset.type, x, y);
      } else if (action === 'delete' && node) {
        this.removeNode(node.id);
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

  // Show parameters dialog
  showParamsDialog: function(node) {
    const nodeType = AudioEngine.nodeTypes[node.type];
    if (!nodeType || !nodeType.params) return;

    // Remove existing dialog
    const existing = document.querySelector('.patcher-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.className = 'patcher-dialog';
    dialog.style.cssText = `
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 8px;
      padding: 16px;
      z-index: 1001;
      min-width: 250px;
    `;

    let html = `<h3 style="margin: 0 0 12px 0; color: #fff;">${node.name}</h3>`;

    for (const [param, config] of Object.entries(nodeType.params)) {
      const value = node.params[param];

      if (config.options) {
        // Select dropdown
        html += `<div style="margin-bottom: 8px;">
          <label style="color: #888; font-size: 12px;">${param}</label>
          <select data-param="${param}" style="width: 100%; padding: 4px; background: #0f3460; color: #fff; border: 1px solid #333;">
            ${config.options.map(opt => `<option value="${opt}" ${opt === value ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>
        </div>`;
      } else {
        // Slider
        html += `<div style="margin-bottom: 8px;">
          <label style="color: #888; font-size: 12px;">${param}: <span id="val-${param}">${value}</span></label>
          <input type="range" data-param="${param}" min="${config.min}" max="${config.max}" step="${(config.max - config.min) / 100}" value="${value}"
            style="width: 100%;">
        </div>`;
      }
    }

    html += `<button class="patcher-dialog-close" style="margin-top: 8px; padding: 6px 12px; background: #e94560; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Close</button>`;

    dialog.innerHTML = html;
    document.body.appendChild(dialog);

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

    // Close button
    dialog.querySelector('.patcher-dialog-close').addEventListener('click', () => {
      dialog.remove();
    });
  },

  // Render loop
  render: function() {
    if (!this.ctx || !this.canvas) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear with gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#0a0a14');
    bgGrad.addColorStop(1, '#12121f');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Draw subtle dot grid
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    const gridSize = 25;
    for (let x = gridSize; x < w; x += gridSize) {
      for (let y = gridSize; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw larger grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 100) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw cables
    for (const cable of this.cables) {
      this.drawCable(cable);
    }

    // Draw connecting cable
    if (this.connecting) {
      const fromNode = this.nodes.find(n => n.id === this.connecting.fromNode);
      if (fromNode) {
        const outputs = this.getOutputPorts(fromNode);
        const port = outputs.find(p => p.name === this.connecting.fromPort);
        if (port) {
          ctx.beginPath();
          ctx.strokeStyle = this.colors.cableConnecting;
          ctx.lineWidth = 2;
          ctx.moveTo(port.x, port.y);
          ctx.bezierCurveTo(
            port.x, port.y + 50,
            this.connecting.x, this.connecting.y - 50,
            this.connecting.x, this.connecting.y
          );
          ctx.stroke();
        }
      }
    }

    // Draw nodes
    for (const node of this.nodes) {
      this.drawNode(node);
    }

    requestAnimationFrame(() => this.render());
  },

  // Draw a node
  drawNode: function(node) {
    const ctx = this.ctx;
    const x = node.x;
    const y = node.y;
    const w = this.nodeWidth;
    const h = this.nodeHeight;
    const r = this.cornerRadius;
    const hh = this.headerHeight;
    const isSelected = node.id === this.selectedNode;

    // Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = isSelected ? 20 : 10;
    ctx.shadowOffsetY = 4;

    // Background with border
    ctx.fillStyle = isSelected ? this.colors.nodeSelected : this.colors.node;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Border
    ctx.strokeStyle = isSelected ? this.colors.nodeHeader[node.category] : this.colors.nodeBorder;
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();

    // Header with gradient
    const headerColor = this.colors.nodeHeader[node.category] || '#4ecdc4';
    const grad = ctx.createLinearGradient(x, y, x, y + hh);
    grad.addColorStop(0, headerColor);
    grad.addColorStop(1, this.adjustColor(headerColor, -20));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, w, hh, [r, r, 0, 0]);
    ctx.fill();

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.name, x + w / 2, y + hh / 2);

    // Draw input ports (top)
    const inputs = this.getInputPorts(node);
    for (const port of inputs) {
      // Port glow
      ctx.beginPath();
      ctx.arc(port.x, port.y, this.portRadius + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(110, 231, 183, 0.2)';
      ctx.fill();

      // Port circle
      ctx.beginPath();
      ctx.arc(port.x, port.y, this.portRadius, 0, Math.PI * 2);
      ctx.fillStyle = this.colors.portInput;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Port label
      ctx.fillStyle = this.colors.textMuted;
      ctx.font = '9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(port.name, port.x, port.y + 10);
    }

    // Draw output ports (bottom)
    const outputs = this.getOutputPorts(node);
    for (const port of outputs) {
      // Port glow
      ctx.beginPath();
      ctx.arc(port.x, port.y, this.portRadius + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 107, 157, 0.2)';
      ctx.fill();

      // Port circle
      ctx.beginPath();
      ctx.arc(port.x, port.y, this.portRadius, 0, Math.PI * 2);
      ctx.fillStyle = this.colors.portOutput;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Port label
      ctx.fillStyle = this.colors.textMuted;
      ctx.font = '9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(port.name, port.x, port.y - 10);
    }

    // Show param preview
    const paramKeys = Object.keys(node.params).slice(0, 2);
    ctx.fillStyle = this.colors.textParam;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let py = y + hh + 8;
    for (const key of paramKeys) {
      let val = node.params[key];
      if (typeof val === 'number') val = val.toFixed(1);
      ctx.fillText(`${key}: ${val}`, x + 10, py);
      py += 14;
    }
  },

  // Helper to darken/lighten colors
  adjustColor: function(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
    const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
    return `rgb(${r},${g},${b})`;
  },

  // Draw a cable
  drawCable: function(cable) {
    const ctx = this.ctx;

    const fromNode = this.nodes.find(n => n.id === cable.fromNode);
    const toNode = this.nodes.find(n => n.id === cable.toNode);

    if (!fromNode || !toNode) return;

    const fromPorts = this.getOutputPorts(fromNode);
    const toPorts = this.getInputPorts(toNode);

    const fromPort = fromPorts.find(p => p.name === cable.fromPort);
    const toPort = toPorts.find(p => p.name === cable.toPort);

    if (!fromPort || !toPort) return;

    // Bezier curve control points
    const dy = toPort.y - fromPort.y;
    const controlY = Math.max(60, Math.abs(dy) * 0.6);

    // Glow effect
    ctx.beginPath();
    ctx.strokeStyle = this.colors.cableGlow;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.moveTo(fromPort.x, fromPort.y);
    ctx.bezierCurveTo(
      fromPort.x, fromPort.y + controlY,
      toPort.x, toPort.y - controlY,
      toPort.x, toPort.y
    );
    ctx.stroke();

    // Main cable
    ctx.beginPath();
    ctx.strokeStyle = this.colors.cable;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.moveTo(fromPort.x, fromPort.y);
    ctx.bezierCurveTo(
      fromPort.x, fromPort.y + controlY,
      toPort.x, toPort.y - controlY,
      toPort.x, toPort.y
    );
    ctx.stroke();
  },

  // Clear all
  clear: function() {
    for (const node of [...this.nodes]) {
      this.removeNode(node.id);
    }
  },

  // Save patch
  save: function() {
    const patch = AudioEngine.savePatch('patch');
    patch.patcherNodes = this.nodes.map(n => ({
      id: n.id,
      type: n.type,
      x: n.x,
      y: n.y
    }));
    patch.patcherCables = [...this.cables];
    return patch;
  },

  // Load patch
  load: function(patch) {
    this.clear();

    for (const nodeData of patch.patcherNodes || []) {
      this.addNode(nodeData.type, nodeData.x, nodeData.y);
    }

    for (const cable of patch.patcherCables || []) {
      this.connectNodes(cable.fromNode, cable.fromPort, cable.toNode, cable.toPort);
    }
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Patcher;
}
