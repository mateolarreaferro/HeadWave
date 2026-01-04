import threading
from typing import Dict, List, Optional, Any
from collections import deque

try:
    import mido
    MIDI_AVAILABLE = True
except ImportError:
    MIDI_AVAILABLE = False
    print("[MIDI] mido not installed. Run: pip install mido python-rtmidi")


class MIDISender:

    def __init__(self):
        self.enabled = False
        self.port: Optional[Any] = None
        self.port_name: Optional[str] = None

        self.band_cc_map = {
            'delta': 20,
            'theta': 21,
            'alpha': 22,
            'beta': 23,
            'gamma': 24,
        }

        self.cv_cc_map = {
            'mouth_openness': 30,
            'brow_raise': 31,
            'head_yaw': 32,
            'head_roll': 33,
            'smile_curvature': 34,
            'gaze_x': 35,
            'gaze_y': 36,
            'heart_rate': 37,
        }

        self.derived_cc_map = {
            'engagement': 40,
            'signal_quality': 41,
        }

        self.gesture_notes = {
            'fist': 60,
            'open': 62,
            'point': 64,
            'peace': 65,
            'thumbs_up': 67,
            'pinch': 69,
        }

        self.cc_history: Dict[int, deque] = {}
        self.smoothing_samples = 3

        self.lock = threading.Lock()

    @staticmethod
    def list_ports() -> List[str]:
        if not MIDI_AVAILABLE:
            return []
        try:
            return mido.get_output_names()
        except Exception as e:
            print(f"[MIDI] Error listing ports: {e}")
            return []

    @staticmethod
    def find_iac_port() -> Optional[str]:
        ports = MIDISender.list_ports()
        for port in ports:
            if 'IAC' in port:
                return port
        return None

    def connect(self, port_name: Optional[str] = None) -> bool:
        if not MIDI_AVAILABLE:
            print("[MIDI] mido not available")
            return False

        with self.lock:
            if port_name is None:
                port_name = self.find_iac_port()
                if port_name is None:
                    print("[MIDI] No IAC Driver found. Enable it in Audio MIDI Setup.")
                    return False

            try:
                self.port = mido.open_output(port_name)
                self.port_name = port_name
                self.enabled = True
                print(f"[MIDI] Connected to {port_name}")
                return True
            except Exception as e:
                print(f"[MIDI] Failed to connect to {port_name}: {e}")
                return False

    def disconnect(self):
        with self.lock:
            if self.port:
                try:
                    self.port.close()
                except Exception:
                    pass
                self.port = None
            self.enabled = False
            self.port_name = None
            print("[MIDI] Disconnected")

    def is_connected(self) -> bool:
        return self.enabled and self.port is not None

    def configure_mapping(self, band_map: Optional[Dict[str, int]] = None,
                          cv_map: Optional[Dict[str, int]] = None,
                          derived_map: Optional[Dict[str, int]] = None):
        with self.lock:
            if band_map:
                self.band_cc_map.update(band_map)
            if cv_map:
                self.cv_cc_map.update(cv_map)
            if derived_map:
                self.derived_cc_map.update(derived_map)

    def get_mapping(self) -> Dict[str, Dict[str, int]]:
        return {
            'bands': self.band_cc_map.copy(),
            'cv': self.cv_cc_map.copy(),
            'derived': self.derived_cc_map.copy()
        }

    def _smooth_cc(self, cc: int, value: int) -> int:
        if cc not in self.cc_history:
            self.cc_history[cc] = deque(maxlen=self.smoothing_samples)

        self.cc_history[cc].append(value)
        return int(sum(self.cc_history[cc]) / len(self.cc_history[cc]))

    def _send_cc(self, control: int, value: int, channel: int = 0):
        if not self.enabled or not self.port:
            return

        value = max(0, min(127, value))

        value = self._smooth_cc(control, value)

        try:
            msg = mido.Message('control_change', channel=channel,
                               control=control, value=value)
            self.port.send(msg)
        except Exception as e:
            print(f"[MIDI] Error sending CC: {e}")

    def _send_note(self, note: int, velocity: int = 100, channel: int = 0):
        if not self.enabled or not self.port:
            return

        try:
            msg = mido.Message('note_on', channel=channel,
                               note=note, velocity=velocity)
            self.port.send(msg)
        except Exception as e:
            print(f"[MIDI] Error sending note: {e}")

    def _send_note_off(self, note: int, channel: int = 0):
        if not self.enabled or not self.port:
            return

        try:
            msg = mido.Message('note_off', channel=channel, note=note, velocity=0)
            self.port.send(msg)
        except Exception as e:
            print(f"[MIDI] Error sending note off: {e}")

    def send_bands(self, band_names: List[str], values: List[float]):
        if not self.enabled:
            return

        with self.lock:
            for i, band in enumerate(band_names):
                if band in self.band_cc_map and i < len(values):
                    cc = self.band_cc_map[band]
                    midi_val = int(values[i] * 127 / 100)
                    self._send_cc(cc, midi_val)

    def send_cv_features(self, features: Dict[str, float]):
        if not self.enabled:
            return

        with self.lock:
            for feature, value in features.items():
                if feature in self.cv_cc_map:
                    cc = self.cv_cc_map[feature]
                    midi_val = int(value * 127)
                    self._send_cc(cc, midi_val)

    def send_engagement(self, value: float):
        if not self.enabled:
            return

        cc = self.derived_cc_map.get('engagement', 40)
        midi_val = int(min(value / 5.0, 1.0) * 127)
        self._send_cc(cc, midi_val)

    def send_heart_rate(self, bpm: float):
        if not self.enabled:
            return

        cc = self.cv_cc_map.get('heart_rate', 37)
        normalized = (bpm - 40) / 160
        midi_val = int(max(0, min(1, normalized)) * 127)
        self._send_cc(cc, midi_val)

    def send_gesture(self, gesture: str, hand: str = 'right'):
        if not self.enabled or gesture == 'none':
            return

        note = self.gesture_notes.get(gesture)
        if note:
            if hand == 'left':
                note += 12
            self._send_note(note, velocity=100)

    def send_pitch_bend(self, value: float, channel: int = 0):
        if not self.enabled or not self.port:
            return

        pitch = int((value + 1) / 2 * 16383)
        pitch = max(0, min(16383, pitch))

        try:
            msg = mido.Message('pitchwheel', channel=channel, pitch=pitch - 8192)
            self.port.send(msg)
        except Exception as e:
            print(f"[MIDI] Error sending pitch bend: {e}")

    def all_notes_off(self, channel: int = 0):
        if not self.enabled or not self.port:
            return

        try:
            msg = mido.Message('control_change', channel=channel,
                               control=123, value=0)
            self.port.send(msg)
        except Exception as e:
            print(f"[MIDI] Error sending all notes off: {e}")
