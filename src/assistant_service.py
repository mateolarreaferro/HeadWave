import os
import json
import re
from typing import Optional, Dict, Any, List


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

    P5JS_GENERATION_PROMPT = """You are a p5.js creative coder. Generate a complete p5.js sketch based on the user's description.

REQUIREMENTS:
1. Output ONLY valid JavaScript code for p5.js instance mode
2. Use this exact format: function(p) { ... }
3. Include p.setup and p.draw functions
4. Make the sketch responsive using p.width and p.height
5. Create visually interesting, animated content
6. Use p5.js best practices
7. Use p.getParam('paramName') to access controllable parameters (the system will inject defaults)

OUTPUT FORMAT (NO markdown, just the code):
function(p) {
  // Your variables here

  p.setup = function() {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.HSB, 360, 100, 100, 100);
  };

  p.draw = function() {
    // Use p.getParam('speed') etc. to access modulated parameters
    // Animation code here
  };
}

EXAMPLE for "fractals":
function(p) {
  let angle = 0;
  let maxDepth = 8;

  p.setup = function() {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.HSB, 360, 100, 100, 100);
  };

  p.draw = function() {
    p.background(0, 0, 10);
    p.translate(p.width/2, p.height);

    let speed = p.getParam('speed') || 0.01;
    angle = p.sin(p.frameCount * speed) * 0.5;

    branch(100, maxDepth);
  };

  function branch(len, depth) {
    if (depth <= 0) return;
    let hue = p.getParam('colorHue') || 180;
    p.stroke(p.map(depth, 0, maxDepth, hue, hue + 100) % 360, 80, 90, 80);
    p.strokeWeight(depth * 0.5);
    p.line(0, 0, 0, -len);
    p.translate(0, -len);
    p.push();
    p.rotate(angle);
    branch(len * 0.7, depth - 1);
    p.pop();
    p.push();
    p.rotate(-angle);
    branch(len * 0.7, depth - 1);
    p.pop();
  }
}

Remember: Output ONLY the JavaScript code, no markdown backticks or explanation."""

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

    def generate_visual(self, prompt: str) -> Dict[str, Any]:
        """Generate p5.js code from a natural language description."""
        if not prompt:
            return {"status": "error", "message": "No prompt provided"}

        if not self.is_available():
            return {"status": "error", "message": "AI service not available"}

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": self.P5JS_GENERATION_PROMPT},
                    {"role": "user", "content": f"Create a p5.js sketch for: {prompt}"}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.8,
                max_tokens=2048,
            )

            response_text = chat_completion.choices[0].message.content.strip()

            # Clean up response - remove any markdown code blocks
            code = response_text
            if "```" in code:
                # Extract code from markdown
                matches = re.findall(r'```(?:javascript|js)?\s*([\s\S]*?)```', code)
                if matches:
                    code = matches[0].strip()

            # Validate it looks like a p5.js sketch
            if "function(p)" not in code and "p.setup" not in code:
                return {"status": "error", "message": "Generated code doesn't appear to be valid p5.js"}

            return {"status": "ok", "code": code}

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
