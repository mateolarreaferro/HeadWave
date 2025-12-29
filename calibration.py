# calibration.py
"""
Calibration System for HeadWave
Personalizes EEG thresholds and baseline detection
"""
import json
import time
import threading
import numpy as np
from typing import Dict, List, Optional, Tuple, Callable
from pathlib import Path
from collections import deque
from dataclasses import dataclass, asdict
from enum import Enum


class CalibrationStep(Enum):
    """Calibration wizard steps"""
    IDLE = "idle"
    BASELINE_EYES_CLOSED = "baseline_eyes_closed"
    BASELINE_EYES_OPEN = "baseline_eyes_open"
    ALPHA_PEAK = "alpha_peak"
    FOCUS_TEST = "focus_test"
    RELAX_TEST = "relax_test"
    COMPLETE = "complete"


@dataclass
class CalibrationProfile:
    """Stores calibration results"""
    name: str
    created_at: str

    # Baseline values (eyes closed, relaxed)
    baseline_delta: float = 0.0
    baseline_theta: float = 0.0
    baseline_alpha: float = 0.0
    baseline_beta: float = 0.0
    baseline_gamma: float = 0.0

    # Personal alpha frequency (8-13 Hz peak)
    peak_alpha_frequency: float = 10.0

    # Thresholds for state detection
    alpha_high_threshold: float = 50.0
    alpha_low_threshold: float = 20.0
    beta_high_threshold: float = 40.0
    beta_low_threshold: float = 15.0
    engagement_threshold: float = 1.0

    # Signal amplitude baseline
    amplitude_baseline: float = 50.0


class CurveShaper:
    """
    Apply curve transformations to normalized values.
    Used for fine-tuning parameter mappings.
    """

    @staticmethod
    def linear(value: float, min_out: float = 0.0, max_out: float = 1.0) -> float:
        """Linear mapping (passthrough with range)"""
        return min_out + value * (max_out - min_out)

    @staticmethod
    def exponential(value: float, exponent: float = 2.0) -> float:
        """Exponential ease-in curve"""
        return pow(max(0, min(1, value)), exponent)

    @staticmethod
    def logarithmic(value: float, base: float = 10.0) -> float:
        """Logarithmic ease-out curve"""
        if value <= 0:
            return 0.0
        return np.log(1 + value * (base - 1)) / np.log(base)

    @staticmethod
    def sigmoid(value: float, steepness: float = 5.0, midpoint: float = 0.5) -> float:
        """S-curve (sigmoid) transformation"""
        x = (value - midpoint) * steepness
        return 1.0 / (1.0 + np.exp(-x))

    @staticmethod
    def threshold(value: float, threshold: float = 0.5,
                  below: float = 0.0, above: float = 1.0) -> float:
        """Binary threshold (gate)"""
        return above if value >= threshold else below

    @staticmethod
    def deadzone(value: float, low: float = 0.1, high: float = 0.9) -> float:
        """Deadzone at extremes, linear in middle"""
        if value < low:
            return 0.0
        elif value > high:
            return 1.0
        else:
            return (value - low) / (high - low)

    @staticmethod
    def invert(value: float) -> float:
        """Invert the value"""
        return 1.0 - max(0, min(1, value))

    @staticmethod
    def smooth_step(value: float) -> float:
        """Hermite smooth step (ease-in-out)"""
        t = max(0, min(1, value))
        return t * t * (3 - 2 * t)

    @staticmethod
    def apply_curve(value: float, curve_type: str, **params) -> float:
        """
        Apply a named curve transformation.

        Args:
            value: Input value (typically 0-1)
            curve_type: 'linear', 'exponential', 'logarithmic', 'sigmoid',
                       'threshold', 'deadzone', 'invert', 'smoothstep'
            **params: Additional parameters for the curve

        Returns:
            Transformed value
        """
        curves = {
            'linear': CurveShaper.linear,
            'exponential': CurveShaper.exponential,
            'logarithmic': CurveShaper.logarithmic,
            'sigmoid': CurveShaper.sigmoid,
            'threshold': CurveShaper.threshold,
            'deadzone': CurveShaper.deadzone,
            'invert': CurveShaper.invert,
            'smoothstep': CurveShaper.smooth_step,
        }

        curve_fn = curves.get(curve_type, CurveShaper.linear)
        try:
            return curve_fn(value, **params)
        except TypeError:
            return curve_fn(value)


class CalibrationWizard:
    """
    Guides user through calibration process.
    Collects baseline data and computes personal thresholds.
    """

    def __init__(self, profiles_dir: str = "calibration"):
        self.profiles_dir = Path(profiles_dir)
        self.profiles_dir.mkdir(parents=True, exist_ok=True)

        # Current calibration state
        self.current_step = CalibrationStep.IDLE
        self.step_progress = 0.0
        self.step_start_time: Optional[float] = None
        self.step_duration = 30.0  # seconds per step

        # Data collection buffers
        self.collected_bands: Dict[str, List[float]] = {
            'delta': [], 'theta': [], 'alpha': [], 'beta': [], 'gamma': []
        }
        self.collected_fft: List[Tuple[List[float], List[float]]] = []

        # Current profile being built
        self.current_profile: Optional[CalibrationProfile] = None

        # Callbacks
        self.on_step_complete: Optional[Callable] = None
        self.on_calibration_complete: Optional[Callable] = None

        self.lock = threading.Lock()

    def start_calibration(self, profile_name: str = "default") -> Dict:
        """
        Start the calibration process.

        Returns:
            Dict with first step instructions
        """
        with self.lock:
            self.current_profile = CalibrationProfile(
                name=profile_name,
                created_at=time.strftime("%Y-%m-%d %H:%M:%S")
            )
            self.current_step = CalibrationStep.BASELINE_EYES_CLOSED
            self.step_start_time = time.time()
            self.step_progress = 0.0

            # Clear collection buffers
            for band in self.collected_bands:
                self.collected_bands[band] = []
            self.collected_fft = []

            return self._get_step_info()

    def cancel_calibration(self):
        """Cancel the current calibration"""
        with self.lock:
            self.current_step = CalibrationStep.IDLE
            self.current_profile = None
            self.step_progress = 0.0

    def process_data(self, band_names: List[str], band_values: List[List[float]],
                     freqs: Optional[List[float]] = None,
                     fft_values: Optional[List[List[float]]] = None) -> Dict:
        """
        Process incoming EEG data during calibration.

        Args:
            band_names: ['delta', 'theta', 'alpha', 'beta', 'gamma']
            band_values: Band power values per channel
            freqs: FFT frequencies (optional)
            fft_values: FFT PSD values (optional)

        Returns:
            Dict with current step status
        """
        if self.current_step == CalibrationStep.IDLE:
            return {'step': 'idle', 'progress': 0}

        with self.lock:
            # Calculate cross-channel averages
            avg_bands = {}
            for i, band in enumerate(band_names):
                values = [ch[i] for ch in band_values if len(ch) > i]
                avg_bands[band] = np.mean(values) if values else 0.0

            # Store band values
            for band, value in avg_bands.items():
                if band in self.collected_bands:
                    self.collected_bands[band].append(value)

            # Store FFT if provided
            if freqs and fft_values:
                self.collected_fft.append((freqs, fft_values[0] if fft_values else []))

            # Update progress
            elapsed = time.time() - self.step_start_time
            self.step_progress = min(elapsed / self.step_duration, 1.0)

            # Check if step is complete
            if self.step_progress >= 1.0:
                self._complete_step()

            return self._get_step_info()

    def _complete_step(self):
        """Process completed step and advance to next"""
        if self.current_step == CalibrationStep.BASELINE_EYES_CLOSED:
            # Store baseline values
            for band in self.collected_bands:
                values = self.collected_bands[band]
                if values:
                    setattr(self.current_profile, f'baseline_{band}',
                            float(np.median(values)))
                self.collected_bands[band] = []

            # Move to alpha peak detection
            self.current_step = CalibrationStep.ALPHA_PEAK
            self.step_start_time = time.time()

        elif self.current_step == CalibrationStep.ALPHA_PEAK:
            # Detect peak alpha frequency from FFT
            self._detect_alpha_peak()

            # Calculate thresholds based on baseline
            self._calculate_thresholds()

            # Complete calibration
            self.current_step = CalibrationStep.COMPLETE

            if self.on_calibration_complete:
                self.on_calibration_complete(self.current_profile)

    def _detect_alpha_peak(self):
        """Detect personal alpha frequency from collected FFT data"""
        if not self.collected_fft or not self.current_profile:
            return

        # Average all FFT samples
        all_freqs = None
        all_psd = []

        for freqs, psd in self.collected_fft:
            if all_freqs is None:
                all_freqs = freqs
            all_psd.append(psd)

        if not all_psd or all_freqs is None:
            return

        avg_psd = np.mean(all_psd, axis=0)

        # Find peak in alpha range (8-13 Hz)
        alpha_mask = (np.array(all_freqs) >= 8) & (np.array(all_freqs) <= 13)
        alpha_freqs = np.array(all_freqs)[alpha_mask]
        alpha_psd = avg_psd[alpha_mask] if len(avg_psd) > sum(alpha_mask) else []

        if len(alpha_psd) > 0:
            peak_idx = np.argmax(alpha_psd)
            self.current_profile.peak_alpha_frequency = float(alpha_freqs[peak_idx])

    def _calculate_thresholds(self):
        """Calculate personal thresholds based on baseline"""
        if not self.current_profile:
            return

        # Alpha thresholds
        baseline_alpha = self.current_profile.baseline_alpha
        self.current_profile.alpha_high_threshold = baseline_alpha * 1.5
        self.current_profile.alpha_low_threshold = baseline_alpha * 0.5

        # Beta thresholds
        baseline_beta = self.current_profile.baseline_beta
        self.current_profile.beta_high_threshold = baseline_beta * 1.5
        self.current_profile.beta_low_threshold = baseline_beta * 0.5

        # Engagement threshold
        if self.current_profile.baseline_alpha > 0:
            baseline_engagement = (self.current_profile.baseline_beta /
                                   (self.current_profile.baseline_alpha +
                                    self.current_profile.baseline_theta + 0.001))
            self.current_profile.engagement_threshold = baseline_engagement * 1.2

    def _get_step_info(self) -> Dict:
        """Get current step information"""
        instructions = {
            CalibrationStep.IDLE: "Ready to start calibration",
            CalibrationStep.BASELINE_EYES_CLOSED: "Close your eyes and relax for 30 seconds",
            CalibrationStep.BASELINE_EYES_OPEN: "Open your eyes and look at the screen",
            CalibrationStep.ALPHA_PEAK: "Close your eyes again to detect your alpha rhythm",
            CalibrationStep.FOCUS_TEST: "Focus on a mental task (count backwards from 100)",
            CalibrationStep.RELAX_TEST: "Relax and let your mind wander",
            CalibrationStep.COMPLETE: "Calibration complete!",
        }

        return {
            'step': self.current_step.value,
            'progress': self.step_progress,
            'instruction': instructions.get(self.current_step, ""),
            'time_remaining': max(0, self.step_duration - (time.time() - (self.step_start_time or time.time())))
        }

    def save_profile(self, profile: Optional[CalibrationProfile] = None) -> str:
        """
        Save calibration profile to disk.

        Returns:
            Path to saved file
        """
        profile = profile or self.current_profile
        if not profile:
            raise ValueError("No profile to save")

        filename = f"profile_{profile.name}.json"
        filepath = self.profiles_dir / filename

        with open(filepath, 'w') as f:
            json.dump(asdict(profile), f, indent=2)

        return str(filepath)

    def load_profile(self, name: str) -> CalibrationProfile:
        """Load a calibration profile"""
        filepath = self.profiles_dir / f"profile_{name}.json"
        if not filepath.exists():
            raise FileNotFoundError(f"Profile '{name}' not found")

        with open(filepath) as f:
            data = json.load(f)
            return CalibrationProfile(**data)

    def list_profiles(self) -> List[str]:
        """List available calibration profiles"""
        profiles = []
        for f in self.profiles_dir.glob("profile_*.json"):
            name = f.stem.replace("profile_", "")
            profiles.append(name)
        return profiles

    def get_status(self) -> Dict:
        """Get current calibration status"""
        return self._get_step_info()

    def is_calibrating(self) -> bool:
        """Check if calibration is in progress"""
        return self.current_step not in [CalibrationStep.IDLE, CalibrationStep.COMPLETE]
