# main.py
from typing import Optional
import glob
import sys

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import asyncio
import io

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

app = FastAPI(title="Ganglion Studio")

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

            if frame_base64:
                await ws.send_json({
                    "type": "camera",
                    "frame": frame_base64,
                    "features": features
                })

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
                            await ws.send_json(
                                {
                                    "type": "bands",
                                    "channels": channels,
                                    "bands": band_names,
                                    "values": values,
                                }
                            )
                        else:
                            # Send empty data to prevent UI freeze
                            await ws.send_json(
                                {
                                    "type": "bands",
                                    "channels": [],
                                    "bands": band_names if band_names else [],
                                    "values": [],
                                }
                            )
                    except Exception as e:
                        print(f"Error in bands calculation: {e}")
                        import traceback
                        traceback.print_exc()
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
