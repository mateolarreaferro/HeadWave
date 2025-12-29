# openbci_service.py
import threading
from typing import Optional, List, Tuple, Dict
from collections import deque

import numpy as np

from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
from brainflow.data_filter import DataFilter, WindowOperations, DetrendOperations, FilterTypes

from osc_sender import OSCSender


class SmoothingBuffer:
    """Exponential moving average buffer for smoothing data streams"""

    def __init__(self, alpha: float = 0.3, num_values: int = 5):
        """
        Args:
            alpha: Smoothing factor (0-1). Lower = smoother, higher = more responsive
            num_values: Number of values to track (e.g., 5 bands)
        """
        self.alpha = alpha
        self.smoothed_values: List[Optional[float]] = [None] * num_values
        self.enabled = True

    def update(self, values: List[float]) -> List[float]:
        """Apply EMA smoothing to new values"""
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
        """Reset smoothing buffer"""
        self.smoothed_values = [None] * len(self.smoothed_values)


class ArtifactDetector:
    """Detects EEG artifacts using multiple methods"""

    def __init__(self, amplitude_threshold: float = 100.0,
                 zscore_threshold: float = 5.0,
                 high_freq_ratio_threshold: float = 0.2):
        """
        Args:
            amplitude_threshold: Max acceptable amplitude in µV
            zscore_threshold: Z-score threshold for variance detection
            high_freq_ratio_threshold: Max ratio of high-freq to signal energy
        """
        self.amplitude_threshold = amplitude_threshold
        self.zscore_threshold = zscore_threshold
        self.high_freq_ratio_threshold = high_freq_ratio_threshold
        self.enabled = True

    def detect_amplitude_artifact(self, signal: np.ndarray) -> bool:
        """Detect artifacts via amplitude threshold"""
        if not self.enabled or signal.size == 0:
            return False
        max_amplitude = np.max(np.abs(signal))
        return max_amplitude > self.amplitude_threshold

    def detect_variance_artifact(self, signal: np.ndarray) -> bool:
        """Detect artifacts via variance z-score"""
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
        """Detect high-frequency EMG/muscle artifacts"""
        if not self.enabled or signal.size < 64:
            return False

        fft_result = np.fft.rfft(signal)
        psd = np.abs(fft_result) ** 2 / len(signal)
        freqs = np.fft.rfftfreq(len(signal), 1.0 / sampling_rate)

        # Energy in high-frequency band (50-100 Hz)
        high_freq_mask = (freqs >= 50) & (freqs <= 100)
        high_freq_energy = np.sum(psd[high_freq_mask])

        # Energy in signal band (0.5-40 Hz)
        signal_mask = (freqs >= 0.5) & (freqs <= 40)
        signal_energy = np.sum(psd[signal_mask])

        ratio = high_freq_energy / (signal_energy + 1e-10)
        return ratio > self.high_freq_ratio_threshold

    def detect_any(self, signal: np.ndarray, sampling_rate: int = 200) -> Tuple[bool, str]:
        """
        Run all artifact detection methods.
        Returns (has_artifact, artifact_type)
        """
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
        """
        Calculate signal quality score (0-1, higher is better)
        """
        if signal.size == 0:
            return 0.0

        score = 1.0

        # Amplitude check
        max_amp = np.max(np.abs(signal))
        if max_amp > self.amplitude_threshold:
            score -= 0.4
        elif max_amp > self.amplitude_threshold * 0.7:
            score -= 0.2

        # Variance check
        if signal.size >= 10:
            signal_squared = np.square(signal)
            std_power = np.std(signal_squared)
            mean_power = np.mean(signal_squared)
            if mean_power > 0:
                cv = std_power / mean_power  # Coefficient of variation
                if cv > 2.0:
                    score -= 0.3
                elif cv > 1.0:
                    score -= 0.15

        # High-frequency check
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
        self.board_id = None  # Will be set based on connection type
        self.params = BrainFlowInputParams()
        self.connected = False
        self.streaming = False
        self.lock = threading.Lock()
        self.osc = OSCSender()

        # Smoothing configuration (per-channel buffers for bands)
        self.smoothing_alpha = 0.3  # Default smoothing factor
        self.smoothing_enabled = True
        self.band_smoothers: Dict[str, SmoothingBuffer] = {}  # Keyed by channel name

        # Artifact detection
        self.artifact_detector = ArtifactDetector()

        # Engagement index history for smoothing
        self.engagement_smoother = SmoothingBuffer(alpha=0.2, num_values=4)  # 4 channels

    def configure_smoothing(self, enabled: bool, alpha: float = 0.3):
        """Configure smoothing parameters"""
        self.smoothing_enabled = enabled
        self.smoothing_alpha = max(0.05, min(1.0, alpha))
        # Update existing smoothers
        for smoother in self.band_smoothers.values():
            smoother.enabled = enabled
            smoother.alpha = self.smoothing_alpha
        self.engagement_smoother.enabled = enabled
        self.engagement_smoother.alpha = self.smoothing_alpha

    def configure_artifact_detection(self, enabled: bool,
                                      amplitude_threshold: float = 100.0,
                                      zscore_threshold: float = 5.0,
                                      high_freq_ratio: float = 0.2):
        """Configure artifact detection parameters"""
        self.artifact_detector.enabled = enabled
        self.artifact_detector.amplitude_threshold = amplitude_threshold
        self.artifact_detector.zscore_threshold = zscore_threshold
        self.artifact_detector.high_freq_ratio_threshold = high_freq_ratio

    # ---------- Connection control ----------

    def connect(self, serial_port: str = "", mac_address: str = "", timeout: int = 15):
        """
        Connect to Ganglion using either:
        - Native Bluetooth (GANGLION_NATIVE_BOARD): Leave serial_port empty, optionally set mac_address
        - BLED112 Dongle (GANGLION_BOARD): Set serial_port
        """
        if self.connected:
            return

        # Determine board type based on connection method
        if serial_port:
            # Using BLED112 dongle - serial connection
            self.board_id = BoardIds.GANGLION_BOARD
            self.params.serial_port = serial_port
            self.params.mac_address = ""
        else:
            # Using native Bluetooth
            self.board_id = BoardIds.GANGLION_NATIVE_BOARD
            self.params.serial_port = ""
            self.params.mac_address = mac_address  # Optional - BrainFlow will autodiscover if empty

        self.params.timeout = timeout

        BoardShim.enable_dev_board_logger()
        self.board = BoardShim(self.board_id, self.params)
        self.board.prepare_session()
        self.connected = True

        # Configure board: disable test signal and enable all channels
        try:
            import time
            time.sleep(0.5)  # Wait for board to be fully ready

            # Disable test signal
            self.board.config_board("]")
            print("[HeadWave] Sent test signal OFF command (])")
            time.sleep(0.1)

            # Enable all 4 channels (! @ # $ for channels 1-4)
            self.board.config_board("!")
            self.board.config_board("@")
            self.board.config_board("#")
            self.board.config_board("$")
            print("[HeadWave] Enabled all 4 channels (! @ # $)")
            time.sleep(0.1)

        except Exception as e:
            print(f"[HeadWave] Failed to configure board: {e}")
            # If command fails, continue anyway
            pass

    def disconnect(self):
        if not self.connected or self.board is None:
            return
        if self.streaming:
            self.stop_stream()
        self.board.release_session()
        self.board = None
        self.connected = False

    # ---------- Streaming control ----------

    def start_stream(self, buffer_size: int = 45000):
        """
        buffer_size in number of data points. 45000 is a typical default.
        """
        if not self.connected or self.board is None:
            raise RuntimeError("Board not connected")
        if self.streaming:
            return
        # Ensure test signal is OFF before starting stream
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

    # ---------- Test / config ----------

    def send_test_signal_on(self):
        """
        Use Ganglion ASCII command '[' to enable synthetic square wave.
        """
        if self.board is not None:
            self.board.config_board("[")

    def send_test_signal_off(self):
        if self.board is not None:
            self.board.config_board("]")

    # ---------- Data access helpers ----------

    def _get_exg_channels(self) -> List[int]:
        if self.board_id is None:
            return []
        return BoardShim.get_exg_channels(self.board_id)

    def _preprocess_signal(self, signal: np.ndarray, sampling_rate: int, apply_filters: bool = False) -> np.ndarray:
        """
        Apply light EEG preprocessing:
        - Detrending (always applied)
        - Optional: Notch filter (60 Hz) to remove power line interference
        """
        if signal.size < 8:
            return signal

        # Create a copy to avoid modifying original data
        filtered = signal.copy()

        # Always apply detrending to remove DC offset
        DataFilter.detrend(filtered, DetrendOperations.LINEAR.value)

        # Only apply notch filter if requested (can be aggressive on small datasets)
        if apply_filters and signal.size >= 64:
            try:
                # Apply notch filter at 60 Hz (US power line frequency)
                DataFilter.perform_bandstop(
                    filtered,
                    sampling_rate,
                    centerfreq=60.0,
                    bandwidth_hz=2.0,  # Narrow notch width
                    order=2,  # Lower order for stability
                    filter_type=FilterTypes.BUTTERWORTH.value,
                    ripple=0
                )
            except Exception:
                # If filter fails, just return detrended signal
                pass

        return filtered

    def get_timeseries_window(
        self,
        window_sec: float = 4.0,
        max_points: int = 512,
    ) -> Tuple[List[str], List[List[float]]]:
        """
        Returns (channel_names, data[channels][samples])
        Data is preprocessed with bandpass and notch filters, then smoothed
        """
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

            # Apply light smoothing using moving average (window size = 3)
            if channel_series.size >= 3:
                smoothed = channel_series.copy()
                DataFilter.perform_rolling_filter(smoothed, 3, operation=0)  # 0 = mean
                channel_series = smoothed

            # Downsample if too many points
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
        """
        Returns (channel_names, freqs, psd[channels][freqs])
        PSD values are in log scale (dB) for better visualization
        Signal is preprocessed with bandpass and notch filters
        """
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

            # Detrend to remove linear trends
            DataFilter.detrend(sig, DetrendOperations.LINEAR.value)

            # Choose fft_len as nearest power of 2, but MUST be < data length
            # Use 50% overlap for good PSD estimation
            fft_len = DataFilter.get_nearest_power_of_two(sig.size)
            while fft_len >= sig.size and fft_len > 2:
                fft_len = fft_len // 2

            overlap = fft_len // 2  # 50% overlap

            psd, freqs = DataFilter.get_psd_welch(
                sig, fft_len, overlap, sampling_rate,
                WindowOperations.HANNING.value
            )

            # Filter to frequency range
            mask = (freqs >= min_freq) & (freqs <= max_freq)
            filtered_freqs = freqs[mask]
            filtered_psd = psd[mask]

            # Convert to dB scale for better visualization: 10 * log10(PSD)
            # Add small epsilon to avoid log(0)
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
        """
        Returns (channel_names, band_names, band_values[channels][bands])
        Signal is preprocessed with bandpass and notch filters
        If use_relative=True, returns relative band power (percentage of total power)
        If apply_smoothing=True, applies EMA smoothing to band values
        """
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

            # Detrend to remove linear trends
            DataFilter.detrend(sig, DetrendOperations.LINEAR.value)

            # Choose fft_len as nearest power of 2, but MUST be < data length
            fft_len = DataFilter.get_nearest_power_of_two(sig.size)
            while fft_len >= sig.size and fft_len > 2:
                fft_len = fft_len // 2

            overlap = fft_len // 2  # 50% overlap

            psd_tuple = DataFilter.get_psd_welch(
                sig, fft_len, overlap, sampling_rate,
                WindowOperations.HANNING.value
            )

            # Calculate band powers
            ch_band_vals: List[float] = []
            for _, fmin, fmax in bands:
                bp = DataFilter.get_band_power(psd_tuple, fmin, fmax)
                ch_band_vals.append(float(bp))

            # Convert to relative power (percentage) if requested
            if use_relative:
                total_power = sum(ch_band_vals)
                if total_power > 0:
                    ch_band_vals = [(bp / total_power) * 100 for bp in ch_band_vals]
                else:
                    ch_band_vals = [0.0] * len(bands)

            # Apply smoothing if enabled
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
        """
        Returns band powers with artifact detection info.
        Returns: (channel_names, band_names, band_values, artifact_flags, signal_quality)
        """
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

            # Check for artifacts
            has_artifact, _ = self.artifact_detector.detect_any(sig, sampling_rate)
            artifact_flags.append(has_artifact)

            # Calculate signal quality
            quality = self.artifact_detector.get_signal_quality(sig, sampling_rate)
            signal_quality.append(quality)

            if sig.size < 32:
                all_band_vals.append([0.0] * len(bands))
                continue

            # Detrend to remove linear trends
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

            # Apply smoothing
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
        """
        Calculate engagement index: Beta / (Alpha + Theta)
        Higher values indicate more focused/engaged states.

        Returns: (channel_names, per_channel_values, cross_channel_average)
        """
        if not (self.connected and self.streaming and self.board):
            return [], [], 0.0

        # Get band powers (not relative, absolute for ratio calculation)
        channels, band_names, values = self.get_band_powers(
            window_sec=window_sec,
            use_relative=False,
            apply_smoothing=False  # We'll smooth the final engagement value
        )

        if not channels or not values:
            return [], [], 0.0

        # Band indices: delta=0, theta=1, alpha=2, beta=3, gamma=4
        engagement_values: List[float] = []

        for ch_bands in values:
            if len(ch_bands) < 5:
                engagement_values.append(0.0)
                continue

            theta = ch_bands[1]
            alpha = ch_bands[2]
            beta = ch_bands[3]

            denominator = alpha + theta + 0.001  # Avoid division by zero
            engagement = beta / denominator

            # Clamp to reasonable range (0-5)
            engagement = max(0.0, min(5.0, engagement))
            engagement_values.append(engagement)

        # Apply smoothing to engagement values
        if self.smoothing_enabled:
            engagement_values = self.engagement_smoother.update(engagement_values)

        # Calculate cross-channel average
        avg_engagement = float(np.mean(engagement_values)) if engagement_values else 0.0

        return channels, engagement_values, avg_engagement

    # ---------- OSC glue ----------

    def configure_osc(self, ip: str, port: int, enabled: bool,
                      send_raw: bool, send_bands: bool):
        self.osc.configure(ip, port, enabled, send_raw, send_bands)

    def osc_push_timeseries(self, channel_names: List[str], data: List[List[float]]):
        self.osc.send_timeseries(channel_names, data)

    def osc_push_bands(self, channel_names: List[str],
                       band_names: List[str],
                       values: List[List[float]]):
        self.osc.send_bands(channel_names, band_names, values)
