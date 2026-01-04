from typing import List, Dict, Optional
from pythonosc.udp_client import SimpleUDPClient
import logging
import numpy as np

logger = logging.getLogger(__name__)


class OSCSender:
    def __init__(self, ip: str = "127.0.0.1", port: int = 9000):
        self.ip = ip
        self.port = port
        self.client: Optional[SimpleUDPClient] = None
        self.enabled: bool = False
        self.send_raw: bool = True
        self.send_bands_enabled: bool = False
        self.max_floats_per_message = 1000

        self.band_ranges = {
            'delta': (0.5, 100.0),
            'theta': (0.5, 50.0),
            'alpha': (1.0, 100.0),
            'beta': (0.5, 30.0),
            'gamma': (0.5, 20.0)
        }

    def configure(self, ip: str, port: int, enabled: bool,
                  send_raw: bool, send_bands: bool):
        self.ip = ip
        self.port = port
        self.enabled = enabled
        self.send_raw = send_raw
        self.send_bands_enabled = send_bands
        if enabled:
            self.client = SimpleUDPClient(self.ip, self.port)
        else:
            self.client = None

    def _ensure_client(self):
        if not self.enabled or self.client is None:
            return False
        return True

    def send_timeseries(self, channel_names: List[str], data: List[List[float]]):
        if not self._ensure_client() or not self.send_raw:
            return

        try:
            for ch_idx, ch_data in enumerate(data):
                ch_name = channel_names[ch_idx] if ch_idx < len(channel_names) else f"CH{ch_idx+1}"

                if len(ch_data) <= self.max_floats_per_message:
                    self.client.send_message(f"/headwave/raw/{ch_name}", ch_data)
                else:
                    for chunk_idx, i in enumerate(range(0, len(ch_data), self.max_floats_per_message)):
                        chunk = ch_data[i:i + self.max_floats_per_message]
                        self.client.send_message(f"/headwave/raw/{ch_name}/chunk{chunk_idx}", chunk)

            all_data = []
            for ch_data in data:
                all_data.extend(ch_data)

            if len(all_data) <= self.max_floats_per_message:
                self.client.send_message("/headwave/raw", all_data)
            else:
                for chunk_idx, i in enumerate(range(0, len(all_data), self.max_floats_per_message)):
                    chunk = all_data[i:i + self.max_floats_per_message]
                    self.client.send_message(f"/headwave/raw/chunk{chunk_idx}", chunk)

        except Exception as e:
            logger.error(f"Failed to send timeseries OSC: {e}")

    def _normalize_band_value(self, band_name: str, value: float) -> float:
        min_val, max_val = self.band_ranges.get(band_name.lower(), (0.0, 100.0))
        normalized = (value - min_val) / (max_val - min_val)
        return max(0.0, min(1.0, normalized))

    def send_bands(
        self,
        channel_names: List[str],
        bands: List[str],
        values: List[List[float]],
    ):
        if not self._ensure_client() or not self.send_bands_enabled:
            return

        try:
            n_channels = len(values)
            n_bands = len(bands)

            values_array = np.array(values)

            for ch_idx, ch_vals in enumerate(values):
                ch_name = channel_names[ch_idx] if ch_idx < len(channel_names) else f"CH{ch_idx+1}"

                for band_idx, band_name in enumerate(bands):
                    abs_value = ch_vals[band_idx]

                    self.client.send_message(f"/headwave/bands/{ch_name}/{band_name}", abs_value)

                    rel_value = self._normalize_band_value(band_name, abs_value)
                    self.client.send_message(f"/headwave/bands/{ch_name}/{band_name}-relative", rel_value)

            for band_idx, band_name in enumerate(bands):
                band_values = values_array[:, band_idx]

                mean_val = float(np.mean(band_values))
                self.client.send_message(f"/headwave/bands/{band_name}", mean_val)

                max_val = float(np.max(band_values))
                min_val = float(np.min(band_values))
                self.client.send_message(f"/headwave/bands/{band_name}/max", max_val)
                self.client.send_message(f"/headwave/bands/{band_name}/min", min_val)

            for band_idx, band_name in enumerate(bands):
                abs_values = [float(values[ch_idx][band_idx]) for ch_idx in range(n_channels)]
                self.client.send_message(f"/headwave/elements/{band_name}_absolute", abs_values)

                rel_values = [self._normalize_band_value(band_name, values[ch_idx][band_idx])
                             for ch_idx in range(n_channels)]
                self.client.send_message(f"/headwave/elements/{band_name}_relative", rel_values)

        except Exception as e:
            logger.error(f"Failed to send bands OSC: {e}")
