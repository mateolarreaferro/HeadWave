import threading
import time
from typing import Optional, Dict, Tuple, List
from collections import deque

import cv2
import mediapipe as mp
import numpy as np
from scipy import signal as scipy_signal


class PPGExtractor:

    def __init__(self, sampling_rate: float = 30.0, buffer_seconds: float = 10.0):
        self.sampling_rate = sampling_rate
        self.buffer_size = int(sampling_rate * buffer_seconds)

        self.green_signal = deque(maxlen=self.buffer_size)
        self.timestamps = deque(maxlen=self.buffer_size)

        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh: Optional[mp.solutions.face_mesh.FaceMesh] = None

        self.running = False
        self.lock = threading.Lock()

        self.latest_hr: float = 0.0
        self.latest_hrv: float = 0.0
        self.latest_quality: float = 0.0

        self.hr_history = deque(maxlen=5)

        self.FOREHEAD_LANDMARKS = [10, 67, 69, 104, 108, 109, 151, 299, 297, 333, 337, 338]

    def start(self):
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.running = True
        self.green_signal.clear()
        self.timestamps.clear()

    def stop(self):
        self.running = False
        if self.face_mesh:
            self.face_mesh.close()
            self.face_mesh = None

    def process_frame(self, frame: np.ndarray) -> Dict[str, float]:
        if not self.running or self.face_mesh is None:
            return {'heart_rate': 0.0, 'hrv': 0.0, 'quality': 0.0}

        current_time = time.time()

        roi_value = self._extract_roi_signal(frame)

        if roi_value is not None:
            with self.lock:
                self.green_signal.append(roi_value)
                self.timestamps.append(current_time)

        result = self._compute_heart_rate()

        with self.lock:
            self.latest_hr = result['heart_rate']
            self.latest_hrv = result['hrv']
            self.latest_quality = result['quality']

        return result

    def _extract_roi_signal(self, frame: np.ndarray) -> Optional[float]:
        if frame is None or self.face_mesh is None:
            return None

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_frame)

        if not results.multi_face_landmarks:
            return None

        h, w = frame.shape[:2]
        landmarks = results.multi_face_landmarks[0].landmark

        forehead_points = []
        for idx in self.FOREHEAD_LANDMARKS:
            x = int(landmarks[idx].x * w)
            y = int(landmarks[idx].y * h)
            forehead_points.append((x, y))

        if len(forehead_points) < 3:
            return None

        points = np.array(forehead_points, dtype=np.int32)
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillConvexPoly(mask, points, 255)

        green_channel = frame[:, :, 1]
        roi_pixels = green_channel[mask == 255]

        if len(roi_pixels) < 100:
            return None

        return float(np.median(roi_pixels))

    def _compute_heart_rate(self) -> Dict[str, float]:
        with self.lock:
            if len(self.green_signal) < self.sampling_rate * 3:
                return {'heart_rate': 0.0, 'hrv': 0.0, 'quality': 0.0}

            signal_array = np.array(self.green_signal)
            time_array = np.array(self.timestamps)

        if len(time_array) > 1:
            actual_dt = np.median(np.diff(time_array))
            actual_fs = 1.0 / actual_dt if actual_dt > 0 else self.sampling_rate
        else:
            actual_fs = self.sampling_rate

        signal_detrended = scipy_signal.detrend(signal_array)

        nyquist = actual_fs / 2
        low = 0.7 / nyquist
        high = min(4.0 / nyquist, 0.99)

        if low >= high or low <= 0:
            return {'heart_rate': 0.0, 'hrv': 0.0, 'quality': 0.0}

        try:
            b, a = scipy_signal.butter(2, [low, high], btype='band')
            filtered_signal = scipy_signal.filtfilt(b, a, signal_detrended)
        except Exception:
            return {'heart_rate': 0.0, 'hrv': 0.0, 'quality': 0.0}

        n_samples = len(filtered_signal)
        fft_result = np.fft.rfft(filtered_signal)
        fft_freq = np.fft.rfftfreq(n_samples, 1.0 / actual_fs)
        fft_magnitude = np.abs(fft_result)

        valid_mask = (fft_freq >= 0.7) & (fft_freq <= 3.5)
        valid_freqs = fft_freq[valid_mask]
        valid_magnitudes = fft_magnitude[valid_mask]

        if len(valid_magnitudes) == 0:
            return {'heart_rate': 0.0, 'hrv': 0.0, 'quality': 0.0}

        peak_idx = np.argmax(valid_magnitudes)
        peak_freq = valid_freqs[peak_idx]
        heart_rate = peak_freq * 60.0

        peak_power = valid_magnitudes[peak_idx] ** 2
        total_power = np.sum(valid_magnitudes ** 2)
        quality = peak_power / (total_power + 1e-10)
        quality = min(1.0, quality * 5)

        self.hr_history.append(heart_rate)
        smoothed_hr = float(np.median(list(self.hr_history)))

        hrv = self._estimate_hrv(filtered_signal, actual_fs)

        return {
            'heart_rate': smoothed_hr,
            'hrv': hrv,
            'quality': quality
        }

    def _estimate_hrv(self, signal: np.ndarray, fs: float) -> float:
        try:
            min_distance = int(fs * 0.3)
            peaks, _ = scipy_signal.find_peaks(signal, distance=min_distance)

            if len(peaks) < 3:
                return 0.0

            rr_intervals = np.diff(peaks) / fs * 1000

            valid_rr = rr_intervals[(rr_intervals > 300) & (rr_intervals < 2000)]

            if len(valid_rr) < 2:
                return 0.0

            sdnn = float(np.std(valid_rr))

            return sdnn

        except Exception:
            return 0.0

    def get_latest(self) -> Dict[str, float]:
        with self.lock:
            return {
                'heart_rate': self.latest_hr,
                'hrv': self.latest_hrv,
                'quality': self.latest_quality
            }

    def get_signal_buffer(self) -> Tuple[List[float], List[float]]:
        with self.lock:
            return list(self.green_signal), list(self.timestamps)
