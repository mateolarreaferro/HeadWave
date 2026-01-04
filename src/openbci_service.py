import threading
from typing import Optional, List, Tuple, Dict
from collections import deque

import numpy as np

from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
from brainflow.data_filter import DataFilter, WindowOperations, DetrendOperations, FilterTypes

from .osc_sender import OSCSender


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


class ArtifactDetector:

    def __init__(self, amplitude_threshold: float = 100.0,
                 zscore_threshold: float = 5.0,
                 high_freq_ratio_threshold: float = 0.2):
        self.amplitude_threshold = amplitude_threshold
        self.zscore_threshold = zscore_threshold
        self.high_freq_ratio_threshold = high_freq_ratio_threshold
        self.enabled = True

    def detect_amplitude_artifact(self, signal: np.ndarray) -> bool:
        if not self.enabled or signal.size == 0:
            return False
        max_amplitude = np.max(np.abs(signal))
        return max_amplitude > self.amplitude_threshold

    def detect_variance_artifact(self, signal: np.ndarray) -> bool:
        if not self.enabled or signal.size < 10:
            return False
        signal_squared = np.square(signal)
        mean_power = np.mean(signal_squared)
        std_power = np.std(signal_squared)

        if std_power == 0:
            return False

        zscore = (signal_squared - mean_power) / std_power
        return bool(np.any(np.abs(zscore) > self.zscore_threshold))

    def detect_emg_artifact(self, signal: np.ndarray, sampling_rate: int = 200) -> bool:
        if not self.enabled or signal.size < 64:
            return False

        fft_result = np.fft.rfft(signal)
        psd = np.abs(fft_result) ** 2 / len(signal)
        freqs = np.fft.rfftfreq(len(signal), 1.0 / sampling_rate)

        high_freq_mask = (freqs >= 50) & (freqs <= 100)
        high_freq_energy = np.sum(psd[high_freq_mask])

        signal_mask = (freqs >= 0.5) & (freqs <= 40)
        signal_energy = np.sum(psd[signal_mask])

        ratio = high_freq_energy / (signal_energy + 1e-10)
        return ratio > self.high_freq_ratio_threshold

    def detect_any(self, signal: np.ndarray, sampling_rate: int = 200) -> Tuple[bool, str]:
        if not self.enabled:
            return False, ""

        if self.detect_amplitude_artifact(signal):
            return True, "amplitude"
        if self.detect_variance_artifact(signal):
            return True, "variance"
        if self.detect_emg_artifact(signal, sampling_rate):
            return True, "emg"

        return False, ""

    def get_signal_quality(self, signal: np.ndarray, sampling_rate: int = 200) -> float:
        if signal.size == 0:
            return 0.0

        score = 1.0

        max_amp = np.max(np.abs(signal))
        if max_amp > self.amplitude_threshold:
            score -= 0.4
        elif max_amp > self.amplitude_threshold * 0.7:
            score -= 0.2

        if signal.size >= 10:
            signal_squared = np.square(signal)
            std_power = np.std(signal_squared)
            mean_power = np.mean(signal_squared)
            if mean_power > 0:
                cv = std_power / mean_power
                if cv > 2.0:
                    score -= 0.3
                elif cv > 1.0:
                    score -= 0.15

        if signal.size >= 64:
            fft_result = np.fft.rfft(signal)
            psd = np.abs(fft_result) ** 2 / len(signal)
            freqs = np.fft.rfftfreq(len(signal), 1.0 / sampling_rate)

            high_freq_mask = (freqs >= 50) & (freqs <= 100)
            signal_mask = (freqs >= 0.5) & (freqs <= 40)

            high_freq_energy = np.sum(psd[high_freq_mask])
            signal_energy = np.sum(psd[signal_mask])

            ratio = high_freq_energy / (signal_energy + 1e-10)
            if ratio > self.high_freq_ratio_threshold:
                score -= 0.3
            elif ratio > self.high_freq_ratio_threshold * 0.5:
                score -= 0.15

        return max(0.0, min(1.0, score))


class GanglionService:
    def __init__(self):
        self.board: Optional[BoardShim] = None
        self.board_id = None
        self.params = BrainFlowInputParams()
        self.connected = False
        self.streaming = False
        self.lock = threading.Lock()
        self.osc = OSCSender()

        self.smoothing_alpha = 0.3
        self.smoothing_enabled = True
        self.band_smoothers: Dict[str, SmoothingBuffer] = {}

        self.artifact_detector = ArtifactDetector()

        self.engagement_smoother = SmoothingBuffer(alpha=0.2, num_values=4)

    def configure_smoothing(self, enabled: bool, alpha: float = 0.3):
        self.smoothing_enabled = enabled
        self.smoothing_alpha = max(0.05, min(1.0, alpha))
        for smoother in self.band_smoothers.values():
            smoother.enabled = enabled
            smoother.alpha = self.smoothing_alpha
        self.engagement_smoother.enabled = enabled
        self.engagement_smoother.alpha = self.smoothing_alpha

    def configure_artifact_detection(self, enabled: bool,
                                      amplitude_threshold: float = 100.0,
                                      zscore_threshold: float = 5.0,
                                      high_freq_ratio: float = 0.2):
        self.artifact_detector.enabled = enabled
        self.artifact_detector.amplitude_threshold = amplitude_threshold
        self.artifact_detector.zscore_threshold = zscore_threshold
        self.artifact_detector.high_freq_ratio_threshold = high_freq_ratio

    def connect(self, serial_port: str = "", mac_address: str = "", timeout: int = 15):
        if self.connected:
            return

        if serial_port:
            self.board_id = BoardIds.GANGLION_BOARD
            self.params.serial_port = serial_port
            self.params.mac_address = ""
        else:
            self.board_id = BoardIds.GANGLION_NATIVE_BOARD
            self.params.serial_port = ""
            self.params.mac_address = mac_address

        self.params.timeout = timeout

        BoardShim.enable_dev_board_logger()
        self.board = BoardShim(self.board_id, self.params)
        self.board.prepare_session()
        self.connected = True

        try:
            import time
            time.sleep(0.5)

            self.board.config_board("]")
            print("[HeadWave] Sent test signal OFF command (])")
            time.sleep(0.1)

            self.board.config_board("!")
            self.board.config_board("@")
            self.board.config_board("#")
            self.board.config_board("$")
            print("[HeadWave] Enabled all 4 channels (! @ # $)")
            time.sleep(0.1)

        except Exception as e:
            print(f"[HeadWave] Failed to configure board: {e}")
            pass

    def disconnect(self):
        if not self.connected or self.board is None:
            return
        if self.streaming:
            self.stop_stream()
        self.board.release_session()
        self.board = None
        self.connected = False

    def start_stream(self, buffer_size: int = 45000):
        if not self.connected or self.board is None:
            raise RuntimeError("Board not connected")
        if self.streaming:
            return
        import time
        try:
            self.board.config_board("]")
            print("[HeadWave] Before stream: Sent test signal OFF command (])")
            time.sleep(0.2)
        except Exception as e:
            print(f"[HeadWave] Failed to send OFF command before stream: {e}")
        self.board.start_stream(buffer_size)
        self.streaming = True

    def stop_stream(self):
        if not self.streaming or self.board is None:
            return
        self.board.stop_stream()
        self.streaming = False

    def send_test_signal_on(self):
        if self.board is not None:
            self.board.config_board("[")

    def send_test_signal_off(self):
        if self.board is not None:
            self.board.config_board("]")

    def _get_exg_channels(self) -> List[int]:
        if self.board_id is None:
            return []
        return BoardShim.get_exg_channels(self.board_id)

    def _preprocess_signal(self, signal: np.ndarray, sampling_rate: int, apply_filters: bool = False) -> np.ndarray:
        if signal.size < 8:
            return signal

        filtered = signal.copy()

        DataFilter.detrend(filtered, DetrendOperations.LINEAR.value)

        if apply_filters and signal.size >= 64:
            try:
                DataFilter.perform_bandstop(
                    filtered,
                    sampling_rate,
                    centerfreq=60.0,
                    bandwidth_hz=2.0,
                    order=2,
                    filter_type=FilterTypes.BUTTERWORTH.value,
                    ripple=0
                )
            except Exception:
                pass

        return filtered

    def get_timeseries_window(
        self,
        window_sec: float = 4.0,
        max_points: int = 512,
    ) -> Tuple[List[str], List[List[float]]]:
        if not (self.connected and self.streaming and self.board):
            return [], []

        sampling_rate = BoardShim.get_sampling_rate(self.board_id)
        n_samples = int(window_sec * sampling_rate)
        with self.lock:
            data = self.board.get_current_board_data(n_samples)
        ch_indices = self._get_exg_channels()
        if data.shape[1] == 0:
            return [], []

        ts_data = []
        for ch in ch_indices:
            channel_series = data[ch, :].astype(np.float64)

            if channel_series.size >= 3:
                smoothed = channel_series.copy()
                DataFilter.perform_rolling_filter(smoothed, 3, operation=0)
                channel_series = smoothed

            if channel_series.size > max_points:
                step = int(np.floor(channel_series.size / max_points))
                channel_series = channel_series[::step]

            ts_data.append(channel_series.tolist())

        channel_names = [f"CH{idx+1}" for idx in range(len(ch_indices))]
        return channel_names, ts_data

    def get_fft_spectrum(
        self,
        window_sec: float = 4.0,
        min_freq: float = 0.5,
        max_freq: float = 40.0,
    ) -> Tuple[List[str], List[float], List[List[float]]]:
        if not (self.connected and self.streaming and self.board):
            return [], [], []

        sampling_rate = BoardShim.get_sampling_rate(self.board_id)
        n_samples = int(window_sec * sampling_rate)

        with self.lock:
            data = self.board.get_current_board_data(n_samples)

        ch_indices = self._get_exg_channels()
        if data.shape[1] == 0:
            return [], [], []

        channel_names = [f"CH{idx+1}" for idx in range(len(ch_indices))]
        all_psd: List[List[float]] = []
        freq_list: List[float] = []

        for ch_idx, ch in enumerate(ch_indices):
            sig = data[ch, :].astype(np.float64)
            if sig.size < 32:
                all_psd.append([])
                continue

            DataFilter.detrend(sig, DetrendOperations.LINEAR.value)

            fft_len = DataFilter.get_nearest_power_of_two(sig.size)
            while fft_len >= sig.size and fft_len > 2:
                fft_len = fft_len // 2

            overlap = fft_len // 2

            psd, freqs = DataFilter.get_psd_welch(
                sig, fft_len, overlap, sampling_rate,
                WindowOperations.HANNING.value
            )

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
        bands: Optional[List[Tuple[str, float, float]]] = None,
        use_relative: bool = True,
        apply_smoothing: bool = True,
    ) -> Tuple[List[str], List[str], List[List[float]]]:
        if bands is None:
            bands = [
                ("delta", 0.5, 4.0),
                ("theta", 4.0, 8.0),
                ("alpha", 8.0, 13.0),
                ("beta", 13.0, 30.0),
                ("gamma", 30.0, 40.0),
            ]

        if not (self.connected and self.streaming and self.board):
            return [], [b[0] for b in bands], []

        sampling_rate = BoardShim.get_sampling_rate(self.board_id)
        n_samples = int(window_sec * sampling_rate)

        with self.lock:
            data = self.board.get_current_board_data(n_samples)

        ch_indices = self._get_exg_channels()
        if data.shape[1] == 0:
            return [], [b[0] for b in bands], []

        band_names = [b[0] for b in bands]
        channel_names = [f"CH{idx+1}" for idx in range(len(ch_indices))]
        all_band_vals: List[List[float]] = []

        for ch_idx, ch in enumerate(ch_indices):
            ch_name = f"CH{ch_idx+1}"
            sig = data[ch, :].astype(np.float64)
            if sig.size < 32:
                all_band_vals.append([0.0] * len(bands))
                continue

            DataFilter.detrend(sig, DetrendOperations.LINEAR.value)

            fft_len = DataFilter.get_nearest_power_of_two(sig.size)
            while fft_len >= sig.size and fft_len > 2:
                fft_len = fft_len // 2

            overlap = fft_len // 2

            psd_tuple = DataFilter.get_psd_welch(
                sig, fft_len, overlap, sampling_rate,
                WindowOperations.HANNING.value
            )

            ch_band_vals: List[float] = []
            for _, fmin, fmax in bands:
                bp = DataFilter.get_band_power(psd_tuple, fmin, fmax)
                ch_band_vals.append(float(bp))

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
        bands: Optional[List[Tuple[str, float, float]]] = None,
        use_relative: bool = True,
    ) -> Tuple[List[str], List[str], List[List[float]], List[bool], List[float]]:
        if bands is None:
            bands = [
                ("delta", 0.5, 4.0),
                ("theta", 4.0, 8.0),
                ("alpha", 8.0, 13.0),
                ("beta", 13.0, 30.0),
                ("gamma", 30.0, 40.0),
            ]

        if not (self.connected and self.streaming and self.board):
            return [], [b[0] for b in bands], [], [], []

        sampling_rate = BoardShim.get_sampling_rate(self.board_id)
        n_samples = int(window_sec * sampling_rate)

        with self.lock:
            data = self.board.get_current_board_data(n_samples)

        ch_indices = self._get_exg_channels()
        if data.shape[1] == 0:
            return [], [b[0] for b in bands], [], [], []

        band_names = [b[0] for b in bands]
        channel_names = [f"CH{idx+1}" for idx in range(len(ch_indices))]
        all_band_vals: List[List[float]] = []
        artifact_flags: List[bool] = []
        signal_quality: List[float] = []

        for ch_idx, ch in enumerate(ch_indices):
            ch_name = f"CH{ch_idx+1}"
            sig = data[ch, :].astype(np.float64)

            has_artifact, _ = self.artifact_detector.detect_any(sig, sampling_rate)
            artifact_flags.append(has_artifact)

            quality = self.artifact_detector.get_signal_quality(sig, sampling_rate)
            signal_quality.append(quality)

            if sig.size < 32:
                all_band_vals.append([0.0] * len(bands))
                continue

            DataFilter.detrend(sig, DetrendOperations.LINEAR.value)

            fft_len = DataFilter.get_nearest_power_of_two(sig.size)
            while fft_len >= sig.size and fft_len > 2:
                fft_len = fft_len // 2

            overlap = fft_len // 2

            psd_tuple = DataFilter.get_psd_welch(
                sig, fft_len, overlap, sampling_rate,
                WindowOperations.HANNING.value
            )

            ch_band_vals: List[float] = []
            for _, fmin, fmax in bands:
                bp = DataFilter.get_band_power(psd_tuple, fmin, fmax)
                ch_band_vals.append(float(bp))

            if use_relative:
                total_power = sum(ch_band_vals)
                if total_power > 0:
                    ch_band_vals = [(bp / total_power) * 100 for bp in ch_band_vals]
                else:
                    ch_band_vals = [0.0] * len(bands)

            if self.smoothing_enabled:
                if ch_name not in self.band_smoothers:
                    self.band_smoothers[ch_name] = SmoothingBuffer(
                        alpha=self.smoothing_alpha, num_values=len(bands)
                    )
                ch_band_vals = self.band_smoothers[ch_name].update(ch_band_vals)

            all_band_vals.append(ch_band_vals)

        return channel_names, band_names, all_band_vals, artifact_flags, signal_quality

    def get_engagement_index(
        self,
        window_sec: float = 4.0,
    ) -> Tuple[List[str], List[float], float]:
        if not (self.connected and self.streaming and self.board):
            return [], [], 0.0

        channels, band_names, values = self.get_band_powers(
            window_sec=window_sec,
            use_relative=False,
            apply_smoothing=False
        )

        if not channels or not values:
            return [], [], 0.0

        engagement_values: List[float] = []

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

    def configure_osc(self, ip: str, port: int, enabled: bool,
                      send_raw: bool, send_bands: bool):
        self.osc.configure(ip, port, enabled, send_raw, send_bands)

    def osc_push_timeseries(self, channel_names: List[str], data: List[List[float]]):
        self.osc.send_timeseries(channel_names, data)

    def osc_push_bands(self, channel_names: List[str],
                       band_names: List[str],
                       values: List[List[float]]):
        self.osc.send_bands(channel_names, band_names, values)
