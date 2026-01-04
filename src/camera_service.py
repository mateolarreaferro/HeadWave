import threading
import time
from typing import Optional, Dict, Any
import base64

import cv2
import numpy as np

from .osc_sender import OSCSender
from .face_tracker import FaceTracker
from .gaze_tracker import GazeTracker
from .hand_tracker import HandTracker


class CameraService:

    def __init__(self):
        self.camera: Optional[cv2.VideoCapture] = None
        self.camera_index = 0
        self.running = False
        self.streaming = False
        self.lock = threading.Lock()

        self.osc = OSCSender()
        self.face_tracker = FaceTracker()
        self.gaze_tracker = GazeTracker()
        self.hand_tracker = HandTracker()

        self.enable_face = True
        self.enable_hands = True
        self.enable_gaze = True

        self.latest_frame: Optional[np.ndarray] = None
        self.latest_features: Dict[str, float] = {}
        self.latest_gaze: Dict[str, float] = {}
        self.latest_hands: Dict[str, Any] = {}

        self.thread: Optional[threading.Thread] = None

    def start_camera(self, camera_index: int = 0):
        if self.running:
            return

        self.camera_index = camera_index

        backends = [cv2.CAP_AVFOUNDATION, cv2.CAP_ANY]
        for backend in backends:
            self.camera = cv2.VideoCapture(self.camera_index, backend)
            if self.camera.isOpened():
                break
            self.camera.release()

        if not self.camera or not self.camera.isOpened():
            raise RuntimeError(f"Cannot open camera {self.camera_index}")

        self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self.camera.set(cv2.CAP_PROP_FPS, 30)

        self.face_tracker.start()
        self.gaze_tracker.start()
        self.hand_tracker.start()

        self.running = True
        self.streaming = True

        self.thread = threading.Thread(target=self._process_loop, daemon=True)
        self.thread.start()

    def stop_camera(self):
        if not self.running:
            return

        self.running = False
        self.streaming = False

        if self.thread:
            self.thread.join(timeout=2.0)
            self.thread = None

        if self.camera:
            self.camera.release()
            self.camera = None

        self.face_tracker.stop()
        self.gaze_tracker.stop()
        self.hand_tracker.stop()

    def configure_features(self, enable_face: bool = True,
                           enable_hands: bool = True,
                           enable_gaze: bool = True):
        self.enable_face = enable_face
        self.enable_hands = enable_hands
        self.enable_gaze = enable_gaze

    def _process_loop(self):
        while self.running:
            if not self.camera:
                time.sleep(0.1)
                continue

            ret, frame = self.camera.read()
            if not ret:
                time.sleep(0.1)
                continue

            frame = cv2.flip(frame, 1)

            features = self.face_tracker.extract(frame) if self.enable_face else {}
            gaze = self.gaze_tracker.extract(frame) if self.enable_gaze else {}
            hands = self.hand_tracker.extract(frame) if self.enable_hands else {'left': None, 'right': None}

            with self.lock:
                self.latest_frame = frame.copy()
                self.latest_features = features
                self.latest_gaze = gaze
                self.latest_hands = hands

            if features:
                self._osc_push_features(features)
            if gaze:
                self._osc_push_gaze(gaze)
            if hands:
                self._osc_push_hands(hands)

            time.sleep(1/30)

    def get_latest_frame(self) -> Optional[np.ndarray]:
        with self.lock:
            return self.latest_frame.copy() if self.latest_frame is not None else None

    def get_latest_frame_jpeg(self) -> Optional[bytes]:
        frame = self.get_latest_frame()
        if frame is None:
            return None

        ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buffer.tobytes() if ret else None

    def get_latest_frame_base64(self) -> Optional[str]:
        jpeg_bytes = self.get_latest_frame_jpeg()
        return base64.b64encode(jpeg_bytes).decode('utf-8') if jpeg_bytes else None

    def get_latest_features(self) -> Dict[str, float]:
        with self.lock:
            return self.latest_features.copy()

    def get_latest_gaze(self) -> Dict[str, float]:
        with self.lock:
            return self.latest_gaze.copy()

    def get_latest_hands(self) -> Dict[str, Any]:
        with self.lock:
            return self.latest_hands.copy()

    def get_all_cv_features(self) -> Dict[str, Any]:
        with self.lock:
            return {
                'face': self.latest_features.copy(),
                'gaze': self.latest_gaze.copy(),
                'hands': self.latest_hands.copy()
            }

    def configure_osc(self, ip: str, port: int, enabled: bool):
        self.osc.configure(ip, port, enabled, send_raw=False, send_bands=False)

    def _osc_push_features(self, features: Dict[str, float]):
        if not self.osc._ensure_client():
            return
        try:
            for name, value in features.items():
                self.osc.client.send_message(f"/cv/{name}", value)
        except Exception:
            pass

    def _osc_push_gaze(self, gaze: Dict[str, float]):
        if not self.osc._ensure_client() or not gaze:
            return
        try:
            for key, value in gaze.items():
                self.osc.client.send_message(f"/cv/{key}", value)
        except Exception:
            pass

    def _osc_push_hands(self, hands: Dict[str, Any]):
        if not self.osc._ensure_client():
            return
        try:
            for hand_label in ['left', 'right']:
                hand = hands.get(hand_label)
                prefix = f"/cv/hands/{hand_label}"

                if hand is None:
                    self.osc.client.send_message(f"{prefix}/present", 0)
                    continue

                self.osc.client.send_message(f"{prefix}/present", 1)
                self.osc.client.send_message(f"{prefix}/palm_x", hand['palm_x'])
                self.osc.client.send_message(f"{prefix}/palm_y", hand['palm_y'])
                self.osc.client.send_message(f"{prefix}/palm_z", hand['palm_z'])
                self.osc.client.send_message(f"{prefix}/pinch", hand['pinch_distance'])
                self.osc.client.send_message(f"{prefix}/openness", hand['hand_openness'])
                self.osc.client.send_message(f"{prefix}/fingers", hand['fingers_extended'])

                gesture_id = {'none': 0, 'fist': 1, 'open': 2, 'point': 3,
                              'peace': 4, 'thumbs_up': 5, 'pinch': 6}.get(hand['gesture'], 0)
                self.osc.client.send_message(f"{prefix}/gesture", gesture_id)
        except Exception:
            pass
