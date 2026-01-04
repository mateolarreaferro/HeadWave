import threading
import time
from typing import List, Tuple, Dict, Optional
import numpy as np
from collections import deque


class SmoothingBuffer:

    def __init__(self, alpha: float = 0.3, num_values: int = 5):
        self.alpha = alpha
        self.smoothed_values: List[Optional[float]] = [None] * num_values
        self.enabled = True

    def update(self, values: List[float]) -> List[float]:
        if not self.enabled:
            return values
        result = []
        for i, val in enumerate(values):
            if i >= len(self.smoothed_values):
                self.smoothed_values.append(None)
            if self.smoothed_values[i] is None:
                self.smoothed_values[i] = val
            else:
                self.smoothed_values[i] = self.alpha * val + (1 - self.alpha) * self.smoothed_values[i]
            result.append(self.smoothed_values[i])
        return result

    def reset(self):
        self.smoothed_values = [None] * len(self.smoothed_values)


class SimulatorService:

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

        self.DELTA = (0.5, 4.0)
        self.THETA = (4.0, 8.0)
        self.ALPHA = (8.0, 13.0)
        self.BETA = (13.0, 30.0)
        self.GAMMA = (30.0, 50.0)

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
        print("[SIMULATOR] Connected to synthetic EEG source")

    def disconnect(self):
        self.stop_stream()
        self.connected = False
        print("[SIMULATOR] Disconnected")

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
        print("[SIMULATOR] Started streaming synthetic EEG data")

    def stop_stream(self):
        if not self.streaming:
            return

        self.running = False
        self.streaming = False

        if self.thread:
            self.thread.join(timeout=2.0)
            self.thread = None

        print("[SIMULATOR] Stopped streaming")

    def set_mode(self, mode: str):
        valid_modes = ['normal', 'meditation', 'focused', 'drowsy']
        if mode in valid_modes:
            self.mode = mode
            print(f"[SIMULATOR] Mode changed to: {mode}")
        else:
            print(f"[SIMULATOR] Invalid mode: {mode}. Valid: {valid_modes}")

    def _generate_sample(self, t: float, channel: int) -> float:
        if self.mode == "meditation":
            alpha_amp = 40.0
            theta_amp = 30.0
            beta_amp = 5.0
            delta_amp = 10.0
            gamma_amp = 2.0
        elif self.mode == "focused":
            alpha_amp = 10.0
            theta_amp = 5.0
            beta_amp = 35.0
            delta_amp = 3.0
            gamma_amp = 8.0
        elif self.mode == "drowsy":
            alpha_amp = 15.0
            theta_amp = 25.0
            beta_amp = 5.0
            delta_amp = 40.0
            gamma_amp = 2.0
        else:
            alpha_amp = 20.0
            theta_amp = 10.0
            beta_amp = 15.0
            delta_amp = 8.0
            gamma_amp = 5.0

        channel_factor = 1.0 + 0.1 * channel

        signal = 0.0

        delta_freq = np.random.uniform(*self.DELTA)
        signal += delta_amp * channel_factor * np.sin(2 * np.pi * delta_freq * t)

        theta_freq = np.random.uniform(*self.THETA)
        signal += theta_amp * channel_factor * np.sin(2 * np.pi * theta_freq * t)

        alpha_freq = np.random.uniform(*self.ALPHA)
        signal += alpha_amp * channel_factor * np.sin(2 * np.pi * alpha_freq * t)

        beta_freq = np.random.uniform(*self.BETA)
        signal += beta_amp * channel_factor * np.sin(2 * np.pi * beta_freq * t)

        gamma_freq = np.random.uniform(*self.GAMMA)
        signal += gamma_amp * channel_factor * np.sin(2 * np.pi * gamma_freq * t)

        noise = np.random.normal(0, 2.0)
        signal += noise

        drift = 5.0 * np.sin(2 * np.pi * 0.1 * t)
        signal += drift

        return signal

    def _generate_loop(self):
        dt = 1.0 / self.sampling_rate

        while self.running:
            samples = []
            for channel in range(self.num_channels):
                sample = self._generate_sample(self.time_elapsed, channel)
                samples.append(sample)

            data_point = [self.time_elapsed] + samples

            with self.lock:
                self.buffer.append(data_point)

            self.time_elapsed += dt

            time.sleep(dt)

    def get_board_data(self, num_samples: int) -> np.ndarray:
        with self.lock:
            if len(self.buffer) == 0:
                return np.array([]).reshape(self.num_channels + 1, 0)

            n = min(num_samples, len(self.buffer))
            recent_data = list(self.buffer)[-n:]

            data_array = np.array(recent_data).T

            return data_array

    def get_current_board_data(self, max_samples: int = 250) -> np.ndarray:
        return self.get_board_data(max_samples)

    def get_timeseries_window(
        self,
        window_sec: float = 4.0,
        max_points: int = 512,
    ):
        if not (self.connected and self.streaming):
            return [], []

        n_samples = int(window_sec * self.sampling_rate)
        data = self.get_board_data(n_samples)

        if data.shape[1] == 0:
            return [], []

        ts_data = []
        for ch_idx in range(self.num_channels):
            channel_series = data[ch_idx + 1, :]

            if channel_series.size > max_points:
                step = int(np.floor(channel_series.size / max_points))
                channel_series = channel_series[::step]

            ts_data.append(channel_series.tolist())

        channel_names = [f"CH{idx+1}" for idx in range(self.num_channels)]
        return channel_names, ts_data

    def get_fft_spectrum(
        self,
        window_sec: float = 4.0,
        min_freq: float = 0.5,
        max_freq: float = 40.0,
    ):
        if not (self.connected and self.streaming):
            return [], [], []

        n_samples = int(window_sec * self.sampling_rate)
        data = self.get_board_data(n_samples)

        if data.shape[1] == 0:
            return [], [], []

        channel_names = [f"CH{idx+1}" for idx in range(self.num_channels)]
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
            filtered_freqs = freqs[mask]
            filtered_psd = psd[mask]

            psd_db = 10 * np.log10(filtered_psd + 1e-10)

            if ch_idx == 0:
                freq_list = filtered_freqs.tolist()

            all_psd.append(psd_db.tolist())

        return channel_names, freq_list, all_psd

    def get_band_powers(
        self,
        window_sec: float = 4.0,
        bands=None,
        use_relative: bool = True,
        apply_smoothing: bool = True,
    ):
        if bands is None:
            bands = [
                ("delta", 0.5, 4.0),
                ("theta", 4.0, 8.0),
                ("alpha", 8.0, 13.0),
                ("beta", 13.0, 30.0),
                ("gamma", 30.0, 40.0),
            ]

        if not (self.connected and self.streaming):
            return [], [b[0] for b in bands], []

        n_samples = int(window_sec * self.sampling_rate)
        data = self.get_board_data(n_samples)

        if data.shape[1] == 0:
            return [], [b[0] for b in bands], []

        band_names = [b[0] for b in bands]
        channel_names = [f"CH{idx+1}" for idx in range(self.num_channels)]
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

            ch_band_vals = []
            for _, fmin, fmax in bands:
                band_mask = (freqs >= fmin) & (freqs < fmax)
                band_power = np.sum(psd[band_mask])
                ch_band_vals.append(float(band_power))

            if use_relative:
                total_power = sum(ch_band_vals)
                if total_power > 0:
                    ch_band_vals = [(bp / total_power) * 100 for bp in ch_band_vals]
                else:
                    ch_band_vals = [0.0] * len(bands)

            if apply_smoothing and self.smoothing_enabled:
                if ch_name not in self.band_smoothers:
                    self.band_smoothers[ch_name] = SmoothingBuffer(
                        alpha=self.smoothing_alpha, num_values=len(bands)
                    )
                ch_band_vals = self.band_smoothers[ch_name].update(ch_band_vals)

            all_band_vals.append(ch_band_vals)

        return channel_names, band_names, all_band_vals

    def get_band_powers_with_artifacts(
        self,
        window_sec: float = 4.0,
        bands=None,
        use_relative: bool = True,
    ):
        channels, band_names, values = self.get_band_powers(
            window_sec=window_sec, bands=bands, use_relative=use_relative
        )
        artifact_flags = [False] * len(channels)
        signal_quality = [1.0] * len(channels)
        return channels, band_names, values, artifact_flags, signal_quality

    def get_engagement_index(
        self,
        window_sec: float = 4.0,
    ):
        if not (self.connected and self.streaming):
            return [], [], 0.0

        channels, band_names, values = self.get_band_powers(
            window_sec=window_sec,
            use_relative=False,
            apply_smoothing=False
        )

        if not channels or not values:
            return [], [], 0.0

        engagement_values = []
        for ch_bands in values:
            if len(ch_bands) < 5:
                engagement_values.append(0.0)
                continue

            theta = ch_bands[1]
            alpha = ch_bands[2]
            beta = ch_bands[3]

            denominator = alpha + theta + 0.001
            engagement = beta / denominator
            engagement = max(0.0, min(5.0, engagement))
            engagement_values.append(engagement)

        if self.smoothing_enabled:
            engagement_values = self.engagement_smoother.update(engagement_values)

        avg_engagement = float(np.mean(engagement_values)) if engagement_values else 0.0
        return channels, engagement_values, avg_engagement
