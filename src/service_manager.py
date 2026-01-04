from typing import Optional, List, Tuple, Dict, Any
import glob
import sys

from .openbci_service import GanglionService
from .simulator_service import SimulatorService


class ServiceManager:

    def __init__(self):
        self.hardware_service = GanglionService()
        self.simulator_service = SimulatorService()
        self.use_simulator = False

    @property
    def active(self):
        return self.simulator_service if self.use_simulator else self.hardware_service

    def set_simulator_mode(self, enabled: bool):
        if self.hardware_service.streaming:
            self.hardware_service.stop_stream()
        if self.simulator_service.streaming:
            self.simulator_service.stop_stream()
        self.use_simulator = enabled

    def connect(self, serial_port: str = "", mac_address: str = "", timeout: int = 15):
        if self.use_simulator:
            self.active.connect()
        else:
            self.active.connect(serial_port=serial_port, mac_address=mac_address, timeout=timeout)

    def disconnect(self):
        self.active.disconnect()

    def start_stream(self, buffer_size: int = 45000):
        self.active.start_stream(buffer_size=buffer_size)

    def stop_stream(self):
        self.active.stop_stream()

    def get_status(self) -> Dict[str, Any]:
        return {
            "connected": self.active.connected,
            "streaming": self.active.streaming,
            "simulator": self.use_simulator,
        }

    def set_simulator_brain_mode(self, mode: str):
        self.simulator_service.set_mode(mode)

    def send_test_signal_on(self):
        if not self.use_simulator:
            self.hardware_service.send_test_signal_on()

    def send_test_signal_off(self):
        if not self.use_simulator:
            self.hardware_service.send_test_signal_off()

    def configure_osc(self, ip: str, port: int, enabled: bool, send_raw: bool, send_bands: bool):
        self.hardware_service.configure_osc(ip, port, enabled, send_raw, send_bands)

    def configure_smoothing(self, enabled: bool, alpha: float = 0.3):
        self.active.configure_smoothing(enabled=enabled, alpha=alpha)

    def configure_artifact_detection(self, enabled: bool, amplitude_threshold: float = 100.0,
                                       zscore_threshold: float = 5.0, high_freq_ratio: float = 0.2):
        self.active.configure_artifact_detection(
            enabled=enabled,
            amplitude_threshold=amplitude_threshold,
            zscore_threshold=zscore_threshold,
            high_freq_ratio=high_freq_ratio
        )

    def get_timeseries_window(self, window_sec: float = 4.0, max_points: int = 512):
        return self.active.get_timeseries_window(window_sec=window_sec, max_points=max_points)

    def get_fft_spectrum(self, window_sec: float = 4.0, min_freq: float = 0.5, max_freq: float = 40.0):
        return self.active.get_fft_spectrum(window_sec=window_sec, min_freq=min_freq, max_freq=max_freq)

    def get_band_powers(self, window_sec: float = 4.0, use_relative: bool = True):
        return self.active.get_band_powers(window_sec=window_sec, use_relative=use_relative)

    def get_engagement_index(self, window_sec: float = 4.0):
        return self.active.get_engagement_index(window_sec=window_sec)

    def osc_push_timeseries(self, channels: List[str], data: List[List[float]]):
        if not self.use_simulator:
            self.hardware_service.osc_push_timeseries(channels, data)

    def osc_push_bands(self, channels: List[str], band_names: List[str], values: List[List[float]]):
        if not self.use_simulator:
            self.hardware_service.osc_push_bands(channels, band_names, values)

    @staticmethod
    def list_ports() -> Dict[str, Any]:
        ports = []
        bluetooth_devices = []

        if sys.platform == "darwin":
            ports.extend(glob.glob("/dev/tty.usbmodem*"))
            ports.extend(glob.glob("/dev/tty.usbserial*"))
            ports.extend(glob.glob("/dev/cu.usbmodem*"))
            ports.extend(glob.glob("/dev/cu.usbserial*"))

            try:
                import subprocess
                result = subprocess.run(
                    ["system_profiler", "SPBluetoothDataType"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                lines = result.stdout.split('\n')

                for i, line in enumerate(lines):
                    if 'ganglion' in line.lower():
                        for j in range(max(0, i-5), min(len(lines), i+10)):
                            if 'Address:' in lines[j]:
                                mac = lines[j].split('Address:')[1].strip()
                                bluetooth_devices.append({
                                    "name": line.strip().rstrip(':'),
                                    "mac": mac,
                                    "type": "bluetooth"
                                })
                                break
            except Exception:
                pass

        elif sys.platform.startswith("linux"):
            ports.extend(glob.glob("/dev/ttyUSB*"))
            ports.extend(glob.glob("/dev/ttyACM*"))

        elif sys.platform == "win32":
            try:
                import serial.tools.list_ports
                detected = serial.tools.list_ports.comports()
                ports = [port.device for port in detected]
            except ImportError:
                pass

        ports = sorted(list(set(ports)))

        return {
            "ports": ports,
            "bluetooth": bluetooth_devices,
            "count": len(ports) + len(bluetooth_devices),
            "hint": "For Bluetooth: Pair your Ganglion in System Settings first" if len(bluetooth_devices) == 0 and sys.platform == "darwin" else None
        }
