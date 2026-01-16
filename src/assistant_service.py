import os
import json
import re
from typing import Optional, Dict, Any, List
from concurrent.futures import ThreadPoolExecutor, as_completed
import time


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

    P5JS_GENERATION_PROMPT = """You are a p5.js expert for HeadWave, a biosignal visual programming tool. Generate a complete, optimized, interactive p5.js sketch.

INTERACTIVE PARAMETERS:
Include 3-4 parameters using p.getParam('name') for real-time control.
Each p.getParam() call MUST have a sensible default: p.getParam('paramName') || defaultValue

RECOMMENDED PARAMETERS:
- speed: Controls animation speed (0.001 to 0.1)
- intensity: Controls visual intensity/size/amplitude (0.1 to 2.0)
- colorHue: Shifts the color palette (0 to 360)
- complexity: Controls detail level/count (1 to 20)

CODE REQUIREMENTS:
1. Format: function(p) { ... } (p5.js instance mode)
2. Include p.setup and p.draw functions
3. Use p.colorMode(p.HSB, 360, 100, 100, 100) for dynamic colors
4. Make responsive using p.width and p.height
5. Add smooth animations (sin/cos waves, noise, lerp)
6. Performance: cache calculations, avoid creating objects in draw()
7. DO NOT include debug text or parameter value displays - only render visual elements

OUTPUT FORMAT:
First output the JavaScript code, then on a new line output "---PARAMS---" followed by a JSON array of parameters.

function(p) {
  // code here
}
---PARAMS---
[{"name":"speed","min":0.001,"max":0.1,"default":0.02},{"name":"intensity","min":0.1,"max":2,"default":1},...]

EXAMPLE OUTPUT:
function(p) {
  let t = 0;

  p.setup = function() {
    p.createCanvas(400, 400);
    p.colorMode(p.HSB, 360, 100, 100, 100);
    p.noStroke();
  };

  p.draw = function() {
    p.background(0, 0, 10);
    let speed = p.getParam('speed') || 0.02;
    let intensity = p.getParam('intensity') || 1;
    let hue = p.getParam('colorHue') || 200;
    let count = p.floor(p.getParam('complexity') || 8);

    t += speed;
    p.translate(p.width/2, p.height/2);

    for (let i = 0; i < count; i++) {
      let angle = p.TWO_PI * i / count + t;
      let r = 80 + p.sin(t * 2 + i) * 40 * intensity;
      let x = p.cos(angle) * r;
      let y = p.sin(angle) * r;
      let size = 20 + p.sin(t * 3 + i * 0.5) * 15 * intensity;

      p.fill((hue + i * 40) % 360, 80, 90, 80);
      p.ellipse(x, y, size, size);

      // Inner glow
      p.fill((hue + i * 40 + 30) % 360, 60, 100, 40);
      p.ellipse(x, y, size * 0.6, size * 0.6);
    }
  };
}
---PARAMS---
[{"name":"speed","min":0.005,"max":0.1,"default":0.02},{"name":"complexity","min":3,"max":20,"default":8},{"name":"intensity","min":0.3,"max":2,"default":1},{"name":"colorHue","min":0,"max":360,"default":200}]

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
                        previous_code: str = None, previous_prompt: str = None) -> Dict[str, Any]:
        """Generate p5.js code from a natural language description with embedded parameters."""
        if not prompt:
            return {"status": "error", "message": "No prompt provided"}

        if not self.is_available():
            return {"status": "error", "message": "AI service not available"}

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
            # New sketch mode
            user_message = f"Create a p5.js sketch for: {prompt}"

        if background_color and background_color != "#0d1117":
            user_message += f"\n\nIMPORTANT: Use this background color: {background_color}"

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": self.P5JS_GENERATION_PROMPT},
                    {"role": "user", "content": user_message}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.7 if previous_code else 0.8,
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

    # ============ STYLE/BEST PRACTICES AGENT ============

    STYLE_PROMPT = """You are a p5.js code style and best practices expert. Review the code for style issues and improvements.

REVIEW FOR:
1. **Code organization**: setup() and draw() structure, variable declarations at top
2. **Naming conventions**: camelCase for variables, descriptive names
3. **Magic numbers**: Replace hardcoded values with named constants or parameters
4. **Redundant code**: DRY principle, extract repeated patterns
5. **Comments**: Add brief comments for complex logic (but don't over-comment)
6. **p5.js idioms**: Use p5 functions properly (map, constrain, lerp, etc.)
7. **Modularity**: Extract complex logic into helper functions
8. **Color usage**: Consistent color mode, use HSB for dynamic colors

OUTPUT FORMAT (JSON only, no markdown):
{
  "hasIssues": true/false,
  "suggestions": [
    {
      "type": "naming" | "organization" | "magic-number" | "redundancy" | "idiom",
      "description": "what could be improved",
      "priority": "high" | "medium" | "low"
    }
  ],
  "improvedCode": "// The improved code with style fixes"
}

Output ONLY valid JSON."""

    def check_style(self, code: str) -> Dict[str, Any]:
        """Check p5.js code for style and best practices."""
        if not code:
            return {"status": "error", "message": "No code provided"}

        if not self.is_available():
            return {"status": "error", "message": "AI service not available"}

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": self.STYLE_PROMPT},
                    {"role": "user", "content": f"Review this p5.js code for style:\n\n{code}"}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.3,
                max_tokens=2048,
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
                    "hasIssues": result.get("hasIssues", False),
                    "suggestions": result.get("suggestions", []),
                    "improvedCode": result.get("improvedCode")
                }
            except json.JSONDecodeError:
                return {"status": "ok", "hasIssues": False, "suggestions": [], "improvedCode": None}

        except Exception as e:
            return {"status": "error", "message": f"Error checking style: {str(e)}"}

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

    # ============ COORDINATOR AGENT ============

    COORDINATOR_PROMPT = """You are a code coordinator for HeadWave, a biosignal visual programming environment. You receive analysis from FOUR specialized agents and must merge their outputs into a single, optimal result.

INPUT FORMAT:
You will receive JSON with results from:
1. **validator**: Checks for errors and bugs
2. **optimizer**: Improves performance
3. **stylist**: Improves code style and best practices
4. **interactivity**: Identifies parameters for biosignal input mapping (EEG, hand tracking, face tracking)

YOUR TASK:
1. Start with the code that has all errors fixed (validator's fixedCode, or original if valid)
2. Apply performance optimizations that don't conflict with correctness
3. Apply style improvements that don't conflict with performance
4. **CRITICAL**: Apply interactivity improvements - ensure all suggested p.getParam() calls are added
5. If agents disagree, prioritize: correctness > interactivity > performance > style
6. Preserve all functionality - don't remove features

INTERACTIVITY IS KEY:
- The final code MUST use p.getParam('paramName') for all identified interactive parameters
- Ensure 3-6 meaningful parameters are exposed for biosignal control
- Parameters should create visible, meaningful changes when modulated

OUTPUT FORMAT (JSON only, no markdown):
{
  "finalCode": "// The merged, optimal code with all p.getParam() calls",
  "summary": {
    "errorsFixed": 0,
    "optimizationsApplied": 0,
    "styleImprovements": 0,
    "interactiveParams": 0
  },
  "changes": [
    {
      "type": "fix" | "optimization" | "style" | "interactivity",
      "description": "brief description of change"
    }
  ],
  "parameters": [
    {
      "name": "paramName",
      "min": 0,
      "max": 1,
      "default": 0.5,
      "recommendedInput": "alpha | beta | handPinch | etc"
    }
  ]
}

Be decisive and output clean, working, INTERACTIVE code. Output ONLY valid JSON."""

    def _run_agent(self, agent_name: str, code: str) -> Dict[str, Any]:
        """Run a single agent and return its result with timing."""
        start = time.time()

        if agent_name == "validator":
            result = self.validate_code(code)
        elif agent_name == "optimizer":
            result = self.optimize_code(code)
        elif agent_name == "stylist":
            result = self.check_style(code)
        elif agent_name == "interactivity":
            result = self.check_interactivity(code)
        else:
            result = {"status": "error", "message": f"Unknown agent: {agent_name}"}

        result["_agent"] = agent_name
        result["_duration_ms"] = int((time.time() - start) * 1000)
        return result

    def coordinate_results(self, original_code: str, validator_result: Dict,
                           optimizer_result: Dict, style_result: Dict,
                           interactivity_result: Dict = None) -> Dict[str, Any]:
        """Coordinate and merge results from all agents."""
        if not self.is_available():
            return {"status": "error", "message": "AI service not available"}

        interactivity_result = interactivity_result or {}

        # Build context for coordinator
        context = {
            "originalCode": original_code,
            "validator": {
                "valid": validator_result.get("valid", True),
                "issues": validator_result.get("issues", []),
                "fixedCode": validator_result.get("fixedCode")
            },
            "optimizer": {
                "optimized": optimizer_result.get("optimized", False),
                "improvements": optimizer_result.get("improvements", []),
                "optimizedCode": optimizer_result.get("optimizedCode"),
                "speedup": optimizer_result.get("estimatedSpeedup", "")
            },
            "stylist": {
                "hasIssues": style_result.get("hasIssues", False),
                "suggestions": style_result.get("suggestions", []),
                "improvedCode": style_result.get("improvedCode")
            },
            "interactivity": {
                "hasOpportunities": interactivity_result.get("hasOpportunities", False),
                "parameters": interactivity_result.get("parameters", []),
                "improvedCode": interactivity_result.get("improvedCode")
            }
        }

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": self.COORDINATOR_PROMPT},
                    {"role": "user", "content": f"Merge these agent results:\n\n{json.dumps(context, indent=2)}"}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.2,
                max_tokens=4000,
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
                    "finalCode": result.get("finalCode"),
                    "summary": result.get("summary", {}),
                    "changes": result.get("changes", []),
                    "parameters": result.get("parameters", [])
                }
            except json.JSONDecodeError:
                # Fallback: return best available code (prefer interactivity code)
                if interactivity_result.get("improvedCode"):
                    return {"status": "ok", "finalCode": interactivity_result["improvedCode"],
                            "summary": {"interactiveParams": len(interactivity_result.get("parameters", []))},
                            "changes": [], "parameters": interactivity_result.get("parameters", [])}
                if validator_result.get("fixedCode"):
                    return {"status": "ok", "finalCode": validator_result["fixedCode"],
                            "summary": {"errorsFixed": len(validator_result.get("issues", []))},
                            "changes": [], "parameters": []}
                return {"status": "ok", "finalCode": original_code, "summary": {}, "changes": [], "parameters": []}

        except Exception as e:
            return {"status": "error", "message": f"Error coordinating results: {str(e)}"}

    def analyze_code_parallel(self, code: str) -> Dict[str, Any]:
        """Run all analysis agents in parallel and coordinate results."""
        if not code:
            return {"status": "error", "message": "No code provided"}

        if not self.is_available():
            return {"status": "error", "message": "AI service not available"}

        start_time = time.time()
        agents = ["validator", "optimizer", "stylist", "interactivity"]
        results = {}

        # Run all 4 agents in parallel using ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {executor.submit(self._run_agent, agent, code): agent for agent in agents}

            for future in as_completed(futures):
                agent_name = futures[future]
                try:
                    results[agent_name] = future.result()
                except Exception as e:
                    results[agent_name] = {"status": "error", "message": str(e)}

        parallel_time = int((time.time() - start_time) * 1000)

        # Coordinate results from all 4 agents
        coord_start = time.time()
        coordinated = self.coordinate_results(
            code,
            results.get("validator", {}),
            results.get("optimizer", {}),
            results.get("stylist", {}),
            results.get("interactivity", {})
        )
        coord_time = int((time.time() - coord_start) * 1000)

        total_time = int((time.time() - start_time) * 1000)

        return {
            "status": coordinated.get("status", "ok"),
            "finalCode": coordinated.get("finalCode"),
            "summary": coordinated.get("summary", {}),
            "changes": coordinated.get("changes", []),
            "parameters": coordinated.get("parameters", []),
            "agentResults": {
                "validator": {
                    "valid": results.get("validator", {}).get("valid", True),
                    "issueCount": len(results.get("validator", {}).get("issues", [])),
                    "duration_ms": results.get("validator", {}).get("_duration_ms", 0)
                },
                "optimizer": {
                    "optimized": results.get("optimizer", {}).get("optimized", False),
                    "improvementCount": len(results.get("optimizer", {}).get("improvements", [])),
                    "speedup": results.get("optimizer", {}).get("estimatedSpeedup", ""),
                    "duration_ms": results.get("optimizer", {}).get("_duration_ms", 0)
                },
                "stylist": {
                    "hasIssues": results.get("stylist", {}).get("hasIssues", False),
                    "suggestionCount": len(results.get("stylist", {}).get("suggestions", [])),
                    "duration_ms": results.get("stylist", {}).get("_duration_ms", 0)
                },
                "interactivity": {
                    "hasOpportunities": results.get("interactivity", {}).get("hasOpportunities", False),
                    "paramCount": len(results.get("interactivity", {}).get("parameters", [])),
                    "duration_ms": results.get("interactivity", {}).get("_duration_ms", 0)
                }
            },
            "timing": {
                "parallel_ms": parallel_time,
                "coordinator_ms": coord_time,
                "total_ms": total_time
            }
        }
