from typing import Dict, Any, Optional
import numpy as np
import cv2
import mediapipe as mp


class HandTracker:

    WRIST = 0
    THUMB_TIP = 4
    INDEX_TIP = 8
    MIDDLE_TIP = 12
    RING_TIP = 16
    PINKY_TIP = 20
    THUMB_MCP = 2
    INDEX_MCP = 5
    MIDDLE_MCP = 9
    RING_MCP = 13
    PINKY_MCP = 17

    def __init__(self):
        self.mp_hands = mp.solutions.hands
        self.hands: Optional[mp.solutions.hands.Hands] = None

    def start(self):
        self.hands = self.mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )

    def stop(self):
        if self.hands:
            self.hands.close()
            self.hands = None

    def _classify_gesture(self, fingers_extended: Dict[str, bool], pinch_distance: float) -> str:
        extended_count = sum(fingers_extended.values())

        if extended_count == 0:
            return "fist"
        elif extended_count == 5:
            return "open"
        elif fingers_extended['index'] and extended_count == 1:
            return "point"
        elif fingers_extended['index'] and fingers_extended['middle'] and extended_count == 2:
            return "peace"
        elif fingers_extended['thumb'] and extended_count == 1:
            return "thumbs_up"
        elif pinch_distance < 0.05:
            return "pinch"
        return "none"

    def extract(self, image: np.ndarray) -> Dict[str, Any]:
        if not self.hands:
            return {'left': None, 'right': None}

        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        results = self.hands.process(rgb_image)

        hand_data = {'left': None, 'right': None}

        if not results.multi_hand_landmarks:
            return hand_data

        for idx, hand_landmarks in enumerate(results.multi_hand_landmarks):
            handedness = results.multi_handedness[idx].classification[0]
            hand_label = handedness.label.lower()
            confidence = handedness.score

            landmarks = hand_landmarks.landmark

            def get_point(i: int) -> np.ndarray:
                return np.array([landmarks[i].x, landmarks[i].y, landmarks[i].z])

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

            fingers_extended = {
                'thumb': bool(abs(thumb_tip[0] - wrist[0]) > abs(thumb_mcp[0] - wrist[0])),
                'index': bool(index_tip[1] < index_mcp[1]),
                'middle': bool(middle_tip[1] < middle_mcp[1]),
                'ring': bool(ring_tip[1] < ring_mcp[1]),
                'pinky': bool(pinky_tip[1] < pinky_mcp[1]),
            }

            gesture = self._classify_gesture(fingers_extended, pinch_distance)

            hand_data[hand_label] = {
                'present': True,
                'confidence': float(confidence),
                'palm_x': float(wrist[0]),
                'palm_y': float(wrist[1]),
                'palm_z': float(wrist[2]),
                'pinch_distance': float(pinch_distance),
                'hand_openness': float(hand_openness),
                'fingers_extended': int(sum(fingers_extended.values())),
                'gesture': gesture,
                'finger_states': fingers_extended
            }

        return hand_data
