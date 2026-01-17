import os
import json
import re
import hashlib
from typing import Optional, Dict, Any, List
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import OrderedDict
import time

# Import semantic taxonomy for prompt enhancement
try:
    from .taxonomy import get_semantic_mapping, enhance_prompt_with_context
except ImportError:
    # Fallback if taxonomy module not available
    def get_semantic_mapping(prompt): return {"keywords": [], "affinities": {}, "primary_biosignal": "alpha", "suggested_params": []}
    def enhance_prompt_with_context(prompt): return prompt


class SketchCache:
    """LRU cache for generated sketches to reduce redundant API calls."""

    def __init__(self, max_size: int = 50):
        self.max_size = max_size
        self._cache: OrderedDict = OrderedDict()

    def _get_key(self, prompt: str, context: str = "") -> str:
        """Generate a cache key from prompt and context."""
        content = f"{prompt.lower().strip()}|{context}"
        return hashlib.md5(content.encode()).hexdigest()

    def get(self, prompt: str, context: str = "") -> Optional[Dict]:
        """Get cached result if available."""
        key = self._get_key(prompt, context)
        if key in self._cache:
            # Move to end (most recently used)
            self._cache.move_to_end(key)
            return self._cache[key]
        return None

    def set(self, prompt: str, context: str, value: Dict) -> None:
        """Cache a generation result."""
        key = self._get_key(prompt, context)
        self._cache[key] = value
        self._cache.move_to_end(key)
        # Evict oldest if over capacity
        while len(self._cache) > self.max_size:
            self._cache.popitem(last=False)

    def clear(self) -> None:
        """Clear all cached entries."""
        self._cache.clear()


class AssistantService:

    SYSTEM_PROMPT = """You are an AI assistant for HeadWave, a visual biosignal programming environment.

PATCH CREATION:
When the user asks you to create nodes, patches, or audio/visual setups, respond with a JSON patch definition:

```json
{"action":"create_patch","patch":{"nodes":[...],"connections":[...]}}
```

AVAILABLE NODES:
Audio Sources:
- oscillator: params {frequency, detune, type: sine/square/sawtooth/triangle}
- noise: params {type: white/pink}
- sampler: params {speed}

Audio Processing:
- filter: params {frequency, q, type: lowpass/highpass/bandpass}
- gain: params {gain}
- delay: params {time, feedback}

Modulators:
- lfo: params {frequency, type: sine/square/sawtooth/triangle}
- eegBand: params {band: delta/theta/alpha/beta/gamma, smoothing}
- timeSeries: params {channel: 1-8, metric: amplitude/rms/peak/mean, smoothing} - raw EEG as control signal
- cvFeature: params {feature: mouth/yaw/roll/smile/brow/gaze_x/gaze_y/engagement, smoothing}
- handFeature: params {hand: left/right, feature: detected/pinch/openness/x/y/z, smoothing}
- scale: params {min, max} - maps 0-1 input to min-max range

Output:
- output: Audio output
- canvas: Visual output, params {background, trails}
- recording: Session recorder, params {autoStop, mode: toggle/gate}

Senders:
- oscSender: params {address, ip, port}
- midiCCSender: params {cc, channel, scale}
- midiNoteSender: params {note, channel, duration}

Visualization (show live data):
- bandsViz: EEG band powers, outputs delta/theta/alpha/beta/gamma, params {displayMode}
- timeSeriesViz: EEG waveform, params {channel: 1-8, windowSec, scale}
- fftViz: FFT spectrum, params {channel: 1-8, windowSec, colorScheme}
- faceViz: Face tracking meters, outputs engagement
- gazeViz: Eye gaze position, outputs x/y
- handsViz: Hand tracking, outputs leftPinch/rightPinch, params {hand: left/right/both}

Visual Shapes:
- ellipse, rect, polygon, line, text, particles, color, transform

CONNECTION FORMAT:
{"from":0,"fromPort":"signal","to":1,"toPort":"frequency"}
(Use array indices for from/to node references)

EXAMPLE PATCH:
```json
{"action":"create_patch","patch":{
  "nodes":[
    {"type":"oscillator","x":100,"y":100,"params":{"frequency":440}},
    {"type":"eegBand","x":100,"y":250,"params":{"band":"alpha"}},
    {"type":"scale","x":250,"y":250,"params":{"min":200,"max":800}},
    {"type":"output","x":400,"y":100}
  ],
  "connections":[
    {"from":1,"fromPort":"signal","to":2,"toPort":"signal"},
    {"from":2,"fromPort":"signal","to":0,"toPort":"frequency"},
    {"from":0,"fromPort":"audio","to":3,"toPort":"audio"}
  ]
}}
```

For general questions about HeadWave, EEG, OSC, or creative coding, respond normally with text.

EEG Frequency Bands:
- Delta (0.5-4 Hz): Deep sleep
- Theta (4-8 Hz): Meditation, creativity
- Alpha (8-13 Hz): Relaxed, calm
- Beta (13-30 Hz): Active focus
- Gamma (30-50 Hz): High cognition

Be concise and always format patches as valid JSON."""

    def __init__(self):
        self.client = None
        self.available = False
        self.sketch_cache = SketchCache(max_size=50)
        self._init_client()

    def _init_client(self):
        try:
            from groq import Groq
            api_key = os.getenv("GROQ_API_KEY")
            if api_key:
                self.client = Groq(api_key=api_key)
                self.available = True
        except ImportError:
            self.available = False

    def is_available(self) -> bool:
        return self.available and self.client is not None

    def get_api_key_error(self) -> str:
        return "Groq API key not found. Please set GROQ_API_KEY environment variable.\n\nGet your free API key at: https://console.groq.com"

    def chat(self, message: str) -> Dict[str, Any]:
        if not message:
            return {"status": "error", "message": "No message provided"}

        if not self.is_available():
            api_key = os.getenv("GROQ_API_KEY")
            if not api_key:
                return {"status": "error", "message": self.get_api_key_error()}
            return {"status": "error", "message": "Groq client not initialized"}

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": message}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.7,
                max_tokens=1024,
            )

            response_text = chat_completion.choices[0].message.content
            return {"status": "ok", "response": response_text}

        except Exception as e:
            return {"status": "error", "message": f"Error: {str(e)}"}

    # ============ AI VISUAL GENERATION ============

    # Fallback sketches for error recovery
    FALLBACK_SKETCHES = {
        "default": """function(p) {
  let t = 0;
  p.setup = function() {
    p.createCanvas(400, 400);
    p.colorMode(p.HSB, 360, 100, 100, 100);
    p.noStroke();
  };
  p.draw = function() {
    let intensity = p.getParam('intensity') || 0.5;
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
}""",
        "error": """function(p) {
  p.setup = function() {
    p.createCanvas(400, 400);
    p.colorMode(p.HSB, 360, 100, 100, 100);
  };
  p.draw = function() {
    p.background(0, 60, 15);
    p.fill(0, 0, 60);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(14);
    p.text('Visual generation error', p.width/2, p.height/2 - 10);
    p.textSize(11);
    p.fill(0, 0, 40);
    p.text('Try a different prompt', p.width/2, p.height/2 + 15);
  };
}""",
        "minimal": """function(p) {
  let t = 0;
  p.setup = function() {
    p.createCanvas(400, 400);
    p.colorMode(p.HSB, 360, 100, 100, 100);
    p.noStroke();
  };
  p.draw = function() {
    let calmLevel = p.getParam('calmLevel') || 0.5;
    p.background(220, 15, 10);
    t += 0.015;
    let size = p.min(p.width, p.height) * 0.25 * (1 + p.sin(t) * 0.2 * calmLevel);
    p.fill(200, 40, 70, 50);
    p.ellipse(p.width/2, p.height/2, size, size);
  };
}"""
    }

    @classmethod
    def get_fallback_sketch(cls, sketch_type: str = "default") -> str:
        """Get a fallback sketch for error recovery."""
        return cls.FALLBACK_SKETCHES.get(sketch_type, cls.FALLBACK_SKETCHES["default"])

    # Biosignal-to-Visual Taxonomy (Spellburst approach)
    BIOSIGNAL_TAXONOMY = """
BIOSIGNAL-TO-VISUAL MAPPING:
When designing parameters, consider how biosignals naturally map to visual properties:

ALPHA (8-13 Hz) - Relaxed, calm states:
  → Gentle pulsing rhythms (0.5-2 Hz oscillation)
  → Soft, warm colors (blues, purples, soft greens)
  → Slow, flowing motion
  → Low complexity, smooth curves
  → High transparency/soft edges

BETA (13-30 Hz) - Active focus, concentration:
  → Sharp edges and geometric patterns
  → High contrast colors
  → Rapid motion and quick transitions
  → Medium-high complexity
  → Strong, defined shapes

THETA (4-8 Hz) - Creative, meditative states:
  → Flowing, organic shapes
  → Color gradients and transitions
  → Dream-like, morphing forms
  → Spiral and wave patterns
  → Soft particle systems

GAMMA (30-50 Hz) - High cognition, insight:
  → Complex, intricate patterns
  → Fine detail and texture
  → Rapid color shifts
  → Fractal-like structures
  → High density elements

DELTA (0.5-4 Hz) - Deep relaxation:
  → Very slow, breathing-like motion
  → Dark, deep colors
  → Minimal complexity
  → Ambient, subtle changes
  → Large, smooth shapes

HAND TRACKING:
  → pinch: Intensity control, trigger events (0-1)
  → openness: Scale/size modulation (0-1)
  → x/y/z position: Spatial control, cursor position

FACE TRACKING:
  → smile: Brightness, positive color shift (0-1)
  → brow: Tension, complexity (0-1)
  → mouth: Volume, scale (0-1)
  → gaze x/y: Focus point, direction (-1 to 1)
"""

    # Few-shot examples (Spellburst approach)
    FEW_SHOT_EXAMPLES = """
=== EXAMPLE 1: Simple (Breathing Circle) ===
PROMPT: "a pulsing circle that breathes"
THOUGHT: Need smooth expand/contract animation using sin(). Parameters: speed controls breathing rate, intensity affects size variation, calmLevel for alpha-responsive softness.
CODE:
function(p) {
  let t = 0;
  p.setup = function() {
    p.createCanvas(400, 400);
    p.colorMode(p.HSB, 360, 100, 100, 100);
    p.noStroke();
  };
  p.draw = function() {
    let speed = p.getParam('speed') || 0.02;
    let intensity = p.getParam('intensity') || 1;
    let calmLevel = p.getParam('calmLevel') || 0.5;
    p.background(220, 20, 10);
    t += speed;
    let baseSize = p.min(p.width, p.height) * 0.3;
    let breathe = p.sin(t) * 0.3 * intensity;
    let size = baseSize * (1 + breathe);
    let alpha = 60 + calmLevel * 30;
    p.fill(200 + calmLevel * 40, 60, 80, alpha);
    p.ellipse(p.width/2, p.height/2, size, size);
    p.fill(210 + calmLevel * 30, 40, 95, alpha * 0.5);
    p.ellipse(p.width/2, p.height/2, size * 0.6, size * 0.6);
  };
}
---PARAMS---
[{"name":"speed","min":0.005,"max":0.08,"default":0.02},{"name":"intensity","min":0.2,"max":2,"default":1},{"name":"calmLevel","min":0,"max":1,"default":0.5}]

=== EXAMPLE 2: Medium (Neural Particles) ===
PROMPT: "particles that respond to brain waves"
THOUGHT: Particle system with flow field. brainActivity controls particle speed/energy, colorShift for hue modulation, complexity for particle count. Cache particles array outside draw().
CODE:
function(p) {
  let particles = [];
  const MAX_PARTICLES = 100;
  p.setup = function() {
    p.createCanvas(400, 400);
    p.colorMode(p.HSB, 360, 100, 100, 100);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      particles.push({x: p.random(p.width), y: p.random(p.height), vx: 0, vy: 0, life: p.random(100, 200)});
    }
  };
  p.draw = function() {
    let brainActivity = p.getParam('brainActivity') || 0.5;
    let colorShift = p.getParam('colorShift') || 180;
    let complexity = p.getParam('complexity') || 0.5;
    p.background(240, 30, 8, 25);
    let count = p.floor(20 + complexity * 80);
    for (let i = 0; i < p.min(count, particles.length); i++) {
      let pt = particles[i];
      let angle = p.noise(pt.x * 0.01, pt.y * 0.01, p.frameCount * 0.01) * p.TWO_PI * 2;
      let speed = 0.5 + brainActivity * 3;
      pt.vx = p.lerp(pt.vx, p.cos(angle) * speed, 0.1);
      pt.vy = p.lerp(pt.vy, p.sin(angle) * speed, 0.1);
      pt.x += pt.vx; pt.y += pt.vy;
      pt.life--;
      if (pt.life <= 0 || pt.x < 0 || pt.x > p.width || pt.y < 0 || pt.y > p.height) {
        pt.x = p.random(p.width); pt.y = p.random(p.height); pt.life = p.random(100, 200);
      }
      let hue = (colorShift + brainActivity * 60 + i) % 360;
      let alpha = p.map(pt.life, 0, 200, 0, 80);
      p.noStroke();
      p.fill(hue, 70, 90, alpha);
      let size = 3 + brainActivity * 4;
      p.ellipse(pt.x, pt.y, size, size);
    }
  };
}
---PARAMS---
[{"name":"brainActivity","min":0,"max":1,"default":0.5},{"name":"colorShift","min":0,"max":360,"default":180},{"name":"complexity","min":0,"max":1,"default":0.5}]

=== EXAMPLE 3: Complex (Sacred Geometry Mandala) ===
PROMPT: "sacred geometry mandala for meditation"
THOUGHT: Radial symmetry with multiple layers. layers param controls depth, rotationSpeed for animation, calmLevel affects overall pace. Use push/pop for rotation transforms.
CODE:
function(p) {
  let t = 0;
  p.setup = function() {
    p.createCanvas(400, 400);
    p.colorMode(p.HSB, 360, 100, 100, 100);
  };
  p.draw = function() {
    let layers = p.floor(p.getParam('layers') || 5);
    let rotationSpeed = p.getParam('rotationSpeed') || 0.01;
    let calmLevel = p.getParam('calmLevel') || 0.5;
    let colorBase = p.getParam('colorBase') || 200;
    p.background(240, 15, 8);
    t += rotationSpeed * (0.5 + calmLevel * 0.5);
    p.translate(p.width/2, p.height/2);
    p.noFill();
    for (let layer = 0; layer < layers; layer++) {
      let layerRatio = layer / layers;
      let radius = 30 + layerRatio * p.min(p.width, p.height) * 0.4;
      let sides = 6 + layer * 2;
      let hue = (colorBase + layer * 20) % 360;
      p.push();
      p.rotate(t * (layer % 2 === 0 ? 1 : -1) * (1 - layerRatio * 0.5));
      p.stroke(hue, 50 + calmLevel * 30, 70, 60);
      p.strokeWeight(1 + calmLevel);
      p.beginShape();
      for (let i = 0; i <= sides; i++) {
        let angle = p.TWO_PI * i / sides;
        let r = radius + p.sin(t * 2 + layer + i) * 10 * (1 - calmLevel * 0.5);
        p.vertex(p.cos(angle) * r, p.sin(angle) * r);
      }
      p.endShape(p.CLOSE);
      p.pop();
    }
    for (let i = 0; i < 6; i++) {
      p.push();
      p.rotate(p.TWO_PI * i / 6 + t * 0.5);
      p.stroke((colorBase + 60) % 360, 40, 80, 40);
      p.line(20, 0, p.min(p.width, p.height) * 0.45, 0);
      p.pop();
    }
  };
}
---PARAMS---
[{"name":"layers","min":2,"max":8,"default":5},{"name":"rotationSpeed","min":0.002,"max":0.04,"default":0.01},{"name":"calmLevel","min":0,"max":1,"default":0.5},{"name":"colorBase","min":0,"max":360,"default":200}]
"""

    P5JS_GENERATION_PROMPT = """You are a p5.js expert for HeadWave, a biosignal visual programming tool. Generate complete, optimized, interactive p5.js sketches that respond to brain signals (EEG), hand tracking, and face tracking.

THINKING PROCESS (follow this for each generation):
1. INTERPRET: What is the core visual concept? What mood/feeling should it evoke?
2. STRUCTURE: Which p5.js techniques are needed? (particles, geometry, noise, etc.)
3. PARAMETERS: What 3-4 controllable values make sense for biosignal input?
4. OPTIMIZE: How to maintain 60fps? (cache arrays, avoid object creation in draw)

""" + BIOSIGNAL_TAXONOMY + """

""" + FEW_SHOT_EXAMPLES + """

INTERACTIVE PARAMETERS (CRITICAL):
- Include 3-4 parameters using p.getParam('name') for real-time biosignal control
- Each p.getParam() call MUST have a sensible default: p.getParam('paramName') || defaultValue
- Choose parameter names that reflect biosignal mapping (e.g., calmLevel, brainActivity, focusIntensity)
- Parameter ranges should be 0-1 for direct biosignal mapping, or intuitive ranges for manual control

CODE REQUIREMENTS (self-validate before outputting):
1. Format: function(p) { ... } (p5.js instance mode)
2. Must have p.setup and p.draw functions
3. All p.getParam() calls need || defaultValue fallback
4. No undefined variables
5. No division by zero risks
6. Use p.colorMode(p.HSB, 360, 100, 100, 100) for dynamic colors
7. Make responsive using p.width and p.height
8. Performance: cache arrays/objects at top level, avoid creating objects in draw()
9. NO debug text or parameter displays - only render visual elements

OUTPUT FORMAT:
Output the JavaScript code, then "---PARAMS---" followed by a JSON array of parameters.

CRITICAL: Your response must start IMMEDIATELY with "function(p)" - no text before it, no markdown, no explanation. Just the raw code followed by ---PARAMS--- and the JSON array."""

    PARAMETER_EXTRACTION_PROMPT = """Analyze this p5.js code and identify controllable parameters that could be exposed as node inputs for modulation.

Look for:
1. Numeric constants that affect the visual (speeds, sizes, counts, angles)
2. Color values (hue, saturation, brightness)
3. Animation timing values
4. Pattern complexity values
5. Existing p.getParam() calls

For each parameter, provide:
- name: camelCase identifier
- displayName: Human readable name
- type: 'number'
- default: Current or suggested default value
- min: Reasonable minimum
- max: Reasonable maximum

OUTPUT FORMAT (valid JSON only, no markdown):
{
  "parameters": [
    {
      "name": "speed",
      "displayName": "Animation Speed",
      "type": "number",
      "default": 0.01,
      "min": 0.001,
      "max": 0.1
    }
  ]
}

Identify 3-6 meaningful parameters. Output ONLY valid JSON."""

    def generate_visual(self, prompt: str, background_color: str = "#0d1117",
                        previous_code: str = None, previous_prompt: str = None,
                        use_cache: bool = True) -> Dict[str, Any]:
        """Generate p5.js code from a natural language description with embedded parameters."""
        if not prompt:
            return {"status": "error", "message": "No prompt provided"}

        if not self.is_available():
            return {"status": "error", "message": "AI service not available"}

        # Check cache for new sketches (not iterations)
        cache_context = f"{background_color}"
        if use_cache and not previous_code:
            cached = self.sketch_cache.get(prompt, cache_context)
            if cached:
                return {"status": "ok", "code": cached["code"],
                        "parameters": cached["parameters"], "cached": True}

        # Get semantic mapping for better context-aware generation
        semantic_map = get_semantic_mapping(prompt)

        # Build the user message
        if previous_code:
            # Iterative refinement mode - modify existing code
            user_message = f"""MODIFY the existing p5.js sketch based on this request: "{prompt}"

PREVIOUS PROMPT: {previous_prompt or 'N/A'}

EXISTING CODE TO MODIFY:
```javascript
{previous_code}
```

Apply the requested changes while preserving the overall structure and working parts.
Output the COMPLETE modified code with ---PARAMS--- section."""
        else:
            # New sketch mode with semantic context
            enhanced_prompt = enhance_prompt_with_context(prompt)
            user_message = f"Create a p5.js sketch for: {enhanced_prompt}"

            # Add biosignal optimization hint
            if semantic_map.get("primary_biosignal"):
                biosignal = semantic_map["primary_biosignal"]
                user_message += f"\n\nOPTIMIZE FOR: {biosignal} biosignal input (include a '{biosignal}Level' or similar parameter)"

        if background_color and background_color != "#0d1117":
            user_message += f"\n\nIMPORTANT: Use this background color: {background_color}"

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": self.P5JS_GENERATION_PROMPT},
                    {"role": "user", "content": user_message}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.35 if previous_code else 0.45,
                max_tokens=2500,
            )

            response_text = chat_completion.choices[0].message.content.strip()

            # Parse the response: code + ---PARAMS--- + JSON
            code = response_text
            parameters = []

            # Check for ---PARAMS--- separator
            if "---PARAMS---" in response_text:
                parts = response_text.split("---PARAMS---")
                code = parts[0].strip()
                if len(parts) > 1:
                    params_json = parts[1].strip()
                    # Clean markdown if present
                    if "```" in params_json:
                        matches = re.findall(r'```(?:json)?\s*([\s\S]*?)```', params_json)
                        if matches:
                            params_json = matches[0].strip()
                    try:
                        parameters = json.loads(params_json)
                    except json.JSONDecodeError:
                        pass  # Fall back to extraction

            # Clean up code - remove any markdown code blocks
            if "```" in code:
                matches = re.findall(r'```(?:javascript|js)?\s*([\s\S]*?)```', code)
                if matches:
                    code = matches[0].strip()

            # Extract just the function - find function(p) { ... }
            func_match = re.search(r'(function\s*\(\s*p\s*\)\s*\{[\s\S]*\})\s*$', code)
            if func_match:
                code = func_match.group(1)

            # Validate it looks like a p5.js sketch
            if "function(p)" not in code and "p.setup" not in code:
                return {"status": "error", "message": "Generated code doesn't appear to be valid p5.js"}

            # Cache successful new generations
            if not previous_code:
                self.sketch_cache.set(prompt, cache_context, {"code": code, "parameters": parameters})

            return {"status": "ok", "code": code, "parameters": parameters}

        except Exception as e:
            return {"status": "error", "message": f"Error generating visual: {str(e)}"}

    def extract_parameters(self, code: str) -> Dict[str, Any]:
        """Extract controllable parameters from p5.js code."""
        if not code:
            return {"status": "error", "message": "No code provided"}

        if not self.is_available():
            return {"status": "error", "message": "AI service not available"}

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": self.PARAMETER_EXTRACTION_PROMPT},
                    {"role": "user", "content": f"Extract parameters from this code:\n\n{code}"}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.3,  # Lower temp for more consistent JSON
                max_tokens=1024,
            )

            response_text = chat_completion.choices[0].message.content.strip()

            # Clean up response - remove any markdown
            json_text = response_text
            if "```" in json_text:
                matches = re.findall(r'```(?:json)?\s*([\s\S]*?)```', json_text)
                if matches:
                    json_text = matches[0].strip()

            # Parse JSON
            try:
                result = json.loads(json_text)
                parameters = result.get("parameters", [])

                # Validate parameter structure
                valid_params = []
                for param in parameters:
                    if all(k in param for k in ["name", "default", "min", "max"]):
                        valid_params.append({
                            "name": param["name"],
                            "displayName": param.get("displayName", param["name"]),
                            "type": param.get("type", "number"),
                            "default": float(param["default"]),
                            "min": float(param["min"]),
                            "max": float(param["max"])
                        })

                return {"status": "ok", "parameters": valid_params}

            except json.JSONDecodeError:
                # If JSON parsing fails, return empty parameters
                return {"status": "ok", "parameters": []}

        except Exception as e:
            return {"status": "error", "message": f"Error extracting parameters: {str(e)}"}

    # ============ VALIDATION AGENT ============

    VALIDATION_PROMPT = """You are a p5.js code validator. Analyze the provided code for errors and issues.

CHECK FOR:
1. Syntax errors (missing brackets, semicolons, typos)
2. Undefined variables or functions
3. Invalid p5.js API usage
4. Logic errors that would cause crashes
5. Missing required functions (setup, draw)
6. Incorrect function signatures
7. Division by zero risks
8. Array index out of bounds risks

OUTPUT FORMAT (JSON only, no markdown):
{
  "valid": true/false,
  "issues": [
    {
      "severity": "error" | "warning",
      "line": "approximate line or location",
      "message": "description of the issue",
      "fix": "suggested fix"
    }
  ],
  "fixedCode": "// If there are errors, provide the corrected code here. If valid, return null"
}

If the code is valid, return: {"valid": true, "issues": [], "fixedCode": null}
If there are issues, fix them and return the corrected code in fixedCode.

Output ONLY valid JSON."""

    def validate_code(self, code: str) -> Dict[str, Any]:
        """Validate p5.js code and fix any issues."""
        if not code:
            return {"status": "error", "message": "No code provided"}

        if not self.is_available():
            return {"status": "error", "message": "AI service not available"}

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": self.VALIDATION_PROMPT},
                    {"role": "user", "content": f"Validate this p5.js code:\n\n{code}"}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.2,  # Low temp for consistent validation
                max_tokens=2048,
            )

            response_text = chat_completion.choices[0].message.content.strip()

            # Clean up response
            json_text = response_text
            if "```" in json_text:
                matches = re.findall(r'```(?:json)?\s*([\s\S]*?)```', json_text)
                if matches:
                    json_text = matches[0].strip()

            try:
                result = json.loads(json_text)
                return {
                    "status": "ok",
                    "valid": result.get("valid", True),
                    "issues": result.get("issues", []),
                    "fixedCode": result.get("fixedCode")
                }
            except json.JSONDecodeError:
                return {"status": "ok", "valid": True, "issues": [], "fixedCode": None}

        except Exception as e:
            return {"status": "error", "message": f"Error validating code: {str(e)}"}

    # ============ OPTIMIZATION AGENT ============

    OPTIMIZATION_PROMPT = """You are a p5.js performance optimization expert. Optimize the provided code for maximum performance.

OPTIMIZATION STRATEGIES:
1. **Reduce draw() overhead**: Move calculations that don't change to setup() or use caching
2. **Minimize object creation**: Reuse arrays, vectors, objects instead of creating new ones each frame
3. **Use efficient loops**: Prefer for loops over forEach, avoid nested loops when possible
4. **Reduce function calls**: Inline simple calculations, avoid unnecessary function wrapping
5. **Optimize math**: Use bitwise operations for integers, cache repeated calculations
6. **Batch drawing**: Group similar drawing operations, use beginShape/endShape for complex shapes
7. **Reduce state changes**: Minimize push()/pop(), fill(), stroke() calls
8. **Use noStroke()/noFill()**: When not needed
9. **Limit particles/objects**: Use object pooling for particle systems
10. **Use frameCount wisely**: Throttle expensive operations (e.g., every 2nd frame)

OUTPUT FORMAT (JSON only, no markdown):
{
  "optimized": true/false,
  "improvements": [
    {
      "type": "performance" | "memory" | "readability",
      "description": "what was optimized",
      "impact": "high" | "medium" | "low"
    }
  ],
  "optimizedCode": "// The optimized code here",
  "estimatedSpeedup": "e.g., '~2x faster' or '30% reduction in memory'"
}

Output ONLY valid JSON with the optimized code."""

    def optimize_code(self, code: str) -> Dict[str, Any]:
        """Optimize p5.js code for performance."""
        if not code:
            return {"status": "error", "message": "No code provided"}

        if not self.is_available():
            return {"status": "error", "message": "AI service not available"}

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": self.OPTIMIZATION_PROMPT},
                    {"role": "user", "content": f"Optimize this p5.js code for performance:\n\n{code}"}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.3,
                max_tokens=2048,
            )

            response_text = chat_completion.choices[0].message.content.strip()

            # Clean up response
            json_text = response_text
            if "```" in json_text:
                matches = re.findall(r'```(?:json)?\s*([\s\S]*?)```', json_text)
                if matches:
                    json_text = matches[0].strip()

            try:
                result = json.loads(json_text)
                return {
                    "status": "ok",
                    "optimized": result.get("optimized", False),
                    "improvements": result.get("improvements", []),
                    "optimizedCode": result.get("optimizedCode"),
                    "estimatedSpeedup": result.get("estimatedSpeedup", "")
                }
            except json.JSONDecodeError:
                # If JSON parsing fails, try to extract just the code
                return {"status": "error", "message": "Failed to parse optimization result"}

        except Exception as e:
            return {"status": "error", "message": f"Error optimizing code: {str(e)}"}

    # ============ INTERACTIVITY AGENT ============

    INTERACTIVITY_PROMPT = """You are a p5.js interactivity expert for HeadWave, a biosignal visual programming environment.

Your job is to identify parameters in the code that should be exposed for real-time control via:
- EEG brain signals (delta, theta, alpha, beta, gamma bands)
- Hand tracking (pinch, openness, position x/y/z)
- Face tracking (smile, brow, mouth, yaw, roll, gaze)
- LFOs and other modulators

ANALYZE THE CODE FOR:
1. **Hardcoded values** that could be dynamic (speeds, sizes, counts, colors, positions)
2. **Animation parameters** (rotation speed, movement amplitude, oscillation frequency)
3. **Visual properties** (opacity, scale, color hue/saturation, stroke weight)
4. **Behavioral thresholds** (trigger points, transition speeds, sensitivity)

For each parameter, suggest:
- A clear name using p.getParam('name') format
- Reasonable min/max range for the value
- Which biosignal input would map well to it:
  * alpha/theta → calm, meditative visuals (slow changes)
  * beta/gamma → active, energetic visuals (fast changes)
  * hand pinch → trigger events, control intensity
  * hand position → spatial control (x/y/z mapping)
  * face smile/brow → emotional response, mood
  * gaze x/y → directional control, focus point

OUTPUT FORMAT (JSON only, no markdown):
{
  "hasOpportunities": true/false,
  "parameters": [
    {
      "name": "paramName",
      "currentValue": "the hardcoded value found",
      "suggestedMin": 0,
      "suggestedMax": 1,
      "description": "what this controls",
      "recommendedInput": "alpha | beta | handPinch | gazeX | etc",
      "reason": "why this input maps well to this parameter"
    }
  ],
  "improvedCode": "// Code with p.getParam() calls added for all identified parameters"
}

IMPORTANT:
- Ensure at least 3-6 meaningful interactive parameters
- Replace hardcoded values with p.getParam('name') calls
- Provide sensible defaults that match the original behavior
- Focus on parameters that create VISIBLE, MEANINGFUL changes when modulated

Output ONLY valid JSON."""

    def check_interactivity(self, code: str) -> Dict[str, Any]:
        """Identify parameters suitable for biosignal input mapping."""
        if not code:
            return {"status": "error", "message": "No code provided"}

        if not self.is_available():
            return {"status": "error", "message": "AI service not available"}

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": self.INTERACTIVITY_PROMPT},
                    {"role": "user", "content": f"Analyze this p5.js code for interactive parameters:\n\n{code}"}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.4,
                max_tokens=2500,
            )

            response_text = chat_completion.choices[0].message.content.strip()

            json_text = response_text
            if "```" in json_text:
                matches = re.findall(r'```(?:json)?\s*([\s\S]*?)```', json_text)
                if matches:
                    json_text = matches[0].strip()

            try:
                result = json.loads(json_text)
                return {
                    "status": "ok",
                    "hasOpportunities": result.get("hasOpportunities", False),
                    "parameters": result.get("parameters", []),
                    "improvedCode": result.get("improvedCode")
                }
            except json.JSONDecodeError:
                return {"status": "ok", "hasOpportunities": False, "parameters": [], "improvedCode": None}

        except Exception as e:
            return {"status": "error", "message": f"Error checking interactivity: {str(e)}"}

    # ============ SIMPLIFIED ENHANCEMENT (Single LLM call) ============

    ENHANCE_PROMPT = """You are a p5.js expert for HeadWave. Enhance the provided sketch by:
1. Fix any syntax errors or bugs
2. Optimize for 60fps performance (cache arrays, avoid object creation in draw())
3. Add/improve interactive parameters using p.getParam('name') || defaultValue
4. Ensure parameters map well to biosignals (alpha/theta for calm, beta/gamma for active)

OUTPUT FORMAT (JSON only, no markdown):
{
  "enhancedCode": "function(p) { ... }",
  "improvements": ["description of each improvement"],
  "parameters": [
    {"name": "paramName", "min": 0, "max": 1, "default": 0.5, "description": "what it controls"}
  ]
}

Output ONLY valid JSON."""

    def enhance_visual(self, code: str) -> Dict[str, Any]:
        """Optional: Enhance a visual with validation, optimization, and interactivity in a single LLM call."""
        if not code:
            return {"status": "error", "message": "No code provided"}

        if not self.is_available():
            return {"status": "error", "message": "AI service not available"}

        try:
            start_time = time.time()

            chat_completion = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": self.ENHANCE_PROMPT},
                    {"role": "user", "content": f"Enhance this p5.js sketch:\n\n{code}"}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.3,
                max_tokens=3000,
            )

            response_text = chat_completion.choices[0].message.content.strip()

            # Clean up response
            json_text = response_text
            if "```" in json_text:
                matches = re.findall(r'```(?:json)?\s*([\s\S]*?)```', json_text)
                if matches:
                    json_text = matches[0].strip()

            try:
                result = json.loads(json_text)
                duration_ms = int((time.time() - start_time) * 1000)

                return {
                    "status": "ok",
                    "enhancedCode": result.get("enhancedCode"),
                    "improvements": result.get("improvements", []),
                    "parameters": result.get("parameters", []),
                    "duration_ms": duration_ms
                }
            except json.JSONDecodeError:
                return {"status": "error", "message": "Failed to parse enhancement result"}

        except Exception as e:
            return {"status": "error", "message": f"Error enhancing visual: {str(e)}"}
