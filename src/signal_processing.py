from typing import List, Optional, Tuple
import numpy as np


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

    def detect_amplitude(self, signal: np.ndarray) -> bool:
        if not self.enabled or signal.size == 0:
            return False
        return np.max(np.abs(signal)) > self.amplitude_threshold

    def detect_variance(self, signal: np.ndarray) -> bool:
        if not self.enabled or signal.size < 10:
            return False

        signal_squared = np.square(signal)
        mean_power = np.mean(signal_squared)
        std_power = np.std(signal_squared)

        if std_power == 0:
            return False

        zscore = (signal_squared - mean_power) / std_power
        return bool(np.any(np.abs(zscore) > self.zscore_threshold))

    def detect_emg(self, signal: np.ndarray, sampling_rate: int = 200) -> bool:
        if not self.enabled or signal.size < 64:
            return False

        fft_result = np.fft.rfft(signal)
        psd = np.abs(fft_result) ** 2 / len(signal)
        freqs = np.fft.rfftfreq(len(signal), 1.0 / sampling_rate)

        high_freq_mask = (freqs >= 50) & (freqs <= 100)
        signal_mask = (freqs >= 0.5) & (freqs <= 40)

        high_freq_energy = np.sum(psd[high_freq_mask])
        signal_energy = np.sum(psd[signal_mask])

        ratio = high_freq_energy / (signal_energy + 1e-10)
        return ratio > self.high_freq_ratio_threshold

    def detect_any(self, signal: np.ndarray, sampling_rate: int = 200) -> Tuple[bool, str]:
        if not self.enabled:
            return False, ""

        if self.detect_amplitude(signal):
            return True, "amplitude"
        if self.detect_variance(signal):
            return True, "variance"
        if self.detect_emg(signal, sampling_rate):
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
