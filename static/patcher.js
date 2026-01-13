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
  selectedNodes: new Set(), // For multi-select
  hoveredPort: null,
  hoveredCable: null,
  mousePos: { x: 0, y: 0 },
  isFullscreen: false,
  originalStyles: null,

  // Zoom & Pan
  zoom: 1.0,
  minZoom: 0.25,
  maxZoom: 2.0,
  panOffset: { x: 0, y: 0 },

  // Multi-select
  isMultiSelecting: false,
  selectionBox: null,

  // Layout
  nodeWidth: 180,
  nodeHeight: 100,
  canvasNodeWidth: 280,
  canvasNodeHeight: 220,
  portRadius: 8,
  headerHeight: 32,
  cornerRadius: 12,

  // Embedded canvas for visual output
  embeddedCanvas: null,
  embeddedP5: null,

  // Theme (Light)
  theme: {
    bg: {
      primary: '#fafafa',
      secondary: '#f0f0f0',
      tertiary: '#e5e5e5'
    },
    accent: {
      source: '#f97316',      // Orange
      processor: '#0891b2',   // Cyan (darker for light bg)
      modulator: '#9333ea',   // Purple (darker)
      output: '#16a34a',      // Green (darker)
      data: '#2563eb',        // Blue (darker)
      visual: '#db2777',      // Pink (darker)
      visual_output: '#e11d48', // Rose (darker)
      sender: '#dc2626',      // Red (darker)
      visualization: '#0d9488' // Teal (darker)
    },
    text: {
      primary: '#1a1a1a',
      secondary: '#666666',
      muted: '#999999'
    },
    port: {
      input: '#2563eb',
      output: '#f97316',
      hover: '#000000'
    },
    cable: {
      default: '#2563eb',
      active: '#9333ea',
      glow: 'rgba(37, 99, 235, 0.2)'
    },
    node: {
      bg: '#ffffff',
      bgSelected: '#f3f4f6',
      border: '#e5e5e5',
      borderSelected: '#2563eb'
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

    // Fullscreen button removed for cleaner UI
    // this.createFullscreenButton();

    // Event listeners
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // ESC to exit fullscreen
      if (e.key === 'Escape' && this.isFullscreen) {
        this.toggleFullscreen();
        return;
      }

      // Only handle shortcuts if patcher canvas is focused
      const focused = document.activeElement;
      if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT')) {
        return;
      }

      // Cmd/Ctrl + A: Select all nodes
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        this.selectAllNodes();
        return;
      }

      // Delete or Backspace: Delete selected nodes
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedNodes.size > 0) {
        e.preventDefault();
        this.deleteSelectedNodes();
        return;
      }

      // Cmd/Ctrl + Plus: Zoom in
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.zoomIn();
        // Dispatch custom event for UI update
        window.dispatchEvent(new CustomEvent('patcher-zoom-change', { detail: { zoom: this.zoom } }));
        return;
      }

      // Cmd/Ctrl + Minus: Zoom out
      if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        this.zoomOut();
        window.dispatchEvent(new CustomEvent('patcher-zoom-change', { detail: { zoom: this.zoom } }));
        return;
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

    const visualBtn = document.createElement('button');
    visualBtn.className = 'patcher-visual-btn';
    visualBtn.innerHTML = '▣';
    visualBtn.title = 'Open Visual Preview';
    visualBtn.style.cssText = `
      position: absolute; top: 10px; right: 50px; z-index: 100;
      width: 32px; height: 32px; border-radius: 6px;
      background: ${this.theme.bg.tertiary}; border: 1px solid ${this.theme.node.border};
      color: ${this.theme.accent.visual}; font-size: 16px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.15s ease;
    `;
    visualBtn.addEventListener('mouseenter', () => {
      visualBtn.style.background = this.theme.accent.visual + '20';
      visualBtn.style.borderColor = this.theme.accent.visual;
    });
    visualBtn.addEventListener('mouseleave', () => {
      visualBtn.style.background = this.theme.bg.tertiary;
      visualBtn.style.borderColor = this.theme.node.border;
    });
    visualBtn.addEventListener('click', () => {
      if (typeof VisualRenderer !== 'undefined') {
        VisualRenderer.toggleFullscreen();
      }
    });
    this.container.appendChild(visualBtn);
    this.visualBtn = visualBtn;
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

  // Get mouse position adjusted for HiDPI and zoom/pan
  getMousePos: function(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Adjust for zoom and pan
    return {
      x: (x - this.panOffset.x) / this.zoom,
      y: (y - this.panOffset.y) / this.zoom
    };
  },

  // Get raw mouse position (not adjusted for zoom/pan)
  getRawMousePos: function(e) {
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

  // Get node dimensions based on type
  getNodeDimensions: function(node) {
    // AI Canvas - width based on number of inputs
    if (node.type === 'aiCanvas') {
      const numInputs = (node.inputs || []).length;
      // Each input needs ~110px for label, minimum 200px
      const width = Math.max(200, numInputs * 110);
      return { width: width, height: 140 };
    } else if (node.type === 'output') {
      return { width: 280, height: 200 };
    } else if (node.type === 'eegViz' || node.type === 'cvViz') {
      return { width: 200, height: 160 };
    } else if (node.type === 'canvas') {
      return { width: this.canvasNodeWidth, height: this.canvasNodeHeight };
    }
    // For nodes with many outputs (like Face, Hands), expand width
    const numOutputs = (node.outputs || []).length;
    if (numOutputs > 4) {
      return { width: Math.max(this.nodeWidth, numOutputs * 50), height: this.nodeHeight };
    }
    // Legacy node types (for backward compatibility)
    const isEEGVizNode = node.type === 'fftViz' || node.type === 'timeSeriesViz' || node.type === 'bandsViz';
    const isCVVizNode = node.type === 'faceViz' || node.type === 'handsViz';
    const isGazeVizNode = node.type === 'gazeViz';
    if (isEEGVizNode) {
      return { width: 200, height: 160 };
    } else if (isCVVizNode) {
      return { width: 180, height: 140 };
    } else if (isGazeVizNode) {
      return { width: 140, height: 140 };
    }
    return { width: this.nodeWidth, height: this.nodeHeight };
  },

  // Get node at position
  getNodeAt: function(x, y) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      const dim = this.getNodeDimensions(node);
      if (x >= node.x && x <= node.x + dim.width &&
          y >= node.y && y <= node.y + dim.height) {
        return node;
      }
    }
    return null;
  },

  // Get port positions
  getInputPorts: function(node) {
    const ports = [];
    const inputs = node.inputs || [];
    const dim = this.getNodeDimensions(node);
    const spacing = dim.width / (inputs.length + 1);
    for (let i = 0; i < inputs.length; i++) {
      ports.push({ name: inputs[i], x: node.x + spacing * (i + 1), y: node.y });
    }
    return ports;
  },

  getOutputPorts: function(node) {
    const ports = [];
    const outputs = node.outputs || [];
    const dim = this.getNodeDimensions(node);
    const spacing = dim.width / (outputs.length + 1);
    for (let i = 0; i < outputs.length; i++) {
      ports.push({ name: outputs[i], x: node.x + spacing * (i + 1), y: node.y + dim.height });
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

    // Reset the target parameter to default in patcher's node copy too
    const toNode = this.nodes.find(n => n.id === cable.toNode);
    if (toNode) {
      const nodeType = AudioEngine.nodeTypes[toNode.type];
      if (nodeType?.params?.[cable.toPort]) {
        toNode.params[cable.toPort] = nodeType.params[cable.toPort].default;
      }
    }

    AudioEngine.disconnect(cable.fromNode, cable.toNode, cable.toPort);
    this.cables.splice(index, 1);
  },

  // Mouse handlers
  onMouseDown: function(e) {
    const pos = this.getMousePos(e);
    const shiftKey = e.shiftKey;

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
      if (shiftKey) {
        // Shift+click: toggle multi-selection
        this.toggleNodeSelection(node.id);
        // Also set as primary selected for compatibility
        this.selectedNode = node.id;
      } else {
        // Regular click: if node is not in multi-selection, clear selection
        if (!this.selectedNodes.has(node.id)) {
          this.clearSelection();
        }
        this.selectedNode = node.id;
        this.selectedNodes.add(node.id);
      }

      // Calculate offsets for all selected nodes (for multi-drag)
      this.dragging = {
        node,
        offsetX: pos.x - node.x,
        offsetY: pos.y - node.y,
        nodeOffsets: new Map()
      };

      // Store offsets for all selected nodes
      for (const nodeId of this.selectedNodes) {
        const n = this.nodes.find(nd => nd.id === nodeId);
        if (n) {
          this.dragging.nodeOffsets.set(nodeId, {
            offsetX: pos.x - n.x,
            offsetY: pos.y - n.y
          });
        }
      }

      // Bring to front
      const idx = this.nodes.indexOf(node);
      this.nodes.splice(idx, 1);
      this.nodes.push(node);
      this.canvas.style.cursor = 'grabbing';
    } else {
      // Click on empty space
      if (shiftKey) {
        // Shift+click on empty: start selection box
        this.isMultiSelecting = true;
        this.selectionBox = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
      } else {
        // Regular click on empty: clear selection
        this.clearSelection();
      }
    }
  },

  onMouseMove: function(e) {
    const pos = this.getMousePos(e);
    this.mousePos = pos;

    if (this.isMultiSelecting && this.selectionBox) {
      // Update selection box
      this.selectionBox.endX = pos.x;
      this.selectionBox.endY = pos.y;
    } else if (this.dragging) {
      // Move all selected nodes together
      if (this.selectedNodes.size > 1 && this.dragging.nodeOffsets) {
        for (const nodeId of this.selectedNodes) {
          const n = this.nodes.find(nd => nd.id === nodeId);
          const offsets = this.dragging.nodeOffsets.get(nodeId);
          if (n && offsets) {
            n.x = pos.x - offsets.offsetX;
            n.y = pos.y - offsets.offsetY;
            if (AudioEngine.nodes[nodeId]) {
              AudioEngine.nodes[nodeId].x = n.x;
              AudioEngine.nodes[nodeId].y = n.y;
            }
          }
        }
      } else {
        // Single node drag
        this.dragging.node.x = pos.x - this.dragging.offsetX;
        this.dragging.node.y = pos.y - this.dragging.offsetY;
        if (AudioEngine.nodes[this.dragging.node.id]) {
          AudioEngine.nodes[this.dragging.node.id].x = this.dragging.node.x;
          AudioEngine.nodes[this.dragging.node.id].y = this.dragging.node.y;
        }
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

    if (this.isMultiSelecting && this.selectionBox) {
      // Complete selection box - select all nodes within it
      const box = this.normalizeBox(this.selectionBox);

      for (const node of this.nodes) {
        const dim = this.getNodeDimensions(node);
        if (this.boxIntersects(box, node.x, node.y, dim.width, dim.height)) {
          this.selectedNodes.add(node.id);
        }
      }

      // Clear selection box state
      this.isMultiSelecting = false;
      this.selectionBox = null;
    } else if (this.connecting) {
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
      // For canvas and output nodes, double-click opens fullscreen visual
      if (node.type === 'canvas' || node.type === 'output') {
        if (typeof VisualRenderer !== 'undefined') {
          VisualRenderer.enterFullscreen();
        }
      } else {
        this.showParamsDialog(node);
      }
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
        'Audio': {
          icon: '♪', color: this.theme.accent.source,
          items: [
            { type: 'toneGenerator', icon: '〜', desc: 'Oscillator + Noise' },
            { type: 'sampler', icon: '▶', desc: 'Sample player' },
            { type: 'filter', icon: '◇', desc: 'LPF/HPF/BPF' },
            { type: 'effects', icon: '◌', desc: 'Delay/Reverb/Chorus' }
          ]
        },
        'Modulators': {
          icon: '◉', color: this.theme.accent.modulator,
          items: [
            { type: 'face', icon: '◎', desc: 'Face tracking CV' },
            { type: 'hands', icon: '✋', desc: 'Hand tracking CV' },
            { type: 'eeg', icon: '◉', desc: 'EEG (bands/time/fft)' },
            { type: 'eyes', icon: '⊙', desc: 'Gaze tracking' },
            { type: 'lfo', icon: '∿', desc: 'Low freq oscillator' },
            { type: 'scale', icon: '↔', desc: 'Map range' }
          ]
        },
        'Visuals': {
          icon: '●', color: this.theme.accent.visual,
          items: [
            { type: 'aiCanvas', icon: '✨', desc: 'AI-generated visual' },
            { type: 'ellipse', icon: '●', desc: 'Ellipse' },
            { type: 'rect', icon: '■', desc: 'Rectangle' }
          ]
        },
        'Senders': {
          icon: '↗', color: this.theme.accent.sender,
          items: [
            { type: 'midi', icon: '♪', desc: 'MIDI CC/Note' },
            { type: 'osc', icon: '○', desc: 'OSC sender' }
          ]
        },
        'Visualizers': {
          icon: '◐', color: this.theme.accent.visualization,
          items: [
            { type: 'eegViz', icon: '▥', desc: 'EEG visualizer' },
            { type: 'cvViz', icon: '◎', desc: 'Camera + CV overlay' }
          ]
        },
        'Output': {
          icon: '◈', color: this.theme.accent.output,
          items: [
            { type: 'output', icon: '◈', desc: 'Audio + Visual output' }
          ]
        }
      };

      const catItemStyle = `
        padding: 10px 16px; cursor: pointer; font-size: 14px; color: ${this.theme.text.primary};
        display: flex; align-items: center; gap: 10px; transition: background 0.1s;
      `;

      let html = '';
      for (const [catName, catData] of Object.entries(categories)) {
        html += `
          <div style="${catItemStyle}" class="menu-category" data-category="${catName}">
            <span style="color: ${catData.color}; font-size: 16px;">${catData.icon}</span>
            <span style="flex: 1;">${catName}</span>
            <span style="color: ${this.theme.text.muted};">›</span>
          </div>
        `;
      }
      menu.innerHTML = html;
      menu._categories = categories;
      menu._pos = pos;
    }

    document.body.appendChild(menu);

    const self = this;

    // Style hover for menu items
    menu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('mouseenter', () => item.style.background = this.theme.bg.tertiary);
      item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    });

    // Style hover for categories
    menu.querySelectorAll('.menu-category').forEach(cat => {
      cat.addEventListener('mouseenter', () => cat.style.background = this.theme.bg.tertiary);
      cat.addEventListener('mouseleave', () => cat.style.background = 'transparent');
    });

    // Handle clicks
    menu.addEventListener('click', (evt) => {
      const item = evt.target.closest('.menu-item');
      const category = evt.target.closest('.menu-category');

      if (item) {
        const action = item.dataset.action;
        if (action === 'add') {
          this.addNode(item.dataset.type, menu._pos.x, menu._pos.y);
        } else if (action === 'delete' && node) {
          this.removeNode(node.id);
        } else if (action === 'delete-cable' && menu._cable) {
          this.removeCable(menu._cable);
        } else if (action === 'params' && node) {
          this.showParamsDialog(node);
        }
        document.querySelectorAll('.patcher-menu').forEach(m => m.remove());
      } else if (category && menu._categories) {
        const catName = category.dataset.category;
        const catData = menu._categories[catName];
        if (catData) {
          this.showSubMenu(menu, category, catData, menu._pos);
        }
      }
    });

    // Close on outside click
    setTimeout(() => {
      const close = (evt) => {
        if (!evt.target.closest('.patcher-menu')) {
          document.querySelectorAll('.patcher-menu').forEach(m => m.remove());
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  },

  showSubMenu: function(parentMenu, categoryEl, catData, pos) {
    document.querySelectorAll('.patcher-submenu').forEach(m => m.remove());

    const rect = categoryEl.getBoundingClientRect();
    const submenu = document.createElement('div');
    submenu.className = 'patcher-menu patcher-submenu';
    submenu.style.cssText = `
      position: fixed; left: ${rect.right + 4}px; top: ${rect.top}px;
      background: ${this.theme.bg.secondary}; border: 1px solid ${this.theme.node.border};
      border-radius: 8px; padding: 6px 0; z-index: 10001; min-width: 180px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4); font-family: -apple-system, system-ui, sans-serif;
    `;

    const menuItemStyle = `
      padding: 8px 14px; cursor: pointer; font-size: 13px; color: ${this.theme.text.primary};
      display: flex; align-items: center; gap: 8px; transition: background 0.1s;
    `;

    let html = '';
    for (const item of catData.items) {
      const name = AudioEngine.nodeTypes[item.type]?.name || item.type;
      html += `
        <div style="${menuItemStyle}" class="menu-item" data-action="add" data-type="${item.type}">
          <span style="width: 18px; text-align: center; color: ${catData.color};">${item.icon}</span>
          <span style="flex: 1;">${name}</span>
          <span style="color: ${this.theme.text.muted}; font-size: 11px;">${item.desc}</span>
        </div>
      `;
    }
    submenu.innerHTML = html;
    submenu._pos = pos;

    document.body.appendChild(submenu);

    submenu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('mouseenter', () => item.style.background = this.theme.bg.tertiary);
      item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    });

    const self = this;
    submenu.addEventListener('click', (evt) => {
      const item = evt.target.closest('.menu-item');
      if (item && item.dataset.action === 'add') {
        self.addNode(item.dataset.type, pos.x, pos.y);
        document.querySelectorAll('.patcher-menu').forEach(m => m.remove());
      }
    });
  },

  // Parameters dialog
  // Define which params are visible based on mode settings
  getVisibleParams: function(nodeType, type, params) {
    const allParams = Object.keys(nodeType.params);

    // ToneGenerator: show different params based on mode
    if (type === 'toneGenerator') {
      if (params.mode === 'oscillator') {
        return allParams.filter(p => !['noiseType'].includes(p));
      } else {
        return allParams.filter(p => !['waveform', 'frequency', 'detune'].includes(p));
      }
    }

    // EEG: show different params based on mode
    if (type === 'eeg') {
      const base = ['mode', 'smoothing'];
      if (params.mode === 'bands') {
        return [...base, 'band'];
      } else if (params.mode === 'timeseries') {
        return [...base, 'channel', 'metric'];
      } else if (params.mode === 'fft') {
        return [...base, 'channel', 'fftBin'];
      }
      return base;
    }

    // Effects: show different params based on type
    if (type === 'effects') {
      const base = ['type', 'mix'];
      if (params.type === 'delay') {
        return [...base, 'delayTime', 'feedback'];
      } else if (params.type === 'reverb') {
        return [...base, 'decay'];
      } else if (params.type === 'chorus') {
        return [...base, 'rate', 'depth'];
      }
      return base;
    }

    // MIDI: show different params based on mode
    if (type === 'midi') {
      const base = ['mode', 'channel'];
      if (params.mode === 'cc') {
        return [...base, 'cc', 'scale'];
      } else {
        return [...base, 'note', 'velocity', 'duration'];
      }
    }

    // EEGViz: show params based on mode
    if (type === 'eegViz') {
      const base = ['mode', 'recording'];
      if (params.mode === 'timeseries') {
        return [...base, 'channel', 'windowSec', 'scale'];
      } else if (params.mode === 'fft') {
        return [...base, 'channel', 'colorScheme'];
      } else if (params.mode === 'bands') {
        return [...base, 'displayMode'];
      }
      return base;
    }

    return allParams;
  },

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

    const buildParamsHTML = () => {
      const visibleParams = this.getVisibleParams(nodeType, node.type, node.params);
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
        if (!visibleParams.includes(param)) continue;

        const value = node.params[param];
        const displayName = param.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

        // Dropdown for options
        if (config.options) {
          html += `
            <div style="margin-bottom: 14px;" data-param-container="${param}">
              <label style="display: block; color: ${this.theme.text.secondary}; font-size: 12px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${displayName}</label>
              <select data-param="${param}" style="width: 100%; padding: 10px 12px; background: ${this.theme.bg.primary}; color: ${this.theme.text.primary}; border: 1px solid ${this.theme.node.border}; border-radius: 6px; font-size: 14px; cursor: pointer;">
                ${config.options.map(opt => `<option value="${opt}" ${opt === value ? 'selected' : ''}>${opt}</option>`).join('')}
              </select>
            </div>
          `;
        }
        // Text input
        else if (config.type === 'text') {
          html += `
            <div style="margin-bottom: 14px;" data-param-container="${param}">
              <label style="display: block; color: ${this.theme.text.secondary}; font-size: 12px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${displayName}</label>
              <input type="text" data-param="${param}" value="${value || ''}" placeholder="${config.placeholder || ''}"
                style="width: 100%; padding: 10px 12px; background: ${this.theme.bg.primary}; color: ${this.theme.text.primary}; border: 1px solid ${this.theme.node.border}; border-radius: 6px; font-size: 14px; box-sizing: border-box;">
            </div>
          `;
        }
        // Color picker
        else if (config.type === 'color') {
          html += `
            <div style="margin-bottom: 14px;" data-param-container="${param}">
              <label style="display: block; color: ${this.theme.text.secondary}; font-size: 12px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${displayName}</label>
              <div style="display: flex; gap: 8px; align-items: center;">
                <input type="color" data-param="${param}" value="${value && value !== 'none' ? value : '#ffffff'}"
                  style="width: 50px; height: 36px; padding: 0; border: 1px solid ${this.theme.node.border}; border-radius: 6px; cursor: pointer; background: transparent;">
                <input type="text" data-param="${param}-text" value="${value || ''}" placeholder="#ffffff or none"
                  style="flex: 1; padding: 10px 12px; background: ${this.theme.bg.primary}; color: ${this.theme.text.primary}; border: 1px solid ${this.theme.node.border}; border-radius: 6px; font-size: 14px; box-sizing: border-box;">
              </div>
            </div>
          `;
        }
        // Numeric slider (default)
        else if (config.min !== undefined && config.max !== undefined) {
          html += `
            <div style="margin-bottom: 14px;" data-param-container="${param}">
              <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <label style="color: ${this.theme.text.secondary}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">${displayName}</label>
                <span id="val-${param}" style="color: ${accentColor}; font-size: 12px; font-weight: 600;">${typeof value === 'number' ? value.toFixed(2) : value}</span>
              </div>
              <input type="range" data-param="${param}" min="${config.min}" max="${config.max}" step="${(config.max - config.min) / 100}" value="${value}"
                style="width: 100%; height: 6px; border-radius: 3px; appearance: none; background: ${this.theme.bg.primary}; cursor: pointer;">
            </div>
          `;
        }
      }

      // Add Generate button for AI Canvas
      if (node.type === 'aiCanvas') {
        html += `
          <div style="margin-bottom: 14px;">
            <button id="generate-ai-btn" style="width: 100%; padding: 12px; background: ${accentColor}; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;">
              Generate Visual
            </button>
            <div id="generate-status" style="margin-top: 8px; font-size: 12px; color: ${this.theme.text.muted}; text-align: center;"></div>
          </div>
        `;

        // Add history navigation controls
        const historyInfo = AudioEngine.getAICanvasHistoryInfo(node.id);
        html += `
          <div id="ai-history-controls" style="display: ${historyInfo.hasHistory ? 'flex' : 'none'};
               align-items: center; justify-content: center; gap: 12px; margin-bottom: 14px;
               padding: 10px; background: ${this.theme.bg.tertiary}; border-radius: 6px;">
            <button id="ai-history-prev" ${!historyInfo.canPrev ? 'disabled' : ''}
              style="padding: 6px 12px; background: ${this.theme.bg.primary}; color: ${this.theme.text.primary};
                     border: 1px solid ${this.theme.node.border}; border-radius: 4px; cursor: pointer;
                     opacity: ${historyInfo.canPrev ? '1' : '0.4'};">
              ◀ Prev
            </button>
            <span id="ai-history-info" style="color: ${this.theme.text.secondary}; font-size: 12px;">
              Version ${historyInfo.current} of ${historyInfo.total}
            </span>
            <button id="ai-history-next" ${!historyInfo.canNext ? 'disabled' : ''}
              style="padding: 6px 12px; background: ${this.theme.bg.primary}; color: ${this.theme.text.primary};
                     border: 1px solid ${this.theme.node.border}; border-radius: 4px; cursor: pointer;
                     opacity: ${historyInfo.canNext ? '1' : '0.4'};">
              Next ▶
            </button>
          </div>
        `;

        // Add View/Edit Code section
        const hasCode = AudioEngine.nodes[node.id]?.aiCode;
        html += `
          <div style="margin-bottom: 14px;">
            <button id="toggle-code-editor" style="width: 100%; padding: 8px; background: ${this.theme.bg.tertiary}; color: ${this.theme.text.secondary}; border: 1px solid ${this.theme.node.border}; border-radius: 6px; cursor: pointer; font-size: 12px;">
              ${hasCode ? '{ } View / Edit Code' : '{ } Code Editor (generate first)'}
            </button>
            <div id="code-editor-container" style="display: none; margin-top: 10px;">
              <textarea id="ai-code-editor" style="width: 100%; height: 300px; padding: 12px; background: #1e1e1e; color: #d4d4d4; border: 1px solid ${this.theme.node.border}; border-radius: 6px; font-family: 'Monaco', 'Menlo', monospace; font-size: 12px; line-height: 1.4; resize: vertical; box-sizing: border-box;">${hasCode ? AudioEngine.nodes[node.id].aiCode : '// Generate a visual first'}</textarea>
              <div style="display: flex; gap: 8px; margin-top: 8px;">
                <button id="save-code-btn" style="flex: 1; padding: 8px; background: ${accentColor}; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;" ${!hasCode ? 'disabled' : ''}>
                  Save Changes
                </button>
                <button id="reset-code-btn" style="padding: 8px 12px; background: ${this.theme.bg.tertiary}; color: ${this.theme.text.primary}; border: 1px solid ${this.theme.node.border}; border-radius: 6px; cursor: pointer; font-size: 12px;" ${!hasCode ? 'disabled' : ''}>
                  Reset
                </button>
              </div>
              <div id="code-save-status" style="margin-top: 6px; font-size: 11px; color: ${this.theme.text.muted}; text-align: center;"></div>
            </div>
          </div>
        `;
      }

      html += `
        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button class="dialog-close" style="flex: 1; padding: 10px; background: ${this.theme.bg.tertiary}; color: ${this.theme.text.primary}; border: 1px solid ${this.theme.node.border}; border-radius: 6px; cursor: pointer; font-size: 14px;">Close</button>
        </div>
      `;

      return html;
    };

    const self = this;

    const rebuildDialog = () => {
      dialog.innerHTML = buildParamsHTML();

      // Style range inputs
      dialog.querySelectorAll('input[type="range"]').forEach(range => {
        range.style.cssText += `
          --webkit-slider-thumb { appearance: none; width: 16px; height: 16px; border-radius: 50%; background: ${accentColor}; cursor: pointer; }
        `;
      });

      // Handle changes for standard inputs
      dialog.querySelectorAll('input[data-param], select[data-param]').forEach(el => {
        const param = el.dataset.param;

        // Skip color text inputs (handled separately)
        if (param.endsWith('-text')) return;

        el.addEventListener('input', (e) => {
          let value = e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value;
          // Handle boolean options
          if (value === 'true') value = true;
          if (value === 'false') value = false;

          node.params[param] = value;
          AudioEngine.setParam(node.id, param, value);

          const valEl = document.getElementById(`val-${param}`);
          if (valEl) valEl.textContent = typeof value === 'number' ? value.toFixed(2) : value;

          // Sync color picker with text input
          if (e.target.type === 'color') {
            const textInput = dialog.querySelector(`[data-param="${param}-text"]`);
            if (textInput) textInput.value = value;
          }

          // If this is a mode/type change, rebuild the dialog to show relevant params
          if (['mode', 'type'].includes(param)) {
            rebuildDialog();
          }
        });
      });

      // Handle color text inputs separately
      dialog.querySelectorAll('input[data-param$="-text"]').forEach(el => {
        el.addEventListener('input', (e) => {
          const param = e.target.dataset.param.replace('-text', '');
          const value = e.target.value;
          node.params[param] = value;
          AudioEngine.setParam(node.id, param, value);

          // Sync with color picker if valid hex
          const colorInput = dialog.querySelector(`input[type="color"][data-param="${param}"]`);
          if (colorInput && /^#[0-9A-Fa-f]{6}$/.test(value)) {
            colorInput.value = value;
          }
        });
      });

      dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.remove());

      // Handle AI Canvas generate button
      if (node.type === 'aiCanvas') {
        const generateBtn = dialog.querySelector('#generate-ai-btn');
        const statusDiv = dialog.querySelector('#generate-status');

        if (generateBtn) {
          generateBtn.addEventListener('click', async () => {
            const prompt = node.params.prompt;
            if (!prompt || !prompt.trim()) {
              statusDiv.textContent = 'Please enter a prompt first';
              statusDiv.style.color = '#f85149';
              return;
            }

            generateBtn.disabled = true;
            generateBtn.textContent = 'Generating...';
            statusDiv.textContent = 'Creating your visual with AI...';
            statusDiv.style.color = self.theme.text.muted;

            try {
              const result = await AudioEngine.generateAICanvas(node.id, prompt);
              if (result.status === 'ok') {
                // Update patcher node's inputs with the extracted parameters
                const paramNames = (result.parameters || []).map(p => p.name);
                node.inputs = paramNames;

                // Also update the node's params with defaults
                for (const param of result.parameters || []) {
                  if (!(param.name in node.params)) {
                    node.params[param.name] = param.default;
                  }
                }

                statusDiv.textContent = `Generated with ${paramNames.length} controllable params!`;
                statusDiv.style.color = '#22c55e';
                generateBtn.textContent = 'Regenerate';

                // Close dialog and redraw to show new inputs
                setTimeout(() => dialog.remove(), 1500);
              } else {
                throw new Error(result.message || 'Generation failed');
              }
            } catch (err) {
              statusDiv.textContent = 'Error: ' + err.message;
              statusDiv.style.color = '#f85149';
              generateBtn.textContent = 'Try Again';
            }

            generateBtn.disabled = false;
          });
        }

        // History navigation handlers
        const prevBtn = dialog.querySelector('#ai-history-prev');
        const nextBtn = dialog.querySelector('#ai-history-next');
        const historyInfoSpan = dialog.querySelector('#ai-history-info');
        const historyControls = dialog.querySelector('#ai-history-controls');

        const updateHistoryUI = () => {
          const info = AudioEngine.getAICanvasHistoryInfo(node.id);
          if (historyControls) {
            historyControls.style.display = info.hasHistory ? 'flex' : 'none';
          }
          if (historyInfoSpan) {
            historyInfoSpan.textContent = `Version ${info.current} of ${info.total}`;
          }
          if (prevBtn) {
            prevBtn.disabled = !info.canPrev;
            prevBtn.style.opacity = info.canPrev ? '1' : '0.4';
          }
          if (nextBtn) {
            nextBtn.disabled = !info.canNext;
            nextBtn.style.opacity = info.canNext ? '1' : '0.4';
          }
        };

        if (prevBtn) {
          prevBtn.addEventListener('click', () => {
            if (AudioEngine.aiCanvasHistoryPrev(node.id)) {
              rebuildDialog(); // Rebuild to show restored parameters
            }
          });
        }

        if (nextBtn) {
          nextBtn.addEventListener('click', () => {
            if (AudioEngine.aiCanvasHistoryNext(node.id)) {
              rebuildDialog(); // Rebuild to show restored parameters
            }
          });
        }

        // Code editor handlers
        const toggleCodeBtn = dialog.querySelector('#toggle-code-editor');
        const codeEditorContainer = dialog.querySelector('#code-editor-container');
        const codeEditor = dialog.querySelector('#ai-code-editor');
        const saveCodeBtn = dialog.querySelector('#save-code-btn');
        const resetCodeBtn = dialog.querySelector('#reset-code-btn');
        const codeSaveStatus = dialog.querySelector('#code-save-status');

        if (toggleCodeBtn && codeEditorContainer) {
          toggleCodeBtn.addEventListener('click', () => {
            const isHidden = codeEditorContainer.style.display === 'none';
            codeEditorContainer.style.display = isHidden ? 'block' : 'none';
            toggleCodeBtn.textContent = isHidden ? '{ } Hide Code Editor' : '{ } View / Edit Code';
          });
        }

        if (saveCodeBtn && codeEditor) {
          saveCodeBtn.addEventListener('click', async () => {
            const newCode = codeEditor.value;
            if (!newCode.trim()) {
              codeSaveStatus.textContent = 'Code cannot be empty';
              codeSaveStatus.style.color = '#f85149';
              return;
            }

            saveCodeBtn.disabled = true;
            saveCodeBtn.textContent = 'Saving...';
            codeSaveStatus.textContent = 'Updating visual...';
            codeSaveStatus.style.color = self.theme.text.muted;

            try {
              const result = await AudioEngine.updateAICanvasCode(node.id, newCode);
              if (result.status === 'ok') {
                // Update node inputs with new parameters
                node.inputs = (result.parameters || []).map(p => p.name);
                codeSaveStatus.textContent = 'Code saved! Visual updated.';
                codeSaveStatus.style.color = '#22c55e';
                // Update history UI
                updateHistoryUI();
              } else {
                throw new Error(result.message || 'Save failed');
              }
            } catch (err) {
              codeSaveStatus.textContent = 'Error: ' + err.message;
              codeSaveStatus.style.color = '#f85149';
            }

            saveCodeBtn.disabled = false;
            saveCodeBtn.textContent = 'Save Changes';
          });
        }

        if (resetCodeBtn && codeEditor) {
          resetCodeBtn.addEventListener('click', () => {
            const currentCode = AudioEngine.nodes[node.id]?.aiCode || '';
            codeEditor.value = currentCode;
            codeSaveStatus.textContent = 'Reset to current version';
            codeSaveStatus.style.color = self.theme.text.muted;
          });
        }
      }

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
    };

    document.body.appendChild(dialog);
    rebuildDialog();
  },

  // Render
  render: function() {
    if (!this.ctx || !this.canvas) return;

    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    // Clear and reset transform
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Background (full canvas, not affected by zoom)
    ctx.fillStyle = this.theme.bg.primary;
    ctx.fillRect(0, 0, w, h);

    // Apply zoom and pan transform
    ctx.save();
    ctx.translate(this.panOffset.x, this.panOffset.y);
    ctx.scale(this.zoom, this.zoom);

    // Grid dots (affected by zoom)
    ctx.fillStyle = this.theme.text.muted + '30';
    const gridSize = 30;
    const startX = -this.panOffset.x / this.zoom;
    const startY = -this.panOffset.y / this.zoom;
    const endX = (w - this.panOffset.x) / this.zoom;
    const endY = (h - this.panOffset.y) / this.zoom;

    for (let x = Math.floor(startX / gridSize) * gridSize; x < endX; x += gridSize) {
      for (let y = Math.floor(startY / gridSize) * gridSize; y < endY; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5 / this.zoom, 0, Math.PI * 2);
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

    // Selection box
    if (this.isMultiSelecting && this.selectionBox) {
      const box = this.normalizeBox(this.selectionBox);
      ctx.strokeStyle = this.theme.port.input;
      ctx.lineWidth = 1 / this.zoom;
      ctx.setLineDash([5 / this.zoom, 5 / this.zoom]);
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = this.theme.port.input + '15';
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.setLineDash([]);
    }

    // Restore transform
    ctx.restore();

    // Instructions overlay (if no nodes) - not affected by zoom
    if (this.nodes.length === 0) {
      ctx.fillStyle = this.theme.text.muted;
      ctx.font = '14px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Right-click to add nodes', w / 2, h / 2 - 20);
      ctx.font = '12px -apple-system, system-ui, sans-serif';
      ctx.fillText('Drag from output ports to connect', w / 2, h / 2 + 10);
    }

    // Zoom indicator in corner (when zoomed)
    if (this.zoom !== 1.0) {
      ctx.fillStyle = this.theme.bg.tertiary;
      ctx.beginPath();
      ctx.roundRect(10, h - 30, 60, 20, 4);
      ctx.fill();
      ctx.fillStyle = this.theme.text.secondary;
      ctx.font = '11px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(this.zoom * 100)}%`, 20, h - 20);
    }

    requestAnimationFrame(() => this.render());
  },

  // Draw node
  drawNode: function(node) {
    const ctx = this.ctx;
    const { x, y } = node;
    // Determine node size based on type
    const isCanvasNode = node.type === 'canvas';
    const isAICanvas = node.type === 'aiCanvas';
    const isUnifiedOutput = node.type === 'output';
    const isVisualizer = node.type === 'eegViz' || node.type === 'cvViz';

    // Get dimensions from getNodeDimensions for consistency
    const dim = this.getNodeDimensions(node);
    let w = dim.width;
    let h = dim.height;

    const r = this.cornerRadius;
    const hh = this.headerHeight;
    const isSelected = node.id === this.selectedNode || this.selectedNodes.has(node.id);
    const isMultiSelected = this.selectedNodes.has(node.id) && this.selectedNodes.size > 1;
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

    // Border - multi-selected nodes get dashed border
    ctx.strokeStyle = isSelected ? this.theme.node.borderSelected : this.theme.node.border;
    ctx.lineWidth = isSelected ? 2 : 1;
    if (isMultiSelected) {
      ctx.setLineDash([4, 4]);
    }
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();
    ctx.setLineDash([]);

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

    // Special rendering for canvas nodes - render visual output
    if (isCanvasNode) {
      const previewX = x + 8;
      const previewY = y + hh + 8;
      const previewW = w - 16;
      const previewH = h - hh - 40;

      // Draw preview background
      ctx.fillStyle = node.params.background || '#0d1117';
      ctx.beginPath();
      ctx.roundRect(previewX, previewY, previewW, previewH, 6);
      ctx.fill();

      // Render visual nodes into this area
      if (typeof VisualRenderer !== 'undefined') {
        VisualRenderer.renderToContext(ctx, previewX, previewY, previewW, previewH);
      }

      // Fullscreen button hint
      ctx.fillStyle = this.theme.text.muted;
      ctx.font = '10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Double-click for fullscreen', x + w/2, y + h - 14);
      ctx.textAlign = 'left';
    }
    // AI Canvas node - special rendering with prompt and preview
    else if (isAICanvas) {
      const previewX = x + 8;
      const previewY = y + hh + 8;
      const previewW = w - 16;
      const previewH = h - hh - 16;

      // Draw preview background
      ctx.fillStyle = node.params.background || '#0d1117';
      ctx.beginPath();
      ctx.roundRect(previewX, previewY, previewW, previewH, 6);
      ctx.fill();

      // Check if AI code is generated
      const audioNode = AudioEngine.nodes[node.id];
      if (audioNode?.aiCode) {
        // Show active indicator
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 12px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✓ Visual Generated', x + w/2, previewY + previewH/2 - 10);

        // Show prompt
        ctx.fillStyle = this.theme.text.muted;
        ctx.font = '10px -apple-system, system-ui, sans-serif';
        const prompt = node.params.prompt || '';
        const truncPrompt = prompt.length > 25 ? prompt.slice(0, 22) + '...' : prompt;
        ctx.fillText(`"${truncPrompt}"`, x + w/2, previewY + previewH/2 + 8);

        // Show param count
        const paramCount = audioNode.aiParameters?.length || 0;
        if (paramCount > 0) {
          ctx.fillText(`${paramCount} params`, x + w/2, previewY + previewH/2 + 24);
        }
      } else {
        // Empty state - show clear instruction
        ctx.fillStyle = accentColor;
        ctx.font = 'bold 12px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Double-click to configure', x + w/2, previewY + previewH/2);
      }
      ctx.textAlign = 'left';
    }
    // Unified Output node - audio + visual + recording
    else if (isUnifiedOutput) {
      const previewX = x + 8;
      const previewY = y + hh + 8;
      const previewW = w - 16;
      const previewH = h - hh - 60;

      // Draw visual preview area
      ctx.fillStyle = '#0d1117';
      ctx.beginPath();
      ctx.roundRect(previewX, previewY, previewW, previewH, 6);
      ctx.fill();

      // Render visual nodes into this area
      if (typeof VisualRenderer !== 'undefined' && node.params.visualEnabled) {
        VisualRenderer.renderToContext(ctx, previewX, previewY, previewW, previewH);
      }

      // Audio meter area
      const meterY = y + h - 48;
      ctx.fillStyle = this.theme.bg.tertiary;
      ctx.beginPath();
      ctx.roundRect(previewX, meterY, previewW - 50, 20, 4);
      ctx.fill();

      // Draw audio level (from analyzer)
      const analyzerData = AudioEngine.getAnalyzerData?.();
      if (analyzerData && analyzerData.length > 0) {
        const avgLevel = Array.from(analyzerData).reduce((a, b) => a + b, 0) / analyzerData.length / 255;
        ctx.fillStyle = avgLevel > 0.8 ? '#ef4444' : '#22c55e';
        ctx.beginPath();
        ctx.roundRect(previewX + 2, meterY + 2, (previewW - 54) * avgLevel, 16, 3);
        ctx.fill();
      }

      // Record button
      const recX = previewX + previewW - 44;
      const isRecording = AudioEngine.recording?.isRecording || false;
      ctx.fillStyle = isRecording ? '#ef4444' : this.theme.bg.tertiary;
      ctx.beginPath();
      ctx.roundRect(recX, meterY, 44, 20, 4);
      ctx.fill();

      ctx.fillStyle = isRecording ? '#fff' : this.theme.text.secondary;
      ctx.font = '10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isRecording ? 'REC' : 'REC', recX + 22, meterY + 14);

      // Fullscreen hint
      ctx.fillStyle = this.theme.text.muted;
      ctx.font = '9px -apple-system, system-ui, sans-serif';
      ctx.fillText('Double-click for fullscreen', x + w/2, y + h - 8);
      ctx.textAlign = 'left';
    }
    // EEG Visualizer - unified bands/timeseries/fft display
    else if (node.type === 'eegViz') {
      const mode = node.params.mode || 'bands';
      const chartX = x + 12;
      const chartY = y + hh + 8;
      const chartW = w - 24;
      const chartH = h - hh - 32;

      // Mode label
      ctx.fillStyle = this.theme.text.muted;
      ctx.font = '9px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(mode.toUpperCase(), chartX, chartY - 2);

      // Chart background
      ctx.fillStyle = this.theme.bg.primary;
      ctx.beginPath();
      ctx.roundRect(chartX, chartY, chartW, chartH, 4);
      ctx.fill();

      if (mode === 'bands') {
        // Draw bands visualization
        const bands = AudioEngine.data?.bands || {};
        const bandNames = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
        const colors = ['#8b5cf6', '#3b82f6', '#22c55e', '#f97316', '#ef4444'];
        const barWidth = (chartW - (bandNames.length - 1) * 4 - 8) / bandNames.length;

        bandNames.forEach((band, i) => {
          const value = (bands[band] || 0) / 100;
          const barH = Math.max(2, value * (chartH - 16));
          const bx = chartX + 4 + i * (barWidth + 4);
          const by = chartY + chartH - 8 - barH;

          ctx.fillStyle = colors[i];
          ctx.beginPath();
          ctx.roundRect(bx, by, barWidth, barH, 2);
          ctx.fill();
        });
      } else if (mode === 'timeseries') {
        // Draw time series
        const channel = (node.params.channel || 1) - 1;
        const buffer = AudioEngine.vizData?.timeSeries?.channels[channel] || [];

        if (buffer.length > 1) {
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 1.5;
          ctx.beginPath();

          for (let i = 0; i < buffer.length; i++) {
            const px = chartX + 4 + (i / (buffer.length - 1)) * (chartW - 8);
            const sample = buffer[i] || 0;
            const normalized = Math.max(-1, Math.min(1, sample / 100));
            const py2 = chartY + chartH / 2 - normalized * (chartH / 2 - 8);
            if (i === 0) ctx.moveTo(px, py2);
            else ctx.lineTo(px, py2);
          }
          ctx.stroke();
        }
      } else if (mode === 'fft') {
        // Draw FFT
        const channel = (node.params.channel || 1) - 1;
        const psd = AudioEngine.vizData?.fft?.psd[channel] || [];
        const colorScheme = node.params.colorScheme || 'cyan';
        const colors = { cyan: '#06b6d4', purple: '#8b5cf6', green: '#22c55e', rainbow: '#f97316' };

        if (psd.length > 1) {
          const numBars = Math.min(24, psd.length);
          const barWidth = (chartW - 8) / numBars;

          ctx.fillStyle = colors[colorScheme] || colors.cyan;
          for (let i = 0; i < numBars; i++) {
            const psdIndex = Math.floor(i * psd.length / numBars);
            const value = psd[psdIndex] || 0;
            const normalized = value > 0 ? Math.min(1, Math.log10(value + 1) / 3) : 0;
            const barH = Math.max(1, normalized * (chartH - 12));
            const bx = chartX + 4 + i * barWidth;
            const by = chartY + chartH - 6 - barH;

            ctx.beginPath();
            ctx.roundRect(bx, by, barWidth - 2, barH, 1);
            ctx.fill();
          }
        }
      }

      // Recording indicator
      if (node.params.recording) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(x + w - 16, y + hh + 16, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // CV Visualizer - camera overlay with values
    else if (node.type === 'cvViz') {
      const chartX = x + 12;
      const chartY = y + hh + 8;
      const chartW = w - 24;
      const chartH = h - hh - 24;

      // Camera placeholder
      ctx.fillStyle = this.theme.bg.primary;
      ctx.beginPath();
      ctx.roundRect(chartX, chartY, chartW, chartH, 4);
      ctx.fill();

      // CV values overlay
      const cv = AudioEngine.data?.cv || {};
      const features = [
        { label: 'Mouth', value: cv.mouth_openness || cv.mouth || 0 },
        { label: 'Smile', value: cv.smile_curvature || cv.smile || 0 },
        { label: 'Brow', value: cv.brow_raise || cv.brow || 0 }
      ];

      const meterH = 10;
      const meterSpacing = (chartH - 20) / features.length;

      ctx.font = '9px -apple-system, system-ui, sans-serif';
      features.forEach((feat, i) => {
        const my = chartY + 8 + i * meterSpacing;

        // Label
        ctx.fillStyle = this.theme.text.secondary;
        ctx.textAlign = 'left';
        ctx.fillText(feat.label, chartX + 4, my + meterH);

        // Meter background
        ctx.fillStyle = this.theme.bg.tertiary;
        ctx.beginPath();
        ctx.roundRect(chartX + 40, my, chartW - 48, meterH, 2);
        ctx.fill();

        // Meter value
        ctx.fillStyle = '#9333ea';
        ctx.beginPath();
        ctx.roundRect(chartX + 40, my, (chartW - 48) * Math.min(1, feat.value), meterH, 2);
        ctx.fill();
      });

      // Show camera hint
      ctx.fillStyle = this.theme.text.muted;
      ctx.font = '9px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Camera feed + CV', x + w/2, y + h - 8);
      ctx.textAlign = 'left';

      // Recording indicator
      if (node.params.recording) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(x + w - 16, y + hh + 16, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Params preview for other nodes
    else {
      ctx.fillStyle = this.theme.text.secondary;
      ctx.font = '11px -apple-system, system-ui, sans-serif';
      let py = y + hh + 14;

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
      } else if (node.type === 'recording') {
        // Special rendering for recording node
        const isRecording = AudioEngine.recording?.isRecording || false;
        const duration = AudioEngine.getRecordingDuration?.() || 0;

        if (isRecording) {
          // Recording indicator - pulsing red dot
          const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
          ctx.fillStyle = `rgba(239, 68, 68, ${0.5 + pulse * 0.5})`;
          ctx.beginPath();
          ctx.arc(x + 20, py + 2, 6, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ef4444';
          ctx.fillText('REC', x + 32, py + 6);

          // Duration display
          py += 20;
          const mins = Math.floor(duration / 60);
          const secs = Math.floor(duration % 60);
          const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
          ctx.fillStyle = this.theme.text.primary;
          ctx.font = '600 14px -apple-system, system-ui, monospace';
          ctx.fillText(timeStr, x + 12, py + 4);
        } else {
          ctx.fillStyle = this.theme.text.muted;
          ctx.beginPath();
          ctx.arc(x + 20, py + 2, 6, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = this.theme.text.secondary;
          ctx.fillText('IDLE', x + 32, py + 6);

          py += 20;
          ctx.fillStyle = this.theme.text.muted;
          ctx.font = '11px -apple-system, system-ui, sans-serif';
          ctx.fillText(`mode: ${node.params.mode || 'toggle'}`, x + 12, py + 4);
        }
      } else if (node.type === 'bandsViz') {
        // Bands visualization - draw bar chart with LIVE data
        const bands = AudioEngine.data.bands;
        const bandNames = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
        const colors = ['#8b5cf6', '#3b82f6', '#22c55e', '#f97316', '#ef4444'];
        const chartX = x + 12;
        const chartY = y + hh + 8;
        const chartW = w - 24;
        const chartH = h - hh - 24;
        const barWidth = (chartW - (bandNames.length - 1) * 4) / bandNames.length;

        // Chart background
        ctx.fillStyle = this.theme.bg.secondary;
        ctx.beginPath();
        ctx.roundRect(chartX, chartY, chartW, chartH, 4);
        ctx.fill();

        // Draw bars with live values from AudioEngine.data.bands
        bandNames.forEach((band, i) => {
          const value = (bands[band] || 0) / 100; // Normalize 0-100 to 0-1
          const barH = Math.max(2, value * (chartH - 12)); // Minimum 2px height
          const bx = chartX + 4 + i * (barWidth + 4);
          const by = chartY + chartH - 6 - barH;

          ctx.fillStyle = colors[i];
          ctx.beginPath();
          ctx.roundRect(bx, by, barWidth - 2, barH, 2);
          ctx.fill();
        });

        // Labels
        ctx.font = '9px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = this.theme.text.secondary;
        bandNames.forEach((band, i) => {
          const bx = chartX + 4 + i * (barWidth + 4) + (barWidth - 2) / 2;
          ctx.fillText(band.charAt(0).toUpperCase(), bx, chartY + chartH + 10);
        });
        ctx.textAlign = 'left';

      } else if (node.type === 'timeSeriesViz') {
        // Time series visualization with LIVE data
        const chartX = x + 12;
        const chartY = y + hh + 8;
        const chartW = w - 24;
        const chartH = h - hh - 24;

        // Chart background
        ctx.fillStyle = this.theme.bg.primary;
        ctx.beginPath();
        ctx.roundRect(chartX, chartY, chartW, chartH, 4);
        ctx.fill();

        // Get time series data from AudioEngine
        const channel = (node.params.channel || 1) - 1; // 0-indexed
        const buffer = AudioEngine.vizData.timeSeries.channels[channel] || [];
        const scale = node.params.scale || 100;

        if (buffer.length > 1) {
          // Draw waveform from live data
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 1.5;
          ctx.beginPath();

          for (let i = 0; i < buffer.length; i++) {
            const px = chartX + (i / (buffer.length - 1)) * chartW;
            const sample = buffer[i] || 0;
            // Normalize sample to chart height
            const normalized = Math.max(-1, Math.min(1, sample / scale));
            const py2 = chartY + chartH / 2 - normalized * (chartH / 2 - 4);
            if (i === 0) ctx.moveTo(px, py2);
            else ctx.lineTo(px, py2);
          }
          ctx.stroke();
        } else {
          // No data - show placeholder text
          ctx.fillStyle = this.theme.text.muted;
          ctx.font = '10px -apple-system, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Waiting for data...', x + w / 2, chartY + chartH / 2);
        }

        // Channel label
        ctx.font = '9px -apple-system, system-ui, sans-serif';
        ctx.fillStyle = this.theme.text.muted;
        ctx.textAlign = 'left';
        ctx.fillText(`CH${node.params.channel || 1}`, chartX + 4, chartY + 12);

      } else if (node.type === 'fftViz') {
        // FFT visualization with LIVE data
        const chartX = x + 12;
        const chartY = y + hh + 8;
        const chartW = w - 24;
        const chartH = h - hh - 24;

        // Chart background
        ctx.fillStyle = this.theme.bg.primary;
        ctx.beginPath();
        ctx.roundRect(chartX, chartY, chartW, chartH, 4);
        ctx.fill();

        // Get FFT data from AudioEngine
        const channel = (node.params.channel || 1) - 1; // 0-indexed
        const psd = AudioEngine.vizData.fft.psd[channel] || [];
        const colorScheme = node.params.colorScheme || 'cyan';
        const colors = {
          cyan: '#06b6d4',
          purple: '#8b5cf6',
          green: '#22c55e',
          orange: '#f97316'
        };

        if (psd.length > 1) {
          // Draw spectrum bars from live data
          const numBars = Math.min(32, psd.length);
          const barWidth = (chartW - 4) / numBars;

          ctx.fillStyle = colors[colorScheme] || colors.cyan;

          for (let i = 0; i < numBars; i++) {
            const psdIndex = Math.floor(i * psd.length / numBars);
            const value = psd[psdIndex] || 0;
            // Normalize PSD value (log scale works better for FFT)
            const normalized = value > 0 ? Math.min(1, Math.log10(value + 1) / 3) : 0;
            const barH = Math.max(1, normalized * (chartH - 8));
            const bx = chartX + 2 + i * barWidth;
            const by = chartY + chartH - 4 - barH;

            ctx.beginPath();
            ctx.roundRect(bx, by, barWidth - 1, barH, 1);
            ctx.fill();
          }
        } else {
          // No data - show placeholder text
          ctx.fillStyle = this.theme.text.muted;
          ctx.font = '10px -apple-system, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Waiting for data...', x + w / 2, chartY + chartH / 2);
        }

        // Channel label
        ctx.font = '9px -apple-system, system-ui, sans-serif';
        ctx.fillStyle = this.theme.text.muted;
        ctx.textAlign = 'left';
        ctx.fillText(`CH${node.params.channel || 1}`, chartX + 4, chartY + 12);

      } else if (node.type === 'faceViz') {
        // Face visualization - show CV feature meters
        const chartX = x + 12;
        const chartY = y + hh + 8;
        const chartW = w - 24;
        const chartH = h - hh - 16;

        const cv = AudioEngine.data.cv;
        const features = [
          { name: 'mouth', label: 'Mouth', key: 'mouth' },
          { name: 'smile', label: 'Smile', key: 'smile' },
          { name: 'roll', label: 'Roll', key: 'roll' },
          { name: 'brow', label: 'Brow', key: 'brow' },
          { name: 'yaw', label: 'Yaw', key: 'yaw' }
        ];

        const meterH = 12;
        const meterSpacing = (chartH - 4) / features.length;

        features.forEach((feat, i) => {
          const my = chartY + i * meterSpacing;
          const value = cv[feat.key] || 0;

          // Background meter
          ctx.fillStyle = this.theme.bg.primary;
          ctx.beginPath();
          ctx.roundRect(chartX + 40, my, chartW - 44, meterH, 2);
          ctx.fill();

          // Value meter
          ctx.fillStyle = '#9333ea';
          ctx.beginPath();
          ctx.roundRect(chartX + 40, my, (chartW - 44) * Math.min(1, value), meterH, 2);
          ctx.fill();

          // Label
          ctx.fillStyle = this.theme.text.secondary;
          ctx.font = '9px -apple-system, system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(feat.label, chartX, my + meterH - 2);
        });

      } else if (node.type === 'gazeViz') {
        // Gaze visualization - show gaze position on grid
        const chartX = x + 12;
        const chartY = y + hh + 8;
        const chartW = w - 24;
        const chartH = h - hh - 16;

        const gaze = AudioEngine.data.gaze;
        const gazeX = (gaze.x + 1) / 2; // -1 to 1 -> 0 to 1
        const gazeY = (gaze.y + 1) / 2;

        // Grid background
        ctx.fillStyle = this.theme.bg.primary;
        ctx.beginPath();
        ctx.roundRect(chartX, chartY, chartW, chartH, 4);
        ctx.fill();

        // Crosshair
        ctx.strokeStyle = this.theme.bg.tertiary;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartX, chartY + chartH / 2);
        ctx.lineTo(chartX + chartW, chartY + chartH / 2);
        ctx.moveTo(chartX + chartW / 2, chartY);
        ctx.lineTo(chartX + chartW / 2, chartY + chartH);
        ctx.stroke();

        // Gaze dot
        const dotX = chartX + gazeX * chartW;
        const dotY = chartY + gazeY * chartH;
        ctx.fillStyle = '#9333ea';
        ctx.beginPath();
        ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
        ctx.fill();

        // Confidence indicator
        ctx.fillStyle = this.theme.text.muted;
        ctx.font = '9px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round((gaze.confidence || 0) * 100)}%`, x + w / 2, y + h - 4);

      } else if (node.type === 'handsViz') {
        // Hands visualization - show hand detection status and pinch
        const chartX = x + 12;
        const chartY = y + hh + 8;
        const chartW = w - 24;
        const chartH = h - hh - 16;

        const hands = AudioEngine.data.hands;
        const leftHand = hands.left;
        const rightHand = hands.right;

        // Left hand section
        const leftY = chartY;
        const halfH = (chartH - 8) / 2;

        ctx.fillStyle = (leftHand && leftHand.detected) ? '#22c55e' : this.theme.text.muted;
        ctx.font = '10px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(leftHand && leftHand.detected ? 'L: Detected' : 'L: --', chartX, leftY + 12);

        if (leftHand && leftHand.detected) {
          // Pinch meter
          ctx.fillStyle = this.theme.bg.primary;
          ctx.beginPath();
          ctx.roundRect(chartX, leftY + 18, chartW, 10, 2);
          ctx.fill();
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.roundRect(chartX, leftY + 18, chartW * (leftHand.pinch_distance || 0), 10, 2);
          ctx.fill();
        }

        // Right hand section
        const rightY = chartY + halfH + 8;

        ctx.fillStyle = (rightHand && rightHand.detected) ? '#3b82f6' : this.theme.text.muted;
        ctx.font = '10px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(rightHand && rightHand.detected ? 'R: Detected' : 'R: --', chartX, rightY + 12);

        if (rightHand && rightHand.detected) {
          // Pinch meter
          ctx.fillStyle = this.theme.bg.primary;
          ctx.beginPath();
          ctx.roundRect(chartX, rightY + 18, chartW, 10, 2);
          ctx.fill();
          ctx.fillStyle = '#3b82f6';
          ctx.beginPath();
          ctx.roundRect(chartX, rightY + 18, chartW * (rightHand.pinch_distance || 0), 10, 2);
          ctx.fill();
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
  },

  // -------- Zoom Methods --------
  setZoom: function(level) {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, level));
  },

  zoomIn: function() {
    this.setZoom(this.zoom * 1.25);
  },

  zoomOut: function() {
    this.setZoom(this.zoom / 1.25);
  },

  // -------- Theme Support --------
  themes: {
    dark: {
      bg: { primary: '#0d1117', secondary: '#161b22', tertiary: '#21262d' },
      text: { primary: '#f0f6fc', secondary: '#8b949e', muted: '#484f58' },
      node: { bg: '#1c2128', bgSelected: '#263038', border: '#30363d', borderSelected: '#58a6ff' },
      port: { input: '#58a6ff', output: '#f97316', hover: '#ffffff' },
      cable: { default: '#58a6ff', active: '#a855f7', glow: 'rgba(88, 166, 255, 0.3)' }
    },
    light: {
      bg: { primary: '#ffffff', secondary: '#f6f8fa', tertiary: '#eaeef2' },
      text: { primary: '#24292f', secondary: '#57606a', muted: '#8c959f' },
      node: { bg: '#ffffff', bgSelected: '#f3f4f6', border: '#d0d7de', borderSelected: '#0969da' },
      port: { input: '#0969da', output: '#bf8700', hover: '#24292f' },
      cable: { default: '#0969da', active: '#8250df', glow: 'rgba(9, 105, 218, 0.3)' }
    }
  },

  currentTheme: 'dark',

  setTheme: function(themeName) {
    if (this.themes[themeName]) {
      const newTheme = this.themes[themeName];
      this.theme.bg = { ...newTheme.bg };
      this.theme.text = { ...newTheme.text };
      this.theme.node = { ...newTheme.node };
      this.theme.port = { ...newTheme.port };
      this.theme.cable = { ...newTheme.cable };
      this.currentTheme = themeName;
    }
  },

  // -------- Multi-Select Methods --------
  isNodeSelected: function(nodeId) {
    return this.selectedNodes.has(nodeId);
  },

  toggleNodeSelection: function(nodeId) {
    if (this.selectedNodes.has(nodeId)) {
      this.selectedNodes.delete(nodeId);
    } else {
      this.selectedNodes.add(nodeId);
    }
  },

  selectAllNodes: function() {
    for (const node of this.nodes) {
      this.selectedNodes.add(node.id);
    }
  },

  clearSelection: function() {
    this.selectedNodes.clear();
    this.selectedNode = null;
  },

  deleteSelectedNodes: function() {
    for (const nodeId of this.selectedNodes) {
      this.removeNode(nodeId);
    }
    this.selectedNodes.clear();
  },

  // -------- Helper for box intersection --------
  boxIntersects: function(box, x, y, w, h) {
    return !(box.x + box.width < x || x + w < box.x || box.y + box.height < y || y + h < box.y);
  },

  normalizeBox: function(box) {
    const x = Math.min(box.startX, box.endX);
    const y = Math.min(box.startY, box.endY);
    const width = Math.abs(box.endX - box.startX);
    const height = Math.abs(box.endY - box.startY);
    return { x, y, width, height };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Patcher;
}
