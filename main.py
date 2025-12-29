# main.py
from typing import Optional
import glob
import sys
import asyncio
import io

import numpy as np

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from openbci_service import GanglionService
from simulator_service import SimulatorService

# Try to import camera service (optional if mediapipe unavailable)
try:
    from camera_service import CameraService
    camera_service = CameraService()
    CAMERA_AVAILABLE = True
except Exception as e:
    print(f"[WARNING] Camera service unavailable: {e}")
    camera_service = None
    CAMERA_AVAILABLE = False

# Import session recorder
try:
    from session_recorder import SessionRecorder
    session_recorder = SessionRecorder()
    RECORDING_AVAILABLE = True
except Exception as e:
    print(f"[WARNING] Session recorder unavailable: {e}")
    session_recorder = None
    RECORDING_AVAILABLE = False

# Import MIDI sender
try:
    from midi_sender import MIDISender
    midi_sender = MIDISender()
    MIDI_AVAILABLE = True
except Exception as e:
    print(f"[WARNING] MIDI sender unavailable: {e}")
    midi_sender = None
    MIDI_AVAILABLE = False

# Import calibration wizard
try:
    from calibration import CalibrationWizard, CurveShaper
    calibration_wizard = CalibrationWizard()
    CALIBRATION_AVAILABLE = True
except Exception as e:
    print(f"[WARNING] Calibration unavailable: {e}")
    calibration_wizard = None
    CALIBRATION_AVAILABLE = False

app = FastAPI(title="HeadWave - Biosignal Creative Platform")

# Static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Templates
templates = Jinja2Templates(directory="templates")

# Global service instances
service = GanglionService()
simulator = SimulatorService()

# Mode flag
USE_SIMULATOR = False


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# -------- REST API for control --------

class ConnectParams:
    serial_port: Optional[str]
    mac_address: Optional[str]
    timeout: int


@app.post("/api/connect")
async def api_connect(payload: dict):
    active_service = simulator if USE_SIMULATOR else service
    
    if USE_SIMULATOR:
        # Simulator doesn't need port/MAC
        try:
            active_service.connect()
            return {"status": "ok", "simulator": True}
        except Exception as e:
            return JSONResponse({"status": "error", "message": str(e)}, status_code=500)
    else:
        # Real hardware
        serial_port = payload.get("serial_port", "")
        mac_address = payload.get("mac_address", "")
        timeout = int(payload.get("timeout", 15))
        try:
            active_service.connect(serial_port=serial_port, mac_address=mac_address, timeout=timeout)
            return {"status": "ok", "simulator": False}
        except Exception as e:
            return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


@app.post("/api/disconnect")
async def api_disconnect():
    active_service = simulator if USE_SIMULATOR else service
    active_service.disconnect()
    return {"status": "ok"}


@app.get("/api/status")
async def api_status():
    active_service = simulator if USE_SIMULATOR else service
    return {
        "connected": active_service.connected,
        "streaming": active_service.streaming,
        "simulator": USE_SIMULATOR,
    }


@app.post("/api/use_simulator")
async def api_use_simulator(payload: dict):
    """Switch between real hardware and simulator"""
    global USE_SIMULATOR
    use_sim = bool(payload.get("enabled", True))
    USE_SIMULATOR = use_sim
    
    # Stop any active streams when switching
    if service.streaming:
        service.stop_stream()
    if simulator.streaming:
        simulator.stop_stream()
        
    return {
        "status": "ok",
        "simulator": USE_SIMULATOR,
        "message": "Simulator enabled" if USE_SIMULATOR else "Real hardware enabled"
    }


@app.post("/api/simulator/mode")
async def api_simulator_mode(payload: dict):
    """Change simulator mode (normal, meditation, focused, drowsy)"""
    mode = payload.get("mode", "normal")
    simulator.set_mode(mode)
    return {
        "status": "ok",
        "mode": mode
    }


@app.get("/api/ports")
async def api_list_ports():
    """
    List available serial ports and Bluetooth devices for OpenBCI.
    Returns both serial ports and Bluetooth MAC addresses.
    """
    ports = []
    bluetooth_devices = []

    if sys.platform == "darwin":  # macOS
        # Look for USB serial devices (BLED112 dongle)
        ports.extend(glob.glob("/dev/tty.usbmodem*"))
        ports.extend(glob.glob("/dev/tty.usbserial*"))
        ports.extend(glob.glob("/dev/cu.usbmodem*"))
        ports.extend(glob.glob("/dev/cu.usbserial*"))

        # Check for Bluetooth Ganglion devices
        try:
            import subprocess
            result = subprocess.run(
                ["system_profiler", "SPBluetoothDataType"],
                capture_output=True,
                text=True,
                timeout=5
            )
            lines = result.stdout.split('\n')

            # Look for Ganglion devices
            for i, line in enumerate(lines):
                if 'ganglion' in line.lower():
                    # Look for MAC address in nearby lines
                    for j in range(max(0, i-5), min(len(lines), i+10)):
                        if 'Address:' in lines[j]:
                            mac = lines[j].split('Address:')[1].strip()
                            bluetooth_devices.append({
                                "name": line.strip().rstrip(':'),
                                "mac": mac,
                                "type": "bluetooth"
                            })
                            break
        except Exception as e:
            print(f"Bluetooth scan error: {e}")

    elif sys.platform.startswith("linux"):  # Linux
        ports.extend(glob.glob("/dev/ttyUSB*"))
        ports.extend(glob.glob("/dev/ttyACM*"))
    elif sys.platform == "win32":  # Windows
        import serial.tools.list_ports
        detected = serial.tools.list_ports.comports()
        ports = [port.device for port in detected]

    # Remove duplicates and sort
    ports = sorted(list(set(ports)))

    return {
        "ports": ports,
        "bluetooth": bluetooth_devices,
        "count": len(ports) + len(bluetooth_devices),
        "hint": "For Bluetooth: Pair your Ganglion in System Settings → Bluetooth first" if len(bluetooth_devices) == 0 and sys.platform == "darwin" else None
    }


@app.post("/api/start")
async def api_start(payload: dict):
    active_service = simulator if USE_SIMULATOR else service
    try:
        buffer_size = int(payload.get("buffer_size", 45000))
        active_service.start_stream(buffer_size=buffer_size)
        return {"status": "ok", "simulator": USE_SIMULATOR}
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


@app.post("/api/stop")
async def api_stop():
    active_service = simulator if USE_SIMULATOR else service
    active_service.stop_stream()
    return {"status": "ok"}


@app.post("/api/test_signal")
async def api_test_signal(payload: dict):
    on = bool(payload.get("on", True))
    if on:
        service.send_test_signal_on()
    else:
        service.send_test_signal_off()
    return {"status": "ok"}


@app.post("/api/osc_config")
async def api_osc_config(payload: dict):
    ip = payload.get("ip", "127.0.0.1")
    port = int(payload.get("port", 9000))
    enabled = bool(payload.get("enabled", False))
    send_raw = bool(payload.get("send_raw", True))
    send_bands = bool(payload.get("send_bands", False))
    service.configure_osc(ip, port, enabled, send_raw, send_bands)
    # Also configure camera OSC if available
    if CAMERA_AVAILABLE and camera_service:
        camera_service.configure_osc(ip, port, enabled)
    return {"status": "ok"}


@app.post("/api/assistant/chat")
async def api_assistant_chat(payload: dict):
    """
    AI Assistant endpoint using Groq API for fast LLM inference.
    Requires GROQ_API_KEY environment variable to be set.
    Get your free API key at: https://console.groq.com
    """
    message = payload.get("message", "")
    if not message:
        return JSONResponse({"status": "error", "message": "No message provided"}, status_code=400)
    
    try:
        import os
        from groq import Groq
        
        # Check for API key
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            return JSONResponse(
                {
                    "status": "error",
                    "message": "Groq API key not found. Please set GROQ_API_KEY environment variable.\n\nGet your free API key at: https://console.groq.com"
                },
                status_code=503
            )
        
        # System prompt with HeadWave knowledge
        system_prompt = """You are an AI assistant for HeadWave, a real-time EEG visualization and biosignal creative platform.

Key Features:
- Real-time EEG streaming from OpenBCI Ganglion (4 channels)
- Multiple visualization modes: Time Series, FFT, Frequency Bands, Camera/FaceSynth
- OSC output for integration with creative applications (Max/MSP, TouchDesigner, Ableton, etc.)
- Computer vision facial feature tracking via MediaPipe

EEG Frequency Bands:
- Delta (0.5-4 Hz): Deep sleep, unconscious processes
- Theta (4-8 Hz): Drowsiness, meditation, creativity
- Alpha (8-13 Hz): Relaxed, calm, eyes closed
- Beta (13-30 Hz): Active thinking, focus, alertness
- Gamma (30-50 Hz): High-level cognition, perception

OSC API:
- Raw timeseries: /headwave/raw/CH1, /headwave/raw/CH2, etc.
- Band powers: /headwave/bands/CH1/delta, /headwave/bands/alpha, etc.
- Relative values (0-1): /headwave/bands/CH1/alpha-relative, etc.
- CV features: /cv/mouth_openness, /cv/head_yaw, /cv/smile_curvature, etc.

You can answer questions about:
- How to use HeadWave
- EEG signal interpretation
- OSC API endpoints and data formats
- Integration with creative coding tools
- Troubleshooting and best practices

Be concise, helpful, and technical when appropriate."""

        # Call Groq API
        client = Groq(api_key=api_key)
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message}
            ],
            model="llama-3.3-70b-versatile",  # Fast and powerful model
            temperature=0.7,
            max_tokens=1024,
        )
        
        response_text = chat_completion.choices[0].message.content
        return {"status": "ok", "response": response_text}
                
    except Exception as e:
        return JSONResponse(
            {"status": "error", "message": f"Error: {str(e)}"},
            status_code=500
        )


# -------- Camera API --------

@app.post("/api/camera/start")
async def api_camera_start(payload: dict):
    if not CAMERA_AVAILABLE or camera_service is None:
        return JSONResponse(
            {"status": "error", "message": "Camera service unavailable. MediaPipe not installed."},
            status_code=503
        )
    try:
        camera_index = int(payload.get("camera_index", 0))
        camera_service.start_camera(camera_index=camera_index)
        return {"status": "ok"}
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


@app.post("/api/camera/stop")
async def api_camera_stop():
    if not CAMERA_AVAILABLE or camera_service is None:
        return {"status": "ok"}
    camera_service.stop_camera()
    return {"status": "ok"}


@app.get("/api/camera/status")
async def api_camera_status():
    if not CAMERA_AVAILABLE or camera_service is None:
        return {"running": False, "streaming": False, "available": False}
    return {
        "running": camera_service.running,
        "streaming": camera_service.streaming,
        "available": True
    }


@app.get("/api/camera/features")
async def api_camera_features():
    """Get the latest facial features"""
    if not CAMERA_AVAILABLE or camera_service is None:
        return {"features": {}}
    features = camera_service.get_latest_features()
    return {"features": features}


# -------- Smoothing & Signal Processing API --------

@app.post("/api/smoothing/config")
async def api_smoothing_config(payload: dict):
    """Configure smoothing parameters for EEG data"""
    active_service = simulator if USE_SIMULATOR else service

    enabled = payload.get("enabled", True)
    alpha = float(payload.get("alpha", 0.3))

    active_service.configure_smoothing(enabled=enabled, alpha=alpha)
    return {"status": "ok", "enabled": enabled, "alpha": alpha}


@app.get("/api/engagement")
async def api_engagement():
    """Get current engagement index (Beta / (Alpha + Theta))"""
    active_service = simulator if USE_SIMULATOR else service

    if not active_service.streaming:
        return {"engagement": 0, "channels": [], "values": []}

    try:
        channels, values = active_service.get_engagement_index()
        avg = sum(values) / len(values) if values else 0
        return {
            "engagement": avg,
            "channels": channels,
            "values": values
        }
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


@app.post("/api/artifacts/config")
async def api_artifacts_config(payload: dict):
    """Configure artifact detection parameters"""
    active_service = simulator if USE_SIMULATOR else service

    enabled = payload.get("enabled", True)
    amplitude_threshold = float(payload.get("amplitude_threshold", 100.0))
    variance_threshold = float(payload.get("variance_threshold", 5.0))

    active_service.configure_artifact_detection(
        enabled=enabled,
        amplitude_threshold=amplitude_threshold,
        variance_threshold=variance_threshold
    )
    return {"status": "ok", "enabled": enabled}


# -------- MIDI API --------

@app.get("/api/midi/ports")
async def api_midi_ports():
    """List available MIDI output ports"""
    if not MIDI_AVAILABLE:
        return {"ports": [], "available": False}

    from midi_sender import MIDISender
    ports = MIDISender.list_ports()
    iac_port = MIDISender.find_iac_port()

    return {
        "ports": ports,
        "iac_port": iac_port,
        "available": True
    }


@app.post("/api/midi/connect")
async def api_midi_connect(payload: dict):
    """Connect to a MIDI output port"""
    if not MIDI_AVAILABLE or midi_sender is None:
        return JSONResponse(
            {"status": "error", "message": "MIDI not available. Install: pip install mido python-rtmidi"},
            status_code=503
        )

    port_name = payload.get("port_name")  # None = auto-detect IAC
    success = midi_sender.connect(port_name)

    if success:
        return {"status": "ok", "port": midi_sender.port_name}
    else:
        return JSONResponse(
            {"status": "error", "message": "Failed to connect to MIDI port"},
            status_code=500
        )


@app.post("/api/midi/disconnect")
async def api_midi_disconnect():
    """Disconnect from MIDI port"""
    if MIDI_AVAILABLE and midi_sender:
        midi_sender.disconnect()
    return {"status": "ok"}


@app.get("/api/midi/status")
async def api_midi_status():
    """Get MIDI connection status"""
    if not MIDI_AVAILABLE or midi_sender is None:
        return {"connected": False, "available": False}

    return {
        "connected": midi_sender.is_connected(),
        "port": midi_sender.port_name,
        "available": True
    }


@app.post("/api/midi/mapping")
async def api_midi_mapping(payload: dict):
    """Configure MIDI CC mappings"""
    if not MIDI_AVAILABLE or midi_sender is None:
        return JSONResponse({"status": "error", "message": "MIDI not available"}, status_code=503)

    band_map = payload.get("bands")
    cv_map = payload.get("cv")
    derived_map = payload.get("derived")

    midi_sender.configure_mapping(band_map, cv_map, derived_map)
    return {"status": "ok", "mapping": midi_sender.get_mapping()}


@app.get("/api/midi/mapping")
async def api_midi_get_mapping():
    """Get current MIDI CC mappings"""
    if not MIDI_AVAILABLE or midi_sender is None:
        return {"mapping": {}}

    return {"mapping": midi_sender.get_mapping()}


# -------- Session Recording API --------

@app.post("/api/recording/start")
async def api_recording_start(payload: dict):
    """Start session recording"""
    if not RECORDING_AVAILABLE or session_recorder is None:
        return JSONResponse(
            {"status": "error", "message": "Recording not available"},
            status_code=503
        )

    metadata = payload.get("metadata", {})
    session_id = session_recorder.start_recording(metadata)
    return {"status": "ok", "session_id": session_id}


@app.post("/api/recording/stop")
async def api_recording_stop():
    """Stop session recording"""
    if not RECORDING_AVAILABLE or session_recorder is None:
        return {"status": "ok"}

    summary = session_recorder.stop_recording()
    return {"status": "ok", "summary": summary}


@app.get("/api/recording/status")
async def api_recording_status():
    """Get recording status"""
    if not RECORDING_AVAILABLE or session_recorder is None:
        return {"recording": False, "available": False}

    return {
        "recording": session_recorder.is_recording(),
        "session_id": session_recorder.current_session_id,
        "duration": session_recorder.get_duration(),
        "available": True
    }


@app.get("/api/recording/list")
async def api_recording_list():
    """List saved recording sessions"""
    if not RECORDING_AVAILABLE or session_recorder is None:
        return {"sessions": []}

    sessions = session_recorder.list_sessions()
    return {"sessions": sessions}


@app.get("/api/recording/export/{session_id}")
async def api_recording_export(session_id: str, format: str = "json", data_type: str = "eeg"):
    """Export recording session as JSON or CSV"""
    if not RECORDING_AVAILABLE or session_recorder is None:
        return JSONResponse(
            {"status": "error", "message": "Recording not available"},
            status_code=503
        )

    try:
        if format == "csv":
            files = session_recorder.export_csv(session_id)
            if not files:
                return JSONResponse(
                    {"status": "error", "message": "No data recorded in this session"},
                    status_code=404
                )
            # Try requested data type first, then fall back to first available
            if data_type in files:
                filepath = files[data_type]
                filename = f"session_{session_id}_{data_type}.csv"
            else:
                # Return first available file
                first_type = next(iter(files))
                filepath = files[first_type]
                filename = f"session_{session_id}_{first_type}.csv"
            return FileResponse(
                filepath,
                media_type="text/csv",
                filename=filename
            )
        else:
            filepath = session_recorder.export_json(session_id)
            return FileResponse(
                filepath,
                media_type="application/json",
                filename=f"session_{session_id}.json"
            )
    except Exception as e:
        return JSONResponse(
            {"status": "error", "message": str(e)},
            status_code=404
        )


# -------- Calibration API --------

@app.post("/api/calibration/start")
async def api_calibration_start(payload: dict):
    """Start calibration wizard"""
    if not CALIBRATION_AVAILABLE or calibration_wizard is None:
        return JSONResponse(
            {"status": "error", "message": "Calibration not available"},
            status_code=503
        )

    profile_name = payload.get("profile_name", "default")
    step_info = calibration_wizard.start_calibration(profile_name)
    return {"status": "ok", **step_info}


@app.post("/api/calibration/cancel")
async def api_calibration_cancel():
    """Cancel calibration"""
    if CALIBRATION_AVAILABLE and calibration_wizard:
        calibration_wizard.cancel_calibration()
    return {"status": "ok"}


@app.get("/api/calibration/status")
async def api_calibration_status():
    """Get calibration status"""
    if not CALIBRATION_AVAILABLE or calibration_wizard is None:
        return {"calibrating": False, "available": False}

    status = calibration_wizard.get_status()
    return {
        "calibrating": calibration_wizard.is_calibrating(),
        "available": True,
        **status
    }


@app.post("/api/calibration/save")
async def api_calibration_save():
    """Save calibration profile"""
    if not CALIBRATION_AVAILABLE or calibration_wizard is None:
        return JSONResponse(
            {"status": "error", "message": "Calibration not available"},
            status_code=503
        )

    try:
        filepath = calibration_wizard.save_profile()
        return {"status": "ok", "filepath": filepath}
    except Exception as e:
        return JSONResponse(
            {"status": "error", "message": str(e)},
            status_code=500
        )


@app.get("/api/calibration/profiles")
async def api_calibration_profiles():
    """List saved calibration profiles"""
    if not CALIBRATION_AVAILABLE or calibration_wizard is None:
        return {"profiles": []}

    profiles = calibration_wizard.list_profiles()
    return {"profiles": profiles}


@app.post("/api/calibration/load")
async def api_calibration_load(payload: dict):
    """Load a calibration profile"""
    if not CALIBRATION_AVAILABLE or calibration_wizard is None:
        return JSONResponse(
            {"status": "error", "message": "Calibration not available"},
            status_code=503
        )

    profile_name = payload.get("profile_name", "default")
    try:
        profile = calibration_wizard.load_profile(profile_name)
        return {"status": "ok", "profile": profile.__dict__}
    except FileNotFoundError:
        return JSONResponse(
            {"status": "error", "message": f"Profile '{profile_name}' not found"},
            status_code=404
        )


# -------- Curve Shaping API --------

@app.post("/api/curve/apply")
async def api_curve_apply(payload: dict):
    """Apply curve shaping to a value"""
    value = float(payload.get("value", 0.5))
    curve_type = payload.get("curve_type", "linear")
    params = payload.get("params", {})

    if CALIBRATION_AVAILABLE:
        result = CurveShaper.apply_curve(value, curve_type, **params)
        return {"status": "ok", "input": value, "output": result, "curve": curve_type}
    else:
        return {"status": "ok", "input": value, "output": value, "curve": "linear"}


# -------- WebSocket for camera --------

@app.websocket("/ws/camera")
async def ws_camera(ws: WebSocket):
    await ws.accept()

    if not CAMERA_AVAILABLE or camera_service is None:
        await ws.send_json({"type": "error", "message": "Camera service unavailable"})
        await ws.close()
        return

    try:
        while True:
            if not camera_service.streaming:
                await asyncio.sleep(0.5)
                continue

            # Get latest frame as base64 JPEG
            frame_base64 = camera_service.get_latest_frame_base64()
            features = camera_service.get_latest_features()

            # Get gaze and hands data if available
            gaze = camera_service.get_latest_gaze() if hasattr(camera_service, 'get_latest_gaze') else {}
            hands = camera_service.get_latest_hands() if hasattr(camera_service, 'get_latest_hands') else {}

            if frame_base64:
                await ws.send_json({
                    "type": "camera",
                    "frame": frame_base64,
                    "features": features,
                    "gaze": gaze,
                    "hands": hands
                })

                # Send CV features via MIDI if connected
                if MIDI_AVAILABLE and midi_sender and midi_sender.is_connected():
                    midi_sender.send_cv_features(features)
                    # Send gestures as MIDI notes
                    if hands.get("left", {}).get("gesture"):
                        midi_sender.send_gesture(hands["left"]["gesture"], "left")
                    if hands.get("right", {}).get("gesture"):
                        midi_sender.send_gesture(hands["right"]["gesture"], "right")

                # Record CV data if recording
                if RECORDING_AVAILABLE and session_recorder and session_recorder.is_recording():
                    session_recorder.record_cv(features, gaze, hands)

            await asyncio.sleep(1/30)  # 30 FPS

    except WebSocketDisconnect:
        return
    except Exception as e:
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        finally:
            await ws.close()


# -------- WebSocket for stream --------

@app.websocket("/ws/stream")
async def ws_stream(ws: WebSocket):
    await ws.accept()

    # Configuration state (use dict for mutability across async tasks)
    config = {
        "mode": "timeseries",
        "window_sec": 4.0,
        "send_interval_ms": 100
    }

    try:
        # Expect initial config message
        init_msg = await ws.receive_json()
        config["mode"] = init_msg.get("mode", "timeseries")
        config["window_sec"] = float(init_msg.get("window_sec", 4.0))
        config["send_interval_ms"] = int(init_msg.get("interval_ms", 100))

        # Create task for streaming
        async def stream_data():
            active_service = simulator if USE_SIMULATOR else service
            
            while True:
                if not (active_service.connected and active_service.streaming):
                    await asyncio.sleep(0.5)
                    continue

                if config["mode"] == "timeseries":
                    channels, data = active_service.get_timeseries_window(window_sec=config["window_sec"])
                    if channels:
                        # push OSC (only for real service)
                        if not USE_SIMULATOR:
                            service.osc_push_timeseries(channels, data)
                        await ws.send_json(
                            {
                                "type": "timeseries",
                                "channels": channels,
                                "data": data,
                            }
                        )

                elif config["mode"] == "fft":
                    channels, freqs, psd = active_service.get_fft_spectrum(window_sec=config["window_sec"])
                    if channels:
                        await ws.send_json(
                            {
                                "type": "fft",
                                "channels": channels,
                                "freqs": freqs,
                                "psd": psd,
                            }
                        )

                elif config["mode"] == "bands":
                    try:
                        channels, band_names, values = active_service.get_band_powers(window_sec=config["window_sec"])
                        if channels and len(channels) > 0 and len(values) > 0:
                            # push OSC (only for real service)
                            if not USE_SIMULATOR:
                                service.osc_push_bands(channels, band_names, values)

                            # Get engagement index
                            try:
                                eng_channels, eng_values = active_service.get_engagement_index()
                                engagement_avg = sum(eng_values) / len(eng_values) if eng_values else 0
                            except Exception:
                                eng_channels, eng_values = [], []
                                engagement_avg = 0

                            # Send bands data with engagement
                            await ws.send_json(
                                {
                                    "type": "bands",
                                    "channels": channels,
                                    "bands": band_names,
                                    "values": values,
                                    "engagement": engagement_avg,
                                    "engagement_channels": eng_values,
                                }
                            )

                            # Calculate cross-channel averages for MIDI
                            if MIDI_AVAILABLE and midi_sender and midi_sender.is_connected():
                                avg_values = [
                                    float(np.mean([ch[i] for ch in values if i < len(ch)]))
                                    for i in range(len(band_names))
                                ]
                                midi_sender.send_bands(band_names, avg_values)
                                midi_sender.send_engagement(engagement_avg)

                            # Record data if recording
                            if RECORDING_AVAILABLE and session_recorder and session_recorder.is_recording():
                                session_recorder.record_eeg(
                                    channels=channels,
                                    bands=band_names,
                                    values=values
                                )
                                # Record engagement separately
                                if eng_values:
                                    session_recorder.record_engagement(
                                        channels=eng_channels if eng_channels else channels,
                                        values=eng_values,
                                        average=engagement_avg
                                    )

                        else:
                            # Send empty data to prevent UI freeze
                            await ws.send_json(
                                {
                                    "type": "bands",
                                    "channels": [],
                                    "bands": band_names if band_names else [],
                                    "values": [],
                                    "engagement": 0,
                                }
                            )
                    except Exception as e:
                        await ws.send_json({"type": "error", "message": f"Bands error: {str(e)}"})

                await asyncio.sleep(config["send_interval_ms"] / 1000.0)

        # Start streaming task
        stream_task = asyncio.create_task(stream_data())

        # Listen for mode changes
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=0.1)
                config["mode"] = msg.get("mode", config["mode"])
                config["window_sec"] = float(msg.get("window_sec", config["window_sec"]))
                config["send_interval_ms"] = int(msg.get("interval_ms", config["send_interval_ms"]))
            except asyncio.TimeoutError:
                # No new message, continue streaming
                pass
            await asyncio.sleep(0.1)

    except WebSocketDisconnect:
        return
    except Exception as e:
        # send error then close
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        finally:
            await ws.close()
