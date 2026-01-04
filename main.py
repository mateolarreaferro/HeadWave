from typing import Optional
import asyncio

import numpy as np

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from src.service_manager import ServiceManager

try:
    from src.camera_service import CameraService
    camera_service = CameraService()
    CAMERA_AVAILABLE = True
except Exception as e:
    print(f"[WARNING] Camera service unavailable: {e}")
    camera_service = None
    CAMERA_AVAILABLE = False

try:
    from src.session_recorder import SessionRecorder
    session_recorder = SessionRecorder()
    RECORDING_AVAILABLE = True
except Exception as e:
    print(f"[WARNING] Session recorder unavailable: {e}")
    session_recorder = None
    RECORDING_AVAILABLE = False

try:
    from src.midi_sender import MIDISender
    midi_sender = MIDISender()
    MIDI_AVAILABLE = True
except Exception as e:
    print(f"[WARNING] MIDI sender unavailable: {e}")
    midi_sender = None
    MIDI_AVAILABLE = False

try:
    from src.calibration import CalibrationWizard, CurveShaper
    calibration_wizard = CalibrationWizard()
    CALIBRATION_AVAILABLE = True
except Exception as e:
    print(f"[WARNING] Calibration unavailable: {e}")
    calibration_wizard = None
    CALIBRATION_AVAILABLE = False

try:
    from src.assistant_service import AssistantService
    assistant_service = AssistantService()
    ASSISTANT_AVAILABLE = assistant_service.is_available()
except Exception as e:
    print(f"[WARNING] Assistant unavailable: {e}")
    assistant_service = None
    ASSISTANT_AVAILABLE = False

app = FastAPI(title="HeadWave - Biosignal Creative Platform")

app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")

service_manager = ServiceManager()


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/api/connect")
async def api_connect(payload: dict):
    try:
        serial_port = payload.get("serial_port", "")
        mac_address = payload.get("mac_address", "")
        timeout = int(payload.get("timeout", 15))
        service_manager.connect(serial_port=serial_port, mac_address=mac_address, timeout=timeout)
        return {"status": "ok", "simulator": service_manager.use_simulator}
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


@app.post("/api/disconnect")
async def api_disconnect():
    service_manager.disconnect()
    return {"status": "ok"}


@app.get("/api/status")
async def api_status():
    return service_manager.get_status()


@app.post("/api/use_simulator")
async def api_use_simulator(payload: dict):
    use_sim = bool(payload.get("enabled", True))
    service_manager.set_simulator_mode(use_sim)
    return {
        "status": "ok",
        "simulator": service_manager.use_simulator,
        "message": "Simulator enabled" if service_manager.use_simulator else "Real hardware enabled"
    }


@app.post("/api/simulator/mode")
async def api_simulator_mode(payload: dict):
    mode = payload.get("mode", "normal")
    service_manager.set_simulator_brain_mode(mode)
    return {"status": "ok", "mode": mode}


@app.get("/api/ports")
async def api_list_ports():
    return ServiceManager.list_ports()


@app.post("/api/start")
async def api_start(payload: dict):
    try:
        buffer_size = int(payload.get("buffer_size", 45000))
        service_manager.start_stream(buffer_size=buffer_size)
        return {"status": "ok", "simulator": service_manager.use_simulator}
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


@app.post("/api/stop")
async def api_stop():
    service_manager.stop_stream()
    return {"status": "ok"}


@app.post("/api/test_signal")
async def api_test_signal(payload: dict):
    on = bool(payload.get("on", True))
    if on:
        service_manager.send_test_signal_on()
    else:
        service_manager.send_test_signal_off()
    return {"status": "ok"}


@app.post("/api/osc_config")
async def api_osc_config(payload: dict):
    ip = payload.get("ip", "127.0.0.1")
    port = int(payload.get("port", 9000))
    enabled = bool(payload.get("enabled", False))
    send_raw = bool(payload.get("send_raw", True))
    send_bands = bool(payload.get("send_bands", False))
    service_manager.configure_osc(ip, port, enabled, send_raw, send_bands)
    if CAMERA_AVAILABLE and camera_service:
        camera_service.configure_osc(ip, port, enabled)
    return {"status": "ok"}


@app.post("/api/assistant/chat")
async def api_assistant_chat(payload: dict):
    if not ASSISTANT_AVAILABLE or assistant_service is None:
        return JSONResponse(
            {"status": "error", "message": "Assistant service unavailable"},
            status_code=503
        )

    message = payload.get("message", "")
    result = assistant_service.chat(message)

    if result["status"] == "error":
        return JSONResponse(result, status_code=500 if "Error:" in result.get("message", "") else 400)

    return result


@app.post("/api/camera/start")
async def api_camera_start(payload: dict):
    if not CAMERA_AVAILABLE or camera_service is None:
        return JSONResponse(
            {"status": "error", "message": "Camera service unavailable"},
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
    if not CAMERA_AVAILABLE or camera_service is None:
        return {"features": {}}
    features = camera_service.get_latest_features()
    return {"features": features}


@app.post("/api/smoothing/config")
async def api_smoothing_config(payload: dict):
    enabled = payload.get("enabled", True)
    alpha = float(payload.get("alpha", 0.3))
    service_manager.configure_smoothing(enabled=enabled, alpha=alpha)
    return {"status": "ok", "enabled": enabled, "alpha": alpha}


@app.get("/api/engagement")
async def api_engagement():
    if not service_manager.active.streaming:
        return {"engagement": 0, "channels": [], "values": []}

    try:
        channels, values, avg = service_manager.get_engagement_index()
        return {
            "engagement": avg,
            "channels": channels,
            "values": values
        }
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


@app.post("/api/artifacts/config")
async def api_artifacts_config(payload: dict):
    enabled = payload.get("enabled", True)
    amplitude_threshold = float(payload.get("amplitude_threshold", 100.0))
    variance_threshold = float(payload.get("variance_threshold", 5.0))

    service_manager.configure_artifact_detection(
        enabled=enabled,
        amplitude_threshold=amplitude_threshold,
        zscore_threshold=variance_threshold
    )
    return {"status": "ok", "enabled": enabled}


@app.get("/api/midi/ports")
async def api_midi_ports():
    if not MIDI_AVAILABLE:
        return {"ports": [], "available": False}

    from src.midi_sender import MIDISender
    ports = MIDISender.list_ports()
    iac_port = MIDISender.find_iac_port()

    return {
        "ports": ports,
        "iac_port": iac_port,
        "available": True
    }


@app.post("/api/midi/connect")
async def api_midi_connect(payload: dict):
    if not MIDI_AVAILABLE or midi_sender is None:
        return JSONResponse(
            {"status": "error", "message": "MIDI not available"},
            status_code=503
        )

    port_name = payload.get("port_name")
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
    if MIDI_AVAILABLE and midi_sender:
        midi_sender.disconnect()
    return {"status": "ok"}


@app.get("/api/midi/status")
async def api_midi_status():
    if not MIDI_AVAILABLE or midi_sender is None:
        return {"connected": False, "available": False}

    return {
        "connected": midi_sender.is_connected(),
        "port": midi_sender.port_name,
        "available": True
    }


@app.post("/api/midi/mapping")
async def api_midi_mapping(payload: dict):
    if not MIDI_AVAILABLE or midi_sender is None:
        return JSONResponse({"status": "error", "message": "MIDI not available"}, status_code=503)

    band_map = payload.get("bands")
    cv_map = payload.get("cv")
    derived_map = payload.get("derived")

    midi_sender.configure_mapping(band_map, cv_map, derived_map)
    return {"status": "ok", "mapping": midi_sender.get_mapping()}


@app.get("/api/midi/mapping")
async def api_midi_get_mapping():
    if not MIDI_AVAILABLE or midi_sender is None:
        return {"mapping": {}}

    return {"mapping": midi_sender.get_mapping()}


@app.post("/api/recording/start")
async def api_recording_start(payload: dict):
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
    if not RECORDING_AVAILABLE or session_recorder is None:
        return {"status": "ok"}

    summary = session_recorder.stop_recording()
    return {"status": "ok", "summary": summary}


@app.get("/api/recording/status")
async def api_recording_status():
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
    if not RECORDING_AVAILABLE or session_recorder is None:
        return {"sessions": []}

    sessions = session_recorder.list_sessions()
    return {"sessions": sessions}


@app.get("/api/recording/export/{session_id}")
async def api_recording_export(session_id: str, format: str = "json", data_type: str = "eeg"):
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
            if data_type in files:
                filepath = files[data_type]
                filename = f"session_{session_id}_{data_type}.csv"
            else:
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


@app.post("/api/calibration/start")
async def api_calibration_start(payload: dict):
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
    if CALIBRATION_AVAILABLE and calibration_wizard:
        calibration_wizard.cancel_calibration()
    return {"status": "ok"}


@app.get("/api/calibration/status")
async def api_calibration_status():
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
    if not CALIBRATION_AVAILABLE or calibration_wizard is None:
        return {"profiles": []}

    profiles = calibration_wizard.list_profiles()
    return {"profiles": profiles}


@app.post("/api/calibration/load")
async def api_calibration_load(payload: dict):
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


@app.post("/api/curve/apply")
async def api_curve_apply(payload: dict):
    value = float(payload.get("value", 0.5))
    curve_type = payload.get("curve_type", "linear")
    params = payload.get("params", {})

    if CALIBRATION_AVAILABLE:
        result = CurveShaper.apply_curve(value, curve_type, **params)
        return {"status": "ok", "input": value, "output": result, "curve": curve_type}
    else:
        return {"status": "ok", "input": value, "output": value, "curve": "linear"}


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

            frame_base64 = camera_service.get_latest_frame_base64()
            features = camera_service.get_latest_features()
            gaze = camera_service.get_latest_gaze()
            hands = camera_service.get_latest_hands()

            if frame_base64:
                await ws.send_json({
                    "type": "camera",
                    "frame": frame_base64,
                    "features": features,
                    "gaze": gaze,
                    "hands": hands
                })

                if MIDI_AVAILABLE and midi_sender and midi_sender.is_connected():
                    midi_sender.send_cv_features(features)
                    if hands.get("left", {}).get("gesture"):
                        midi_sender.send_gesture(hands["left"]["gesture"], "left")
                    if hands.get("right", {}).get("gesture"):
                        midi_sender.send_gesture(hands["right"]["gesture"], "right")

                if RECORDING_AVAILABLE and session_recorder and session_recorder.is_recording():
                    session_recorder.record_cv(features, gaze, hands)

            await asyncio.sleep(1/30)

    except WebSocketDisconnect:
        return
    except Exception as e:
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        finally:
            await ws.close()


@app.websocket("/ws/stream")
async def ws_stream(ws: WebSocket):
    await ws.accept()

    config = {
        "mode": "timeseries",
        "window_sec": 4.0,
        "send_interval_ms": 100
    }

    try:
        init_msg = await ws.receive_json()
        config["mode"] = init_msg.get("mode", "timeseries")
        config["window_sec"] = float(init_msg.get("window_sec", 4.0))
        config["send_interval_ms"] = int(init_msg.get("interval_ms", 100))

        async def stream_data():
            while True:
                if not (service_manager.active.connected and service_manager.active.streaming):
                    await asyncio.sleep(0.5)
                    continue

                if config["mode"] == "timeseries":
                    channels, data = service_manager.get_timeseries_window(window_sec=config["window_sec"])
                    if channels:
                        service_manager.osc_push_timeseries(channels, data)
                        await ws.send_json({
                            "type": "timeseries",
                            "channels": channels,
                            "data": data,
                        })

                elif config["mode"] == "fft":
                    channels, freqs, psd = service_manager.get_fft_spectrum(window_sec=config["window_sec"])
                    if channels:
                        await ws.send_json({
                            "type": "fft",
                            "channels": channels,
                            "freqs": freqs,
                            "psd": psd,
                        })

                elif config["mode"] == "bands":
                    try:
                        channels, band_names, values = service_manager.get_band_powers(window_sec=config["window_sec"])
                        if channels and len(channels) > 0 and len(values) > 0:
                            service_manager.osc_push_bands(channels, band_names, values)

                            try:
                                eng_channels, eng_values, engagement_avg = service_manager.get_engagement_index()
                            except Exception:
                                eng_channels, eng_values = [], []
                                engagement_avg = 0

                            await ws.send_json({
                                "type": "bands",
                                "channels": channels,
                                "bands": band_names,
                                "values": values,
                                "engagement": engagement_avg,
                                "engagement_channels": eng_values,
                            })

                            if MIDI_AVAILABLE and midi_sender and midi_sender.is_connected():
                                avg_values = [
                                    float(np.mean([ch[i] for ch in values if i < len(ch)]))
                                    for i in range(len(band_names))
                                ]
                                midi_sender.send_bands(band_names, avg_values)
                                midi_sender.send_engagement(engagement_avg)

                            if RECORDING_AVAILABLE and session_recorder and session_recorder.is_recording():
                                session_recorder.record_eeg(
                                    channels=channels,
                                    bands=band_names,
                                    values=values
                                )
                                if eng_values:
                                    session_recorder.record_engagement(
                                        channels=eng_channels if eng_channels else channels,
                                        values=eng_values,
                                        average=engagement_avg
                                    )

                        else:
                            await ws.send_json({
                                "type": "bands",
                                "channels": [],
                                "bands": band_names if band_names else [],
                                "values": [],
                                "engagement": 0,
                            })
                    except Exception as e:
                        await ws.send_json({"type": "error", "message": f"Bands error: {str(e)}"})

                await asyncio.sleep(config["send_interval_ms"] / 1000.0)

        stream_task = asyncio.create_task(stream_data())

        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=0.1)
                config["mode"] = msg.get("mode", config["mode"])
                config["window_sec"] = float(msg.get("window_sec", config["window_sec"]))
                config["send_interval_ms"] = int(msg.get("interval_ms", config["send_interval_ms"]))
            except asyncio.TimeoutError:
                pass
            await asyncio.sleep(0.1)

    except WebSocketDisconnect:
        return
    except Exception as e:
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        finally:
            await ws.close()
