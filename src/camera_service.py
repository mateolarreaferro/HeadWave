import threading
import time
from typing import Optional, Dict, List, Tuple
import base64

import cv2
import mediapipe as mp
import numpy as np

from .osc_sender import OSCSender


class CameraService:

    def __init__(self):
        self.camera: Optional[cv2.VideoCapture] = None
        self.camera_index = 0
        self.running = False
        self.streaming = False
        self.lock = threading.Lock()
        self.osc = OSCSender()

        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh: Optional[mp.solutions.face_mesh.FaceMesh] = None

        self.mp_hands = mp.solutions.hands
        self.hands: Optional[mp.solutions.hands.Hands] = None

        self.enable_face = True
        self.enable_hands = True
        self.enable_gaze = True

        self.latest_frame: Optional[np.ndarray] = None
        self.latest_features: Dict[str, float] = {}
        self.latest_hand_features: Dict[str, any] = {}
        self.latest_gaze: Dict[str, float] = {}

        self.thread: Optional[threading.Thread] = None

        self.UPPER_LIP_CENTER = 13
        self.LOWER_LIP_CENTER = 14
        self.MOUTH_LEFT = 61
        self.MOUTH_RIGHT = 291
        self.LEFT_EYE_CENTER = 159
        self.RIGHT_EYE_CENTER = 386
        self.LEFT_EYEBROW = 70
        self.NOSE_TIP = 1
        self.LEFT_EYE_OUTER = 33
        self.RIGHT_EYE_OUTER = 263
        self.LEFT_EYE_INNER = 133
        self.RIGHT_EYE_INNER = 362

        self.LEFT_IRIS_CENTER = 468
        self.RIGHT_IRIS_CENTER = 473
        self.LEFT_IRIS_LANDMARKS = [468, 469, 470, 471, 472]
        self.RIGHT_IRIS_LANDMARKS = [473, 474, 475, 476, 477]

        self.WRIST = 0
        self.THUMB_TIP = 4
        self.INDEX_TIP = 8
        self.MIDDLE_TIP = 12
        self.RING_TIP = 16
        self.PINKY_TIP = 20
        self.THUMB_MCP = 2
        self.INDEX_MCP = 5
        self.MIDDLE_MCP = 9
        self.RING_MCP = 13
        self.PINKY_MCP = 17

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

        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.3,
            min_tracking_confidence=0.3
        )

        self.hands = self.mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )

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

        if self.face_mesh:
            self.face_mesh.close()
            self.face_mesh = None

        if self.hands:
            self.hands.close()
            self.hands = None

    def configure_features(self, enable_face: bool = True,
                           enable_hands: bool = True,
                           enable_gaze: bool = True):
        self.enable_face = enable_face
        self.enable_hands = enable_hands
        self.enable_gaze = enable_gaze

    def _distance_2d(self, p1: np.ndarray, p2: np.ndarray) -> float:
        return np.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)

    def _angle_from_points(self, p1: np.ndarray, p2: np.ndarray) -> float:
        return np.degrees(np.arctan2(p2[1] - p1[1], p2[0] - p1[0]))

    def _extract_features(self, image: np.ndarray) -> Dict[str, float]:
        if not self.face_mesh:
            return {}

        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_image)

        if not results.multi_face_landmarks:
            return {}

        landmarks = results.multi_face_landmarks[0].landmark
        h, w = image.shape[:2]

        def get_point(idx: int) -> np.ndarray:
            return np.array([landmarks[idx].x * w, landmarks[idx].y * h])

        upper_lip = get_point(self.UPPER_LIP_CENTER)
        lower_lip = get_point(self.LOWER_LIP_CENTER)
        mouth_left = get_point(self.MOUTH_LEFT)
        mouth_right = get_point(self.MOUTH_RIGHT)

        mouth_height = self._distance_2d(upper_lip, lower_lip)
        mouth_width = self._distance_2d(mouth_left, mouth_right)
        mouth_openness = mouth_height / max(mouth_width, 1.0)

        left_eye = get_point(self.LEFT_EYE_CENTER)
        left_brow = get_point(self.LEFT_EYEBROW)
        right_eye = get_point(self.RIGHT_EYE_CENTER)

        eye_height = abs(left_eye[1] - right_eye[1]) + 20
        brow_displacement = (left_eye[1] - left_brow[1]) / eye_height

        left_eye_outer = get_point(self.LEFT_EYE_OUTER)
        right_eye_outer = get_point(self.RIGHT_EYE_OUTER)
        left_eye_inner = get_point(self.LEFT_EYE_INNER)
        right_eye_inner = get_point(self.RIGHT_EYE_INNER)

        left_eye_width = self._distance_2d(left_eye_outer, left_eye_inner)
        right_eye_width = self._distance_2d(right_eye_outer, right_eye_inner)
        yaw_ratio = (left_eye_width - right_eye_width) / (left_eye_width + right_eye_width)
        head_yaw = yaw_ratio * 0.5

        eye_angle = self._angle_from_points(left_eye_outer, right_eye_outer)
        head_roll = eye_angle
        head_roll_relative = (head_roll + 45.0) / 90.0
        head_roll_relative = max(0.0, min(1.0, head_roll_relative))

        nose_tip = get_point(self.NOSE_TIP)
        mouth_center = (mouth_left + mouth_right) / 2
        mouth_curve = (mouth_center[1] - nose_tip[1]) / max(mouth_width, 1.0)
        smile_curvature = 1.0 / (1.0 + np.exp(-5 * (mouth_curve - 0.3)))

        return {
            'mouth_openness': float(mouth_openness),
            'brow_raise': float(brow_displacement),
            'head_yaw': float(head_yaw),
            'head_roll': float(head_roll),
            'head_roll_relative': float(head_roll_relative),
            'smile_curvature': float(smile_curvature),
        }

    def _extract_gaze(self, image: np.ndarray) -> Dict[str, float]:
        if not self.face_mesh or not self.enable_gaze:
            return {}

        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_image)

        if not results.multi_face_landmarks:
            return {'gaze_x': 0.0, 'gaze_y': 0.0, 'gaze_confidence': 0.0}

        landmarks = results.multi_face_landmarks[0].landmark
        h, w = image.shape[:2]

        def get_point(idx: int) -> np.ndarray:
            return np.array([landmarks[idx].x * w, landmarks[idx].y * h])

        try:
            left_eye_outer = get_point(self.LEFT_EYE_OUTER)
            left_eye_inner = get_point(self.LEFT_EYE_INNER)
            left_iris = get_point(self.LEFT_IRIS_CENTER)

            right_eye_outer = get_point(self.RIGHT_EYE_OUTER)
            right_eye_inner = get_point(self.RIGHT_EYE_INNER)
            right_iris = get_point(self.RIGHT_IRIS_CENTER)

            left_eye_center = (left_eye_outer + left_eye_inner) / 2
            left_eye_width = self._distance_2d(left_eye_outer, left_eye_inner)
            left_gaze_x = (left_iris[0] - left_eye_center[0]) / (left_eye_width / 2 + 0.001)
            left_gaze_y = (left_iris[1] - left_eye_center[1]) / (left_eye_width / 4 + 0.001)

            right_eye_center = (right_eye_outer + right_eye_inner) / 2
            right_eye_width = self._distance_2d(right_eye_outer, right_eye_inner)
            right_gaze_x = (right_iris[0] - right_eye_center[0]) / (right_eye_width / 2 + 0.001)
            right_gaze_y = (right_iris[1] - right_eye_center[1]) / (right_eye_width / 4 + 0.001)

            gaze_x = (left_gaze_x + right_gaze_x) / 2
            gaze_y = (left_gaze_y + right_gaze_y) / 2

            gaze_x = max(-1.0, min(1.0, gaze_x))
            gaze_y = max(-1.0, min(1.0, gaze_y))

            confidence = 1.0 - abs(gaze_x) * 0.3

            return {
                'gaze_x': float(gaze_x),
                'gaze_y': float(gaze_y),
                'gaze_confidence': float(confidence)
            }

        except (IndexError, KeyError):
            return {'gaze_x': 0.0, 'gaze_y': 0.0, 'gaze_confidence': 0.0}

    def _extract_hand_features(self, image: np.ndarray) -> Dict[str, any]:
        if not self.hands or not self.enable_hands:
            return {'left': None, 'right': None}

        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        results = self.hands.process(rgb_image)

        hand_data = {'left': None, 'right': None}

        if not results.multi_hand_landmarks:
            return hand_data

        h, w = image.shape[:2]

        for idx, hand_landmarks in enumerate(results.multi_hand_landmarks):
            handedness = results.multi_handedness[idx].classification[0]
            hand_label = handedness.label.lower()
            confidence = handedness.score

            landmarks = hand_landmarks.landmark

            def get_point(i: int) -> np.ndarray:
                return np.array([
                    landmarks[i].x,
                    landmarks[i].y,
                    landmarks[i].z
                ])

            wrist = get_point(self.WRIST)

            thumb_tip = get_point(self.THUMB_TIP)
            index_tip = get_point(self.INDEX_TIP)
            middle_tip = get_point(self.MIDDLE_TIP)
            ring_tip = get_point(self.RING_TIP)
            pinky_tip = get_point(self.PINKY_TIP)

            thumb_mcp = get_point(self.THUMB_MCP)
            index_mcp = get_point(self.INDEX_MCP)
            middle_mcp = get_point(self.MIDDLE_MCP)
            ring_mcp = get_point(self.RING_MCP)
            pinky_mcp = get_point(self.PINKY_MCP)

            pinch_distance = np.linalg.norm(thumb_tip[:2] - index_tip[:2])

            fingertips = [thumb_tip, index_tip, middle_tip, ring_tip, pinky_tip]
            distances = [np.linalg.norm(tip[:2] - wrist[:2]) for tip in fingertips]
            hand_openness = np.mean(distances)

            def is_finger_extended(tip, mcp, wrist_y) -> bool:
                return tip[1] < mcp[1]

            def is_thumb_extended(tip, mcp) -> bool:
                return abs(tip[0] - wrist[0]) > abs(mcp[0] - wrist[0])

            fingers_extended = {
                'thumb': bool(is_thumb_extended(thumb_tip, thumb_mcp)),
                'index': bool(is_finger_extended(index_tip, index_mcp, wrist[1])),
                'middle': bool(is_finger_extended(middle_tip, middle_mcp, wrist[1])),
                'ring': bool(is_finger_extended(ring_tip, ring_mcp, wrist[1])),
                'pinky': bool(is_finger_extended(pinky_tip, pinky_mcp, wrist[1])),
            }

            extended_count = int(sum(fingers_extended.values()))

            gesture = "none"
            if extended_count == 0:
                gesture = "fist"
            elif extended_count == 5:
                gesture = "open"
            elif fingers_extended['index'] and extended_count == 1:
                gesture = "point"
            elif fingers_extended['index'] and fingers_extended['middle'] and extended_count == 2:
                gesture = "peace"
            elif fingers_extended['thumb'] and extended_count == 1:
                gesture = "thumbs_up"
            elif pinch_distance < 0.05:
                gesture = "pinch"

            hand_data[hand_label] = {
                'present': True,
                'confidence': float(confidence),
                'palm_x': float(wrist[0]),
                'palm_y': float(wrist[1]),
                'palm_z': float(wrist[2]),
                'pinch_distance': float(pinch_distance),
                'hand_openness': float(hand_openness),
                'fingers_extended': int(extended_count),
                'gesture': gesture,
                'finger_states': fingers_extended
            }

        return hand_data

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

            features = {}
            if self.enable_face:
                features = self._extract_features(frame)

            gaze = {}
            if self.enable_gaze:
                gaze = self._extract_gaze(frame)

            hands = {'left': None, 'right': None}
            if self.enable_hands:
                hands = self._extract_hand_features(frame)

            with self.lock:
                self.latest_frame = frame.copy()
                self.latest_features = features
                self.latest_gaze = gaze
                self.latest_hand_features = hands

            if features:
                self.osc_push_features(features)
            if gaze:
                self.osc_push_gaze(gaze)
            if hands:
                self.osc_push_hands(hands)

            time.sleep(1/30)

    def get_latest_frame(self) -> Optional[np.ndarray]:
        with self.lock:
            return self.latest_frame.copy() if self.latest_frame is not None else None

    def get_latest_frame_jpeg(self) -> Optional[bytes]:
        frame = self.get_latest_frame()
        if frame is None:
            return None

        ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ret:
            return None

        return buffer.tobytes()

    def get_latest_frame_base64(self) -> Optional[str]:
        jpeg_bytes = self.get_latest_frame_jpeg()
        if jpeg_bytes is None:
            return None

        return base64.b64encode(jpeg_bytes).decode('utf-8')

    def get_latest_features(self) -> Dict[str, float]:
        with self.lock:
            return self.latest_features.copy()

    def get_latest_gaze(self) -> Dict[str, float]:
        with self.lock:
            return self.latest_gaze.copy()

    def get_latest_hands(self) -> Dict[str, any]:
        with self.lock:
            return self.latest_hand_features.copy()

    def get_all_cv_features(self) -> Dict[str, any]:
        with self.lock:
            return {
                'face': self.latest_features.copy(),
                'gaze': self.latest_gaze.copy(),
                'hands': self.latest_hand_features.copy()
            }

    def configure_osc(self, ip: str, port: int, enabled: bool):
        self.osc.configure(ip, port, enabled, send_raw=False, send_bands=False)

    def osc_push_features(self, features: Dict[str, float]):
        if not self.osc._ensure_client():
            return

        try:
            for feature_name, value in features.items():
                self.osc.client.send_message(f"/cv/{feature_name}", value)
        except Exception as e:
            print(f"Failed to send CV features via OSC: {e}")

    def osc_push_gaze(self, gaze: Dict[str, float]):
        if not self.osc._ensure_client() or not gaze:
            return

        try:
            for key, value in gaze.items():
                self.osc.client.send_message(f"/cv/{key}", value)
        except Exception as e:
            print(f"Failed to send gaze via OSC: {e}")

    def osc_push_hands(self, hands: Dict[str, any]):
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

                gesture_id = {
                    'none': 0, 'fist': 1, 'open': 2, 'point': 3,
                    'peace': 4, 'thumbs_up': 5, 'pinch': 6
                }.get(hand['gesture'], 0)
                self.osc.client.send_message(f"{prefix}/gesture", gesture_id)

        except Exception as e:
            print(f"Failed to send hands via OSC: {e}")
