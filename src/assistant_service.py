import os
from typing import Optional, Dict, Any


class AssistantService:

    SYSTEM_PROMPT = """You are an AI assistant for HeadWave, a real-time EEG visualization and biosignal creative platform.

Key Features:
- Real-time EEG streaming from OpenBCI Ganglion (4 channels)
- Multiple visualization modes: Time Series, FFT, Frequency Bands, Camera/FaceSynth
- OSC output for integration with creative applications (Max/MSP, TouchDesigner, Ableton, etc.)
- Computer vision facial feature tracking via MediaPipe

EEG Frequency Bands:
- Delta (0.5-4 Hz): Deep sleep, unconscious processes
- Theta (4-8 Hz): Drowsiness, meditation, creativity
- Alpha (8-13 Hz): Relaxed, calm, eyes closed
- Beta (13-30 Hz): Active thinking, focus, alertness
- Gamma (30-50 Hz): High-level cognition, perception

OSC API:
- Raw timeseries: /headwave/raw/CH1, /headwave/raw/CH2, etc.
- Band powers: /headwave/bands/CH1/delta, /headwave/bands/alpha, etc.
- Relative values (0-1): /headwave/bands/CH1/alpha-relative, etc.
- CV features: /cv/mouth_openness, /cv/head_yaw, /cv/smile_curvature, etc.

You can answer questions about:
- How to use HeadWave
- EEG signal interpretation
- OSC API endpoints and data formats
- Integration with creative coding tools
- Troubleshooting and best practices

Be concise, helpful, and technical when appropriate."""

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
