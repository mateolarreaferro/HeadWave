from typing import List, Tuple, Optional, Dict
import numpy as np

DEFAULT_BANDS = [
    ("delta", 0.5, 4.0),
    ("theta", 4.0, 8.0),
    ("alpha", 8.0, 13.0),
    ("beta", 13.0, 30.0),
    ("gamma", 30.0, 40.0),
]


def compute_band_power(signal: np.ndarray, sampling_rate: int,
                       fmin: float, fmax: float) -> float:
    if signal.size < 32:
        return 0.0

    fft_result = np.fft.rfft(signal)
    psd = np.abs(fft_result) ** 2 / len(signal)
    freqs = np.fft.rfftfreq(len(signal), 1.0 / sampling_rate)

    band_mask = (freqs >= fmin) & (freqs < fmax)
    return float(np.sum(psd[band_mask]))


def compute_all_bands(signal: np.ndarray, sampling_rate: int,
                      bands: Optional[List[Tuple[str, float, float]]] = None) -> List[float]:
    if bands is None:
        bands = DEFAULT_BANDS

    return [compute_band_power(signal, sampling_rate, fmin, fmax)
            for _, fmin, fmax in bands]


def to_relative(band_values: List[float]) -> List[float]:
    total = sum(band_values)
    if total > 0:
        return [(v / total) * 100 for v in band_values]
    return [0.0] * len(band_values)


def compute_engagement(band_values: List[float]) -> float:
    if len(band_values) < 4:
        return 0.0

    theta = band_values[1]
    alpha = band_values[2]
    beta = band_values[3]

    denominator = alpha + theta + 0.001
    engagement = beta / denominator
    return max(0.0, min(5.0, engagement))


def compute_fft_spectrum(signal: np.ndarray, sampling_rate: int,
                         min_freq: float = 0.5, max_freq: float = 40.0) -> Tuple[List[float], List[float]]:
    if signal.size < 32:
        return [], []

    fft_result = np.fft.rfft(signal)
    psd = np.abs(fft_result) ** 2 / len(signal)
    freqs = np.fft.rfftfreq(len(signal), 1.0 / sampling_rate)

    mask = (freqs >= min_freq) & (freqs <= max_freq)
    filtered_freqs = freqs[mask]
    filtered_psd = psd[mask]

    psd_db = 10 * np.log10(filtered_psd + 1e-10)

    return filtered_freqs.tolist(), psd_db.tolist()
