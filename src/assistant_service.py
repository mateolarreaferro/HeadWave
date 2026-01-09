import os
from typing import Optional, Dict, Any


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

Visualization:
- fftViz: params {channel, windowSec, colorScheme}
- timeSeriesViz: params {channel, windowSec, scale}
- bandsViz: outputs delta/theta/alpha/beta/gamma, params {displayMode}

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
