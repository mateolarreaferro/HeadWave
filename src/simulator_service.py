import threading
import time
from typing import List, Dict
from collections import deque

import numpy as np

from .signal_processing import SmoothingBuffer
from .band_analyzer import DEFAULT_BANDS, compute_engagement, to_relative


class SimulatorService:

    DELTA = (0.5, 4.0)
    THETA = (4.0, 8.0)
    ALPHA = (8.0, 13.0)
    BETA = (13.0, 30.0)
    GAMMA = (30.0, 50.0)

    MODES = {
        "meditation": (10.0, 30.0, 40.0, 5.0, 2.0),
        "focused": (3.0, 5.0, 10.0, 35.0, 8.0),
        "drowsy": (40.0, 25.0, 15.0, 5.0, 2.0),
        "normal": (8.0, 10.0, 20.0, 15.0, 5.0),
    }

    def __init__(self, sampling_rate: int = 200, num_channels: int = 4):
        self.sampling_rate = sampling_rate
        self.num_channels = num_channels
        self.connected = False
        self.streaming = False

        self.buffer = deque(maxlen=50000)
        self.lock = threading.Lock()

        self.thread = None
        self.running = False
        self.time_elapsed = 0.0
        self.mode = "normal"

        self.smoothing_alpha = 0.3
        self.smoothing_enabled = True
        self.band_smoothers: Dict[str, SmoothingBuffer] = {}
        self.engagement_smoother = SmoothingBuffer(alpha=0.2, num_values=4)

    def configure_smoothing(self, enabled: bool, alpha: float = 0.3):
        self.smoothing_enabled = enabled
        self.smoothing_alpha = max(0.05, min(1.0, alpha))
        for smoother in self.band_smoothers.values():
            smoother.enabled = enabled
            smoother.alpha = self.smoothing_alpha
        self.engagement_smoother.enabled = enabled
        self.engagement_smoother.alpha = self.smoothing_alpha

    def configure_artifact_detection(self, enabled: bool, **kwargs):
        pass

    def connect(self):
        self.connected = True

    def disconnect(self):
        self.stop_stream()
        self.connected = False

    def start_stream(self, buffer_size: int = 45000):
        if not self.connected:
            raise RuntimeError("Simulator not connected")
        if self.streaming:
            return

        self.streaming = True
        self.running = True
        self.time_elapsed = 0.0

        self.thread = threading.Thread(target=self._generate_loop, daemon=True)
        self.thread.start()

    def stop_stream(self):
        if not self.streaming:
            return

        self.running = False
        self.streaming = False

        if self.thread:
            self.thread.join(timeout=2.0)
            self.thread = None

    def set_mode(self, mode: str):
        if mode in self.MODES:
            self.mode = mode

    def _generate_sample(self, t: float, channel: int) -> float:
        delta_amp, theta_amp, alpha_amp, beta_amp, gamma_amp = self.MODES.get(self.mode, self.MODES["normal"])
        factor = 1.0 + 0.1 * channel

        signal = (
            delta_amp * factor * np.sin(2 * np.pi * np.random.uniform(*self.DELTA) * t) +
            theta_amp * factor * np.sin(2 * np.pi * np.random.uniform(*self.THETA) * t) +
            alpha_amp * factor * np.sin(2 * np.pi * np.random.uniform(*self.ALPHA) * t) +
            beta_amp * factor * np.sin(2 * np.pi * np.random.uniform(*self.BETA) * t) +
            gamma_amp * factor * np.sin(2 * np.pi * np.random.uniform(*self.GAMMA) * t) +
            np.random.normal(0, 2.0) +
            5.0 * np.sin(2 * np.pi * 0.1 * t)
        )
        return signal

    def _generate_loop(self):
        dt = 1.0 / self.sampling_rate

        while self.running:
            samples = [self._generate_sample(self.time_elapsed, ch) for ch in range(self.num_channels)]

            with self.lock:
                self.buffer.append([self.time_elapsed] + samples)

            self.time_elapsed += dt
            time.sleep(dt)

    def _get_data(self, num_samples: int) -> np.ndarray:
        with self.lock:
            if len(self.buffer) == 0:
                return np.array([]).reshape(self.num_channels + 1, 0)
            n = min(num_samples, len(self.buffer))
            return np.array(list(self.buffer)[-n:]).T

    def get_timeseries_window(self, window_sec: float = 4.0, max_points: int = 512):
        if not (self.connected and self.streaming):
            return [], []

        data = self._get_data(int(window_sec * self.sampling_rate))
        if data.shape[1] == 0:
            return [], []

        ts_data = []
        for ch_idx in range(self.num_channels):
            series = data[ch_idx + 1, :]
            if series.size > max_points:
                series = series[::int(np.floor(series.size / max_points))]
            ts_data.append(series.tolist())

        return [f"CH{i+1}" for i in range(self.num_channels)], ts_data

    def get_fft_spectrum(self, window_sec: float = 4.0, min_freq: float = 0.5, max_freq: float = 40.0):
        if not (self.connected and self.streaming):
            return [], [], []

        data = self._get_data(int(window_sec * self.sampling_rate))
        if data.shape[1] == 0:
            return [], [], []

        all_psd = []
        freq_list = []

        for ch_idx in range(self.num_channels):
            sig = data[ch_idx + 1, :]
            if sig.size < 32:
                all_psd.append([])
                continue

            fft_result = np.fft.rfft(sig)
            psd = np.abs(fft_result) ** 2 / len(sig)
            freqs = np.fft.rfftfreq(len(sig), 1.0 / self.sampling_rate)

            mask = (freqs >= min_freq) & (freqs <= max_freq)
            if ch_idx == 0:
                freq_list = freqs[mask].tolist()

            all_psd.append((10 * np.log10(psd[mask] + 1e-10)).tolist())

        return [f"CH{i+1}" for i in range(self.num_channels)], freq_list, all_psd

    def get_band_powers(self, window_sec: float = 4.0, bands=None,
                        use_relative: bool = True, apply_smoothing: bool = True):
        if bands is None:
            bands = DEFAULT_BANDS

        if not (self.connected and self.streaming):
            return [], [b[0] for b in bands], []

        data = self._get_data(int(window_sec * self.sampling_rate))
        if data.shape[1] == 0:
            return [], [b[0] for b in bands], []

        all_band_vals = []

        for ch_idx in range(self.num_channels):
            ch_name = f"CH{ch_idx+1}"
            sig = data[ch_idx + 1, :]

            if sig.size < 32:
                all_band_vals.append([0.0] * len(bands))
                continue

            fft_result = np.fft.rfft(sig)
            psd = np.abs(fft_result) ** 2 / len(sig)
            freqs = np.fft.rfftfreq(len(sig), 1.0 / self.sampling_rate)

            ch_vals = [float(np.sum(psd[(freqs >= fmin) & (freqs < fmax)]))
                      for _, fmin, fmax in bands]

            if use_relative:
                ch_vals = to_relative(ch_vals)

            if apply_smoothing and self.smoothing_enabled:
                if ch_name not in self.band_smoothers:
                    self.band_smoothers[ch_name] = SmoothingBuffer(
                        alpha=self.smoothing_alpha, num_values=len(bands)
                    )
                ch_vals = self.band_smoothers[ch_name].update(ch_vals)

            all_band_vals.append(ch_vals)

        return [f"CH{i+1}" for i in range(self.num_channels)], [b[0] for b in bands], all_band_vals

    def get_engagement_index(self, window_sec: float = 4.0):
        if not (self.connected and self.streaming):
            return [], [], 0.0

        channels, _, values = self.get_band_powers(
            window_sec=window_sec, use_relative=False, apply_smoothing=False
        )

        if not channels or not values:
            return [], [], 0.0

        eng_values = [compute_engagement(ch) for ch in values]

        if self.smoothing_enabled:
            eng_values = self.engagement_smoother.update(eng_values)

        return channels, eng_values, float(np.mean(eng_values)) if eng_values else 0.0
