# ppg_service.py
"""
Remote Photoplethysmography (rPPG) Service for HeadWave
Extracts heart rate from webcam video using green channel analysis
"""
import threading
import time
from typing import Optional, Dict, Tuple, List
from collections import deque

import cv2
import mediapipe as mp
import numpy as np
from scipy import signal as scipy_signal


class PPGExtractor:
    """
    Extracts heart rate and HRV from webcam video using remote PPG.
    Uses green channel analysis from the forehead/cheek region.
    """

    def __init__(self, sampling_rate: float = 30.0, buffer_seconds: float = 10.0):
        """
        Args:
            sampling_rate: Expected camera FPS
            buffer_seconds: How many seconds of data to buffer
        """
        self.sampling_rate = sampling_rate
        self.buffer_size = int(sampling_rate * buffer_seconds)

        # Signal buffers
        self.green_signal = deque(maxlen=self.buffer_size)
        self.timestamps = deque(maxlen=self.buffer_size)

        # MediaPipe for face detection (ROI)
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh: Optional[mp.solutions.face_mesh.FaceMesh] = None

        # Running state
        self.running = False
        self.lock = threading.Lock()

        # Latest results
        self.latest_hr: float = 0.0
        self.latest_hrv: float = 0.0
        self.latest_quality: float = 0.0

        # Smoothing
        self.hr_history = deque(maxlen=5)

        # Forehead region landmarks
        self.FOREHEAD_LANDMARKS = [10, 67, 69, 104, 108, 109, 151, 299, 297, 333, 337, 338]

    def start(self):
        """Initialize the PPG extractor"""
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
        """Stop and cleanup"""
        self.running = False
        if self.face_mesh:
            self.face_mesh.close()
            self.face_mesh = None

    def process_frame(self, frame: np.ndarray) -> Dict[str, float]:
        """
        Process a single frame and extract PPG signal.
        Call this for each camera frame.

        Returns dict with heart_rate, hrv, quality
        """
        if not self.running or self.face_mesh is None:
            return {'heart_rate': 0.0, 'hrv': 0.0, 'quality': 0.0}

        current_time = time.time()

        # Get face ROI
        roi_value = self._extract_roi_signal(frame)

        if roi_value is not None:
            with self.lock:
                self.green_signal.append(roi_value)
                self.timestamps.append(current_time)

        # Compute heart rate if we have enough data
        result = self._compute_heart_rate()

        with self.lock:
            self.latest_hr = result['heart_rate']
            self.latest_hrv = result['hrv']
            self.latest_quality = result['quality']

        return result

    def _extract_roi_signal(self, frame: np.ndarray) -> Optional[float]:
        """
        Extract green channel mean from forehead region.
        """
        if frame is None or self.face_mesh is None:
            return None

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_frame)

        if not results.multi_face_landmarks:
            return None

        h, w = frame.shape[:2]
        landmarks = results.multi_face_landmarks[0].landmark

        # Get forehead region points
        forehead_points = []
        for idx in self.FOREHEAD_LANDMARKS:
            x = int(landmarks[idx].x * w)
            y = int(landmarks[idx].y * h)
            forehead_points.append((x, y))

        if len(forehead_points) < 3:
            return None

        # Create mask for forehead region
        points = np.array(forehead_points, dtype=np.int32)
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillConvexPoly(mask, points, 255)

        # Extract green channel mean from ROI
        green_channel = frame[:, :, 1]  # BGR format, G is index 1
        roi_pixels = green_channel[mask == 255]

        if len(roi_pixels) < 100:
            return None

        # Use median to reduce noise
        return float(np.median(roi_pixels))

    def _compute_heart_rate(self) -> Dict[str, float]:
        """
        Compute heart rate from buffered PPG signal using FFT.
        """
        with self.lock:
            if len(self.green_signal) < self.sampling_rate * 3:  # Need at least 3 seconds
                return {'heart_rate': 0.0, 'hrv': 0.0, 'quality': 0.0}

            signal_array = np.array(self.green_signal)
            time_array = np.array(self.timestamps)

        # Calculate actual sampling rate from timestamps
        if len(time_array) > 1:
            actual_dt = np.median(np.diff(time_array))
            actual_fs = 1.0 / actual_dt if actual_dt > 0 else self.sampling_rate
        else:
            actual_fs = self.sampling_rate

        # Detrend the signal
        signal_detrended = scipy_signal.detrend(signal_array)

        # Bandpass filter (0.7 Hz to 4 Hz = 42-240 BPM)
        nyquist = actual_fs / 2
        low = 0.7 / nyquist
        high = min(4.0 / nyquist, 0.99)  # Ensure high < 1

        if low >= high or low <= 0:
            return {'heart_rate': 0.0, 'hrv': 0.0, 'quality': 0.0}

        try:
            b, a = scipy_signal.butter(2, [low, high], btype='band')
            filtered_signal = scipy_signal.filtfilt(b, a, signal_detrended)
        except Exception:
            return {'heart_rate': 0.0, 'hrv': 0.0, 'quality': 0.0}

        # FFT for frequency analysis
        n_samples = len(filtered_signal)
        fft_result = np.fft.rfft(filtered_signal)
        fft_freq = np.fft.rfftfreq(n_samples, 1.0 / actual_fs)
        fft_magnitude = np.abs(fft_result)

        # Find peak in valid heart rate range (0.7-3.5 Hz = 42-210 BPM)
        valid_mask = (fft_freq >= 0.7) & (fft_freq <= 3.5)
        valid_freqs = fft_freq[valid_mask]
        valid_magnitudes = fft_magnitude[valid_mask]

        if len(valid_magnitudes) == 0:
            return {'heart_rate': 0.0, 'hrv': 0.0, 'quality': 0.0}

        # Find dominant frequency
        peak_idx = np.argmax(valid_magnitudes)
        peak_freq = valid_freqs[peak_idx]
        heart_rate = peak_freq * 60.0  # Convert Hz to BPM

        # Calculate signal quality (SNR-based)
        peak_power = valid_magnitudes[peak_idx] ** 2
        total_power = np.sum(valid_magnitudes ** 2)
        quality = peak_power / (total_power + 1e-10)
        quality = min(1.0, quality * 5)  # Scale to 0-1

        # Apply smoothing to heart rate
        self.hr_history.append(heart_rate)
        smoothed_hr = float(np.median(list(self.hr_history)))

        # Simple HRV estimation (standard deviation of RR intervals)
        # In real implementation, would use peak detection for RR intervals
        hrv = self._estimate_hrv(filtered_signal, actual_fs)

        return {
            'heart_rate': smoothed_hr,
            'hrv': hrv,
            'quality': quality
        }

    def _estimate_hrv(self, signal: np.ndarray, fs: float) -> float:
        """
        Estimate HRV using SDNN (standard deviation of NN intervals).
        Uses simple peak detection.
        """
        try:
            # Find peaks (heartbeats)
            min_distance = int(fs * 0.3)  # Minimum 0.3s between beats (200 BPM max)
            peaks, _ = scipy_signal.find_peaks(signal, distance=min_distance)

            if len(peaks) < 3:
                return 0.0

            # Calculate RR intervals (in milliseconds)
            rr_intervals = np.diff(peaks) / fs * 1000

            # Filter unrealistic intervals (< 300ms or > 2000ms)
            valid_rr = rr_intervals[(rr_intervals > 300) & (rr_intervals < 2000)]

            if len(valid_rr) < 2:
                return 0.0

            # SDNN: standard deviation of NN intervals
            sdnn = float(np.std(valid_rr))

            return sdnn

        except Exception:
            return 0.0

    def get_latest(self) -> Dict[str, float]:
        """Get latest PPG results"""
        with self.lock:
            return {
                'heart_rate': self.latest_hr,
                'hrv': self.latest_hrv,
                'quality': self.latest_quality
            }

    def get_signal_buffer(self) -> Tuple[List[float], List[float]]:
        """Get the raw PPG signal buffer for visualization"""
        with self.lock:
            return list(self.green_signal), list(self.timestamps)
