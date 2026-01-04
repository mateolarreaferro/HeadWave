import threading
from typing import Optional, List, Tuple, Dict

import numpy as np

from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
from brainflow.data_filter import DataFilter, WindowOperations, DetrendOperations

from .osc_sender import OSCSender
from .signal_processing import SmoothingBuffer, ArtifactDetector
from .band_analyzer import DEFAULT_BANDS, compute_engagement, to_relative


class GanglionService:

    def __init__(self):
        self.board: Optional[BoardShim] = None
        self.board_id = None
        self.params = BrainFlowInputParams()
        self.connected = False
        self.streaming = False
        self.lock = threading.Lock()

        self.osc = OSCSender()
        self.artifact_detector = ArtifactDetector()

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

    def configure_artifact_detection(self, enabled: bool, amplitude_threshold: float = 100.0,
                                       zscore_threshold: float = 5.0, high_freq_ratio: float = 0.2):
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

        self._configure_board()

    def _configure_board(self):
        if not self.board:
            return
        try:
            import time
            time.sleep(0.5)
            self.board.config_board("]")
            time.sleep(0.1)
            for cmd in ["!", "@", "#", "$"]:
                self.board.config_board(cmd)
            time.sleep(0.1)
        except Exception:
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
            time.sleep(0.2)
        except Exception:
            pass

        self.board.start_stream(buffer_size)
        self.streaming = True

    def stop_stream(self):
        if not self.streaming or self.board is None:
            return
        self.board.stop_stream()
        self.streaming = False

    def send_test_signal_on(self):
        if self.board:
            self.board.config_board("[")

    def send_test_signal_off(self):
        if self.board:
            self.board.config_board("]")

    def _get_exg_channels(self) -> List[int]:
        if self.board_id is None:
            return []
        return BoardShim.get_exg_channels(self.board_id)

    def get_timeseries_window(self, window_sec: float = 4.0, max_points: int = 512):
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

    def get_fft_spectrum(self, window_sec: float = 4.0, min_freq: float = 0.5, max_freq: float = 40.0):
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
        all_psd = []
        freq_list = []

        for ch_idx, ch in enumerate(ch_indices):
            sig = data[ch, :].astype(np.float64)
            if sig.size < 32:
                all_psd.append([])
                continue

            DataFilter.detrend(sig, DetrendOperations.LINEAR.value)

            fft_len = DataFilter.get_nearest_power_of_two(sig.size)
            while fft_len >= sig.size and fft_len > 2:
                fft_len //= 2

            psd, freqs = DataFilter.get_psd_welch(
                sig, fft_len, fft_len // 2, sampling_rate,
                WindowOperations.HANNING.value
            )

            mask = (freqs >= min_freq) & (freqs <= max_freq)
            if ch_idx == 0:
                freq_list = freqs[mask].tolist()

            psd_db = 10 * np.log10(psd[mask] + 1e-10)
            all_psd.append(psd_db.tolist())

        return channel_names, freq_list, all_psd

    def get_band_powers(self, window_sec: float = 4.0,
                        bands: Optional[List[Tuple[str, float, float]]] = None,
                        use_relative: bool = True, apply_smoothing: bool = True):
        if bands is None:
            bands = DEFAULT_BANDS

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
        all_band_vals = []

        for ch_idx, ch in enumerate(ch_indices):
            ch_name = f"CH{ch_idx+1}"
            sig = data[ch, :].astype(np.float64)

            if sig.size < 32:
                all_band_vals.append([0.0] * len(bands))
                continue

            DataFilter.detrend(sig, DetrendOperations.LINEAR.value)

            fft_len = DataFilter.get_nearest_power_of_two(sig.size)
            while fft_len >= sig.size and fft_len > 2:
                fft_len //= 2

            psd_tuple = DataFilter.get_psd_welch(
                sig, fft_len, fft_len // 2, sampling_rate,
                WindowOperations.HANNING.value
            )

            ch_band_vals = [float(DataFilter.get_band_power(psd_tuple, fmin, fmax))
                           for _, fmin, fmax in bands]

            if use_relative:
                ch_band_vals = to_relative(ch_band_vals)

            if apply_smoothing and self.smoothing_enabled:
                if ch_name not in self.band_smoothers:
                    self.band_smoothers[ch_name] = SmoothingBuffer(
                        alpha=self.smoothing_alpha, num_values=len(bands)
                    )
                ch_band_vals = self.band_smoothers[ch_name].update(ch_band_vals)

            all_band_vals.append(ch_band_vals)

        return channel_names, band_names, all_band_vals

    def get_engagement_index(self, window_sec: float = 4.0):
        if not (self.connected and self.streaming and self.board):
            return [], [], 0.0

        channels, band_names, values = self.get_band_powers(
            window_sec=window_sec, use_relative=False, apply_smoothing=False
        )

        if not channels or not values:
            return [], [], 0.0

        engagement_values = [compute_engagement(ch_bands) for ch_bands in values]

        if self.smoothing_enabled:
            engagement_values = self.engagement_smoother.update(engagement_values)

        avg_engagement = float(np.mean(engagement_values)) if engagement_values else 0.0
        return channels, engagement_values, avg_engagement

    def configure_osc(self, ip: str, port: int, enabled: bool, send_raw: bool, send_bands: bool):
        self.osc.configure(ip, port, enabled, send_raw, send_bands)

    def osc_push_timeseries(self, channel_names: List[str], data: List[List[float]]):
        self.osc.send_timeseries(channel_names, data)

    def osc_push_bands(self, channel_names: List[str], band_names: List[str], values: List[List[float]]):
        self.osc.send_bands(channel_names, band_names, values)
