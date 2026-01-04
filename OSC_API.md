# HeadWave OSC API Documentation

HeadWave streams real-time EEG and computer vision data via Open Sound Control (OSC) protocol. This document describes all available OSC messages and their formats.

## Table of Contents
- [Configuration](#configuration)
- [EEG Messages](#eeg-messages)
  - [Raw Timeseries](#raw-timeseries)
  - [Band Powers](#band-powers)
- [Computer Vision Messages](#computer-vision-messages)
- [Example Usage](#example-usage)
- [Normalization Details](#normalization-details)

---

## Configuration

**Default OSC Settings:**
- IP Address: `127.0.0.1` (localhost)
- Port: `9000`
- Protocol: UDP

You can configure these settings in the HeadWave web interface.

---

## EEG Messages

All EEG messages use the `/headwave` namespace.

### Raw Timeseries

Raw EEG samples in microvolts (µV). The Ganglion board has 4 channels.

#### Per-Channel Messages
Individual channel data as float arrays:

- **`/headwave/raw/CH1`** - Channel 1 samples `[float, float, ...]`
- **`/headwave/raw/CH2`** - Channel 2 samples `[float, float, ...]`
- **`/headwave/raw/CH3`** - Channel 3 samples `[float, float, ...]`
- **`/headwave/raw/CH4`** - Channel 4 samples `[float, float, ...]`

**Format:** Array of floats (sample values in µV)
**Update rate:** Depends on window settings (typically 5-10 Hz)

#### Combined Message
All channels concatenated into a single message:

- **`/headwave/raw`** - All channel data `[CH1_samples..., CH2_samples..., CH3_samples..., CH4_samples...]`

**Format:** Flattened array of all channel samples
**Use case:** When you want all channel data in one message

#### Chunked Messages
For large datasets exceeding UDP limits (~1000 floats), data is automatically chunked:

- **`/headwave/raw/CH1/chunk0`**, **`/headwave/raw/CH1/chunk1`**, etc.
- **`/headwave/raw/chunk0`**, **`/headwave/raw/chunk1`**, etc. (for combined)

**Format:** Array of floats (partial data)
**Note:** Typically not needed unless using very large window sizes

---

### Band Powers

Frequency band power analysis. Standard EEG bands:
- **Delta:** 0.5-4 Hz (deep sleep, unconscious processes)
- **Theta:** 4-8 Hz (drowsiness, meditation, creativity)
- **Alpha:** 8-13 Hz (relaxed, calm, eyes closed)
- **Beta:** 13-30 Hz (active thinking, focus, alertness)
- **Gamma:** 30-50 Hz (high-level cognition, perception)

#### Per-Channel Absolute Values
Band power in µV² for each channel:

**Channel 1:**
- **`/headwave/bands/CH1/delta`** - Delta power (float, µV²)
- **`/headwave/bands/CH1/theta`** - Theta power (float, µV²)
- **`/headwave/bands/CH1/alpha`** - Alpha power (float, µV²)
- **`/headwave/bands/CH1/beta`** - Beta power (float, µV²)
- **`/headwave/bands/CH1/gamma`** - Gamma power (float, µV²)

**Channels 2-4:** Same pattern as CH1 (replace `CH1` with `CH2`, `CH3`, `CH4`)

**Format:** Single float value
**Unit:** µV² (microvolts squared)
**Range:** 0 to ~100+ (depends on signal strength)

#### Per-Channel Relative Values (Normalized 0-1)
Normalized band power based on research-standard ranges:

**Channel 1:**
- **`/headwave/bands/CH1/delta-relative`** - Normalized delta (float, 0-1)
- **`/headwave/bands/CH1/theta-relative`** - Normalized theta (float, 0-1)
- **`/headwave/bands/CH1/alpha-relative`** - Normalized alpha (float, 0-1)
- **`/headwave/bands/CH1/beta-relative`** - Normalized beta (float, 0-1)
- **`/headwave/bands/CH1/gamma-relative`** - Normalized gamma (float, 0-1)

**Channels 2-4:** Same pattern as CH1

**Format:** Single float value
**Range:** 0.0 to 1.0 (clamped)
**Use case:** Easier to work with for mappings, sonification, visualizations

#### Cross-Channel Averages
Mean band power across all 4 channels:

- **`/headwave/bands/delta`** - Average delta across CH1-4 (float, µV²)
- **`/headwave/bands/theta`** - Average theta across CH1-4 (float, µV²)
- **`/headwave/bands/alpha`** - Average alpha across CH1-4 (float, µV²)
- **`/headwave/bands/beta`** - Average beta across CH1-4 (float, µV²)
- **`/headwave/bands/gamma`** - Average gamma across CH1-4 (float, µV²)

**Format:** Single float value
**Unit:** µV²
**Calculation:** `mean([CH1, CH2, CH3, CH4])`

#### Cross-Channel Statistics
Maximum and minimum values across all 4 channels:

**Maximum values:**
- **`/headwave/bands/delta/max`** - Highest delta value (float, µV²)
- **`/headwave/bands/theta/max`** - Highest theta value (float, µV²)
- **`/headwave/bands/alpha/max`** - Highest alpha value (float, µV²)
- **`/headwave/bands/beta/max`** - Highest beta value (float, µV²)
- **`/headwave/bands/gamma/max`** - Highest gamma value (float, µV²)

**Minimum values:**
- **`/headwave/bands/delta/min`** - Lowest delta value (float, µV²)
- **`/headwave/bands/theta/min`** - Lowest theta value (float, µV²)
- **`/headwave/bands/alpha/min`** - Lowest alpha value (float, µV²)
- **`/headwave/bands/beta/min`** - Lowest beta value (float, µV²)
- **`/headwave/bands/gamma/min`** - Lowest gamma value (float, µV²)

**Format:** Single float value
**Unit:** µV²
**Use case:** Understanding variation across channels

#### Muse-Compatible Combined Messages (for legacy compatibility)

For compatibility with applications designed for Muse headband, we provide combined messages that send all 4 channel values in a single OSC message:

**Absolute values (all 4 channels):**
- **`/headwave/elements/delta_absolute`** - [CH1, CH2, CH3, CH4] (array of 4 floats, µV²)
- **`/headwave/elements/theta_absolute`** - [CH1, CH2, CH3, CH4] (array of 4 floats, µV²)
- **`/headwave/elements/alpha_absolute`** - [CH1, CH2, CH3, CH4] (array of 4 floats, µV²)
- **`/headwave/elements/beta_absolute`** - [CH1, CH2, CH3, CH4] (array of 4 floats, µV²)
- **`/headwave/elements/gamma_absolute`** - [CH1, CH2, CH3, CH4] (array of 4 floats, µV²)

**Relative values (all 4 channels, normalized 0-1):**
- **`/headwave/elements/delta_relative`** - [CH1, CH2, CH3, CH4] (array of 4 floats, 0-1)
- **`/headwave/elements/theta_relative`** - [CH1, CH2, CH3, CH4] (array of 4 floats, 0-1)
- **`/headwave/elements/alpha_relative`** - [CH1, CH2, CH3, CH4] (array of 4 floats, 0-1)
- **`/headwave/elements/beta_relative`** - [CH1, CH2, CH3, CH4] (array of 4 floats, 0-1)
- **`/headwave/elements/gamma_relative`** - [CH1, CH2, CH3, CH4] (array of 4 floats, 0-1)

**Format:** Array of 4 floats
**Use case:** Drop-in replacement for Muse applications (e.g., Csound, Max/MSP patches designed for Muse)

**Note:** Ganglion has 4 channels vs Muse's 6 channels. Applications expecting 6 channels will need to be adapted to use only the first 4 values.

---

## Computer Vision Messages

All CV messages use the `/cv` namespace and are normalized to 0-1 range.

Facial feature tracking from webcam using MediaPipe:

- **`/cv/mouth_openness`** - Mouth openness (float, 0-1)
  - 0 = closed, 1 = fully open

- **`/cv/brow_raise`** - Eyebrow raise (float, 0-1)
  - 0 = neutral, 1 = raised

- **`/cv/head_yaw`** - Head rotation left/right (float, normalized)
  - Left < 0.5 < Right

- **`/cv/head_roll`** - Head tilt left/right (float, normalized)
  - Left tilt < 0.5 < Right tilt

- **`/cv/head_pitch`** - Head tilt up/down (float, normalized)
  - Down < 0.5 < Up

- **`/cv/smile_curvature`** - Smile intensity (float, 0-1)
  - 0 = neutral, 1 = full smile

**Format:** Single float value
**Range:** 0.0 to 1.0
**Update rate:** Depends on camera framerate (typically 15-30 Hz)

---

## Example Usage

### Python (using python-osc)

```python
from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import BlockingOSCUDPServer

def handle_delta(address, *args):
    avg_delta = args[0]
    print(f"Average Delta power: {avg_delta:.2f} µV²")

def handle_alpha_ch1(address, *args):
    alpha = args[0]
    print(f"CH1 Alpha (relative): {alpha:.3f}")

def handle_mouth(address, *args):
    mouth = args[0]
    print(f"Mouth openness: {mouth:.3f}")

dispatcher = Dispatcher()
dispatcher.map("/headwave/bands/delta", handle_delta)
dispatcher.map("/headwave/bands/CH1/alpha-relative", handle_alpha_ch1)
dispatcher.map("/cv/mouth_openness", handle_mouth)

server = BlockingOSCUDPServer(("127.0.0.1", 9000), dispatcher)
server.serve_forever()
```

### Max/MSP

```
[udpreceive 9000]
|
[OSC-route /headwave /cv]
|         |
|         [route mouth_openness brow_raise head_yaw head_roll smile_curvature]
|
[route raw bands]
       |
       [route delta theta alpha beta gamma]
       |
       [route max min] (for statistics)
```

### SuperCollider

```supercollider
OSCdef(\headwave_delta, { |msg|
    var avgDelta = msg[1];
    ("Average Delta: " ++ avgDelta).postln;
}, '/headwave/bands/delta');

OSCdef(\headwave_alpha_ch1, { |msg|
    var alpha = msg[1];
    ("CH1 Alpha (relative): " ++ alpha).postln;
}, '/headwave/bands/CH1/alpha-relative');

OSCdef(\cv_mouth, { |msg|
    var mouth = msg[1];
    ("Mouth: " ++ mouth).postln;
}, '/cv/mouth_openness');

// Muse-compatible combined message
OSCdef(\headwave_theta_all, { |msg|
    var ch1, ch2, ch3, ch4;
    #ch1, ch2, ch3, ch4 = msg[1..4];
    ("Theta - CH1:" ++ ch1 ++ "CH2:" ++ ch2 ++ "CH3:" ++ ch3 ++ "CH4:" ++ ch4).postln;
}, '/headwave/elements/theta_absolute');
```

### Csound

```csound
gihandle OSCinit 9000

; Listen to Muse-compatible combined messages (4 channels)
kk OSClisten gihandle, "/headwave/elements/theta_absolute", "ffff", gkf1, gkf2, gkf3, gkf4
kk OSClisten gihandle, "/headwave/elements/alpha_relative", "ffff", gkf1, gkf2, gkf3, gkf4
```

### TouchDesigner

Use the `OSC In CHOP`:
- Network Address: `127.0.0.1`
- Network Port: `9000`
- Message: `/headwave/bands/alpha` (or any other message path)

The incoming OSC values will appear as channels in the CHOP.

---

## Normalization Details

### Band Power Normalization

Relative values use fixed ranges based on neuroscience research for typical adult EEG during rest and active states:

| Band  | Frequency Range | Min (µV²) | Max (µV²) |
|-------|----------------|-----------|-----------|
| Delta | 0.5-4 Hz       | 0.5       | 100.0     |
| Theta | 4-8 Hz         | 0.5       | 50.0      |
| Alpha | 8-13 Hz        | 1.0       | 100.0     |
| Beta  | 13-30 Hz       | 0.5       | 30.0      |
| Gamma | 30-50 Hz       | 0.5       | 20.0      |

**Normalization formula:**
```
relative_value = clamp((absolute_value - min) / (max - min), 0, 1)
```

Values outside the range are clamped to [0, 1].

### CV Feature Normalization

CV features are normalized based on MediaPipe landmark geometry:
- **Mouth openness:** Ratio of vertical distance to neutral state
- **Brow raise:** Vertical displacement of eyebrow landmarks
- **Head angles:** Rotation matrices converted to normalized angles
- **Smile:** Curvature of mouth corners relative to center

All values are normalized to 0-1 range for consistency.

---

## Testing

Use the included test receiver to verify OSC messages:

```bash
python test_osc_receiver.py
```

This will display all incoming OSC messages with visual feedback.

For custom port:
```bash
python test_osc_receiver.py --port 9001
```

---

## Performance Notes

- **Message Rate:** Band powers update at your configured refresh rate (typically 5-10 Hz)
- **UDP Size Limits:** Messages automatically chunk if they exceed ~1000 floats
- **Bandwidth:** With all messages enabled, expect ~10-50 KB/s depending on settings
- **Latency:** Typically <10ms from data acquisition to OSC transmission

---

## Troubleshooting

**Not receiving messages?**
1. Check OSC is enabled in the HeadWave web interface
2. Verify IP and port settings match your receiver
3. Check firewall settings allow UDP on the specified port
4. Use the test receiver script to verify data flow

**Messages seem delayed?**
- Reduce window length in HeadWave settings
- Increase refresh rate
- Check CPU usage isn't maxed out

**Getting chunked messages unexpectedly?**
- Reduce window length to decrease sample count
- This is normal for very large window sizes (>4 seconds at 200 Hz)

---

## Version

**API Version:** 2.0
**Last Updated:** December 2025
**Compatible with:** HeadWave v1.0+
