from typing import Dict, Optional
import numpy as np
import cv2
import mediapipe as mp


class GazeTracker:

    LEFT_EYE_OUTER = 33
    RIGHT_EYE_OUTER = 263
    LEFT_EYE_INNER = 133
    RIGHT_EYE_INNER = 362
    LEFT_IRIS_CENTER = 468
    RIGHT_IRIS_CENTER = 473

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

    def extract(self, image: np.ndarray) -> Dict[str, float]:
        if not self.face_mesh:
            return {'gaze_x': 0.0, 'gaze_y': 0.0, 'gaze_confidence': 0.0}

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

            gaze_x = max(-1.0, min(1.0, (left_gaze_x + right_gaze_x) / 2))
            gaze_y = max(-1.0, min(1.0, (left_gaze_y + right_gaze_y) / 2))
            confidence = 1.0 - abs(gaze_x) * 0.3

            return {
                'gaze_x': float(gaze_x),
                'gaze_y': float(gaze_y),
                'gaze_confidence': float(confidence)
            }

        except (IndexError, KeyError):
            return {'gaze_x': 0.0, 'gaze_y': 0.0, 'gaze_confidence': 0.0}
