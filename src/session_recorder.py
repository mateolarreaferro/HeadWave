import os
import json
import csv
import time
import threading
import uuid
from datetime import datetime
from typing import Dict, List, Any, Optional
from collections import deque
from pathlib import Path


class SessionRecorder:

    def __init__(self, recordings_dir: str = "recordings"):
        self.recordings_dir = Path(recordings_dir)
        self.recordings_dir.mkdir(parents=True, exist_ok=True)

        self.recording = False
        self.session_id: Optional[str] = None
        self.start_time: Optional[float] = None

        self.eeg_data: List[Dict] = []
        self.cv_data: List[Dict] = []
        self.engagement_data: List[Dict] = []
        self.artifacts_data: List[Dict] = []
        self.ppg_data: List[Dict] = []

        self.metadata: Dict[str, Any] = {}

        self.lock = threading.Lock()

    @property
    def current_session_id(self) -> Optional[str]:
        return self.session_id

    def get_duration(self) -> float:
        if not self.recording or self.start_time is None:
            return 0.0
        return time.time() - self.start_time

    def start_recording(self, metadata: Optional[Dict] = None) -> str:
        with self.lock:
            if self.recording:
                raise RuntimeError("Recording already in progress")

            self.session_id = str(uuid.uuid4())[:8]
            self.start_time = time.time()
            self.recording = True

            self.eeg_data = []
            self.cv_data = []
            self.engagement_data = []
            self.artifacts_data = []
            self.ppg_data = []

            self.metadata = {
                'session_id': self.session_id,
                'start_time': datetime.now().isoformat(),
                'start_timestamp': self.start_time,
                **(metadata or {})
            }

            print(f"[Recorder] Started session {self.session_id}")
            return self.session_id

    def stop_recording(self) -> Dict[str, Any]:
        with self.lock:
            if not self.recording:
                raise RuntimeError("No recording in progress")

            self.recording = False
            end_time = time.time()
            duration = end_time - self.start_time

            self.metadata['end_time'] = datetime.now().isoformat()
            self.metadata['end_timestamp'] = end_time
            self.metadata['duration_seconds'] = duration
            self.metadata['sample_counts'] = {
                'eeg': len(self.eeg_data),
                'cv': len(self.cv_data),
                'engagement': len(self.engagement_data),
                'artifacts': len(self.artifacts_data),
                'ppg': len(self.ppg_data)
            }

            print(f"[Recorder] Stopped session {self.session_id} ({duration:.1f}s)")

            return {
                'session_id': self.session_id,
                'duration': duration,
                'samples': self.metadata['sample_counts']
            }

    def record_eeg(self, channels: List[str], bands: List[str],
                   values: List[List[float]], timestamp: Optional[float] = None):
        if not self.recording:
            return

        with self.lock:
            self.eeg_data.append({
                'timestamp': timestamp or time.time(),
                'relative_time': (timestamp or time.time()) - self.start_time,
                'channels': channels,
                'bands': bands,
                'values': values
            })

    def record_cv(self, face: Dict[str, float], gaze: Dict[str, float],
                  hands: Dict[str, Any], timestamp: Optional[float] = None):
        if not self.recording:
            return

        with self.lock:
            self.cv_data.append({
                'timestamp': timestamp or time.time(),
                'relative_time': (timestamp or time.time()) - self.start_time,
                'face': face,
                'gaze': gaze,
                'hands': hands
            })

    def record_engagement(self, channels: List[str], values: List[float],
                          average: float, timestamp: Optional[float] = None):
        if not self.recording:
            return

        with self.lock:
            self.engagement_data.append({
                'timestamp': timestamp or time.time(),
                'relative_time': (timestamp or time.time()) - self.start_time,
                'channels': channels,
                'values': values,
                'average': average
            })

    def record_artifacts(self, channels: List[str], flags: List[bool],
                         quality: List[float], timestamp: Optional[float] = None):
        if not self.recording:
            return

        with self.lock:
            self.artifacts_data.append({
                'timestamp': timestamp or time.time(),
                'relative_time': (timestamp or time.time()) - self.start_time,
                'channels': channels,
                'artifact_flags': flags,
                'signal_quality': quality
            })

    def record_ppg(self, heart_rate: float, hrv: float,
                   quality: float, timestamp: Optional[float] = None):
        if not self.recording:
            return

        with self.lock:
            self.ppg_data.append({
                'timestamp': timestamp or time.time(),
                'relative_time': (timestamp or time.time()) - self.start_time,
                'heart_rate': heart_rate,
                'hrv': hrv,
                'quality': quality
            })

    def export_json(self, session_id: Optional[str] = None) -> str:
        with self.lock:
            sid = session_id or self.session_id
            if not sid:
                raise RuntimeError("No session to export")

            filename = f"session_{sid}.json"
            filepath = self.recordings_dir / filename

            export_data = {
                'metadata': self.metadata,
                'eeg': self.eeg_data,
                'cv': self.cv_data,
                'engagement': self.engagement_data,
                'artifacts': self.artifacts_data,
                'ppg': self.ppg_data
            }

            with open(filepath, 'w') as f:
                json.dump(export_data, f, indent=2)

            print(f"[Recorder] Exported JSON to {filepath}")
            return str(filepath)

    def export_csv(self, session_id: Optional[str] = None) -> Dict[str, str]:
        with self.lock:
            sid = session_id or self.session_id
            if not sid:
                raise RuntimeError("No session to export")

            exported_files = {}

            if self.eeg_data:
                filepath = self.recordings_dir / f"session_{sid}_eeg.csv"
                self._export_eeg_csv(filepath)
                exported_files['eeg'] = str(filepath)

            if self.cv_data:
                filepath = self.recordings_dir / f"session_{sid}_cv.csv"
                self._export_cv_csv(filepath)
                exported_files['cv'] = str(filepath)

            if self.engagement_data:
                filepath = self.recordings_dir / f"session_{sid}_engagement.csv"
                self._export_engagement_csv(filepath)
                exported_files['engagement'] = str(filepath)

            if self.ppg_data:
                filepath = self.recordings_dir / f"session_{sid}_ppg.csv"
                self._export_ppg_csv(filepath)
                exported_files['ppg'] = str(filepath)

            print(f"[Recorder] Exported CSV files: {list(exported_files.keys())}")
            return exported_files

    def _export_eeg_csv(self, filepath: Path):
        if not self.eeg_data:
            return

        with open(filepath, 'w', newline='') as f:
            writer = csv.writer(f)

            bands = self.eeg_data[0]['bands']
            channels = self.eeg_data[0]['channels']

            header = ['timestamp', 'relative_time']
            for ch in channels:
                for band in bands:
                    header.append(f"{ch}_{band}")
            writer.writerow(header)

            for sample in self.eeg_data:
                row = [sample['timestamp'], sample['relative_time']]
                for ch_values in sample['values']:
                    row.extend(ch_values)
                writer.writerow(row)

    def _export_cv_csv(self, filepath: Path):
        if not self.cv_data:
            return

        with open(filepath, 'w', newline='') as f:
            writer = csv.writer(f)

            header = ['timestamp', 'relative_time',
                      'mouth_openness', 'brow_raise', 'head_yaw', 'head_roll', 'smile_curvature',
                      'gaze_x', 'gaze_y', 'gaze_confidence',
                      'left_hand_present', 'left_palm_x', 'left_palm_y', 'left_pinch', 'left_gesture',
                      'right_hand_present', 'right_palm_x', 'right_palm_y', 'right_pinch', 'right_gesture']
            writer.writerow(header)

            for sample in self.cv_data:
                face = sample.get('face', {})
                gaze = sample.get('gaze', {})
                hands = sample.get('hands', {})

                left = hands.get('left') or {}
                right = hands.get('right') or {}

                row = [
                    sample['timestamp'],
                    sample['relative_time'],
                    face.get('mouth_openness', 0),
                    face.get('brow_raise', 0),
                    face.get('head_yaw', 0),
                    face.get('head_roll', 0),
                    face.get('smile_curvature', 0),
                    gaze.get('gaze_x', 0),
                    gaze.get('gaze_y', 0),
                    gaze.get('gaze_confidence', 0),
                    1 if left.get('present') else 0,
                    left.get('palm_x', 0),
                    left.get('palm_y', 0),
                    left.get('pinch_distance', 0),
                    left.get('gesture', 'none'),
                    1 if right.get('present') else 0,
                    right.get('palm_x', 0),
                    right.get('palm_y', 0),
                    right.get('pinch_distance', 0),
                    right.get('gesture', 'none')
                ]
                writer.writerow(row)

    def _export_engagement_csv(self, filepath: Path):
        if not self.engagement_data:
            return

        with open(filepath, 'w', newline='') as f:
            writer = csv.writer(f)

            channels = self.engagement_data[0]['channels']
            header = ['timestamp', 'relative_time'] + channels + ['average']
            writer.writerow(header)

            for sample in self.engagement_data:
                row = [sample['timestamp'], sample['relative_time']]
                row.extend(sample['values'])
                row.append(sample['average'])
                writer.writerow(row)

    def _export_ppg_csv(self, filepath: Path):
        if not self.ppg_data:
            return

        with open(filepath, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['timestamp', 'relative_time', 'heart_rate', 'hrv', 'quality'])

            for sample in self.ppg_data:
                writer.writerow([
                    sample['timestamp'],
                    sample['relative_time'],
                    sample['heart_rate'],
                    sample['hrv'],
                    sample['quality']
                ])

    def list_sessions(self) -> List[Dict[str, Any]]:
        sessions = []
        for f in self.recordings_dir.glob("session_*.json"):
            try:
                with open(f) as fp:
                    data = json.load(fp)
                    sessions.append({
                        'session_id': data['metadata'].get('session_id'),
                        'start_time': data['metadata'].get('start_time'),
                        'duration': data['metadata'].get('duration_seconds'),
                        'samples': data['metadata'].get('sample_counts'),
                        'file': str(f)
                    })
            except Exception:
                continue
        return sorted(sessions, key=lambda x: x.get('start_time', ''), reverse=True)

    def load_session(self, session_id: str) -> Dict[str, Any]:
        filepath = self.recordings_dir / f"session_{session_id}.json"
        if not filepath.exists():
            raise FileNotFoundError(f"Session {session_id} not found")

        with open(filepath) as f:
            return json.load(f)

    def is_recording(self) -> bool:
        return self.recording

    def get_status(self) -> Dict[str, Any]:
        with self.lock:
            if not self.recording:
                return {'recording': False}

            return {
                'recording': True,
                'session_id': self.session_id,
                'duration': time.time() - self.start_time,
                'samples': {
                    'eeg': len(self.eeg_data),
                    'cv': len(self.cv_data),
                    'engagement': len(self.engagement_data),
                    'ppg': len(self.ppg_data)
                }
            }
