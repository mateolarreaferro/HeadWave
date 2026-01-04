from typing import Dict, Optional
import numpy as np
import cv2
import mediapipe as mp


class FaceTracker:

    UPPER_LIP_CENTER = 13
    LOWER_LIP_CENTER = 14
    MOUTH_LEFT = 61
    MOUTH_RIGHT = 291
    LEFT_EYE_CENTER = 159
    RIGHT_EYE_CENTER = 386
    LEFT_EYEBROW = 70
    NOSE_TIP = 1
    LEFT_EYE_OUTER = 33
    RIGHT_EYE_OUTER = 263
    LEFT_EYE_INNER = 133
    RIGHT_EYE_INNER = 362

    def __init__(self):
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh: Optional[mp.solutions.face_mesh.FaceMesh] = None

    def start(self):
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.3,
            min_tracking_confidence=0.3
        )

    def stop(self):
        if self.face_mesh:
            self.face_mesh.close()
            self.face_mesh = None

    def _distance_2d(self, p1: np.ndarray, p2: np.ndarray) -> float:
        return np.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)

    def _angle_from_points(self, p1: np.ndarray, p2: np.ndarray) -> float:
        return np.degrees(np.arctan2(p2[1] - p1[1], p2[0] - p1[0]))

    def extract(self, image: np.ndarray) -> Dict[str, float]:
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
