import threading
import math
import json
import os
from datetime import datetime
from pathlib import Path


RECORDINGS_DIR = Path(__file__).resolve().parent / "recordings"
RECORDING_CONFIG_FILE = Path(__file__).resolve().parent / "data" / "camera_recording_config.json"


class CameraBackend:
    def __init__(self):
        self.lock = threading.RLock()
        self.camera = None
        self.manager = None
        self.devices = []
        self.frame = None
        self.acquiring = False
        self.error = None
        self.recording = False
        self.recording_path = None
        self.last_recording = None
        self.last_recording_path = None
        self.recordings_dir = RECORDINGS_DIR
        try:
            directory = json.loads(RECORDING_CONFIG_FILE.read_text(encoding="utf-8"))["directory"]
            if isinstance(directory, str):
                saved_path = Path(directory)
                if saved_path.is_absolute() and saved_path.is_dir():
                    self.recordings_dir = saved_path
        except (OSError, ValueError, TypeError, KeyError):
            pass
        self.writer = None
        self.recorded_frames = 0
        self.recording_fps = 30.0
        self.white_balance_supported = False
        self.manual_white_balance_supported = False
        self.white_balance_range = None
        self.white_balance_ranges = {}
        self.white_balance_channels = []
        self.white_balance_ratios = {"red": 1.0, "green": 1.0, "blue": 1.0}
        self.gain_supported = False
        self.auto_gain_supported = False
        self.frame_rate_supported = False

    def _sdk(self):
        import gxipy as gx
        return gx

    def list_devices(self):
        gx = self._sdk()
        with self.lock:
            if self.camera is not None:
                return self.devices
            if self.manager is None:
                self.manager = gx.DeviceManager()
            _, info = self.manager.update_device_list()
            self.devices = [item.get("model_name", f"相机 {i + 1}") for i, item in enumerate(info)]
            return self.devices

    def open(self, index):
        gx = self._sdk()
        with self.lock:
            if self.camera is not None:
                raise ValueError("请先关闭当前相机")
            self.list_devices()
            if not 0 <= index < len(self.devices):
                raise ValueError("相机不存在")
            camera = self.manager.open_device_by_index(index + 1)
            try:
                camera.data_stream[0].register_capture_callback(self._capture)
            except Exception:
                camera.close_device()
                raise
            self.camera = camera
            self.frame = None
            self.error = None
            try:
                self.gain_supported = camera.Gain.is_implemented()
                self.auto_gain_supported = self.gain_supported and camera.GainAuto.is_implemented()
                if self.gain_supported and camera.GainSelector.is_implemented():
                    selectors = camera.GainSelector.get_range() or {}
                    self.gain_supported = gx.GxGainSelectorEntry.ALL in selectors.values()
                    if self.gain_supported:
                        camera.GainSelector.set(gx.GxGainSelectorEntry.ALL)
                    else:
                        self.auto_gain_supported = False
            except Exception:
                self.gain_supported = False
                self.auto_gain_supported = False
            try:
                self.frame_rate_supported = (
                    camera.AcquisitionFrameRateMode.is_implemented()
                    and camera.AcquisitionFrameRate.is_implemented()
                )
                if self.frame_rate_supported:
                    modes = camera.AcquisitionFrameRateMode.get_range() or {}
                    self.frame_rate_supported = all(mode in modes.values() for mode in (gx.GxSwitchEntry.OFF, gx.GxSwitchEntry.ON))
            except Exception:
                self.frame_rate_supported = False
            try:
                self.white_balance_supported = camera.BalanceWhiteAuto.is_implemented()
                self.manual_white_balance_supported = (
                    camera.BalanceRatioSelector.is_implemented()
                    and camera.BalanceRatio.is_implemented()
                )
                if self.manual_white_balance_supported:
                    selectors = camera.BalanceRatioSelector.get_range() or {}
                    for channel, selector in (("red", gx.GxBalanceRatioSelectorEntry.RED),
                                              ("green", gx.GxBalanceRatioSelectorEntry.GREEN),
                                              ("blue", gx.GxBalanceRatioSelectorEntry.BLUE)):
                        if selector not in selectors.values():
                            continue
                        try:
                            camera.BalanceRatioSelector.set(selector)
                            limits = camera.BalanceRatio.get_range()
                            if not limits:
                                continue
                            self.white_balance_channels.append(channel)
                            self.white_balance_ranges[channel] = limits
                            value = camera.BalanceRatio.get()
                            if value is not None:
                                self.white_balance_ratios[channel] = value
                        except Exception:
                            continue
                    self.manual_white_balance_supported = bool(self.white_balance_channels)
                    if self.manual_white_balance_supported:
                        self.white_balance_range = self.white_balance_ranges[self.white_balance_channels[0]]
            except Exception:
                self.white_balance_supported = False
                self.manual_white_balance_supported = False
                self.white_balance_range = None
                self.white_balance_ranges = {}
                self.white_balance_channels = []

    def _capture(self, raw_image):
        try:
            gx = self._sdk()
            if raw_image.get_status() == gx.GxFrameStatusList.INCOMPLETE:
                return
            frame = raw_image.convert("RGB").get_numpy_array()
            if frame is not None:
                with self.lock:
                    self.frame = frame.copy()
                    self.error = None
                    if self.recording:
                        import cv2
                        if self.writer is None:
                            height, width = frame.shape[:2]
                            writer = cv2.VideoWriter(
                                str(self.recording_path),
                                cv2.VideoWriter_fourcc(*"XVID"),
                                self.recording_fps,
                                (width, height),
                            )
                            if not writer.isOpened():
                                writer.release()
                                raise RuntimeError("无法创建录像文件")
                            self.writer = writer
                        self.writer.write(cv2.cvtColor(frame, cv2.COLOR_RGB2BGR))
                        self.recorded_frames += 1
        except Exception as exc:
            with self.lock:
                self.error = str(exc)
                if self.recording:
                    self._stop_recording()

    def start(self):
        with self.lock:
            if self.camera is None:
                raise ValueError("请先打开相机")
            if not self.acquiring:
                self.camera.stream_on()
                self.acquiring = True

    def stop(self):
        with self.lock:
            self._stop_recording()
            if self.camera is not None and self.acquiring:
                self.camera.stream_off()
                self.acquiring = False
            self.frame = None

    def close(self):
        with self.lock:
            if self.camera is None:
                return
            self.stop()
            self.camera.data_stream[0].unregister_capture_callback()
            self.camera.close_device()
            self.camera = None
            self.white_balance_supported = False
            self.manual_white_balance_supported = False
            self.white_balance_range = None
            self.white_balance_ranges = {}
            self.white_balance_channels = []
            self.gain_supported = False
            self.auto_gain_supported = False
            self.frame_rate_supported = False

    def status(self):
        with self.lock:
            result = {"opened": self.camera is not None, "acquiring": self.acquiring,
                      "recording": self.recording, "lastRecording": self.last_recording,
                      "recordingDirectory": str(self.recordings_dir),
                      "error": self.error, "whiteBalanceSupported": self.white_balance_supported,
                      "manualWhiteBalanceSupported": self.manual_white_balance_supported,
                      "whiteBalanceRange": self.white_balance_range,
                      "whiteBalanceRanges": self.white_balance_ranges.copy(),
                      "whiteBalanceChannels": self.white_balance_channels.copy(),
                      "whiteBalanceRatios": self.white_balance_ratios.copy(),
                      "gainSupported": self.gain_supported, "autoGainSupported": self.auto_gain_supported,
                      "frameRateSupported": self.frame_rate_supported}
            if self.camera is not None:
                try:
                    result["fps"] = round(self.camera.CurrentAcquisitionFrameRate.get(), 1)
                    result["exposure"] = round(self.camera.ExposureTime.get(), 1)
                    result["autoExposure"] = self.camera.ExposureAuto.get()[1].upper() != "OFF"
                    result["exposureRange"] = self.camera.ExposureTime.get_range()
                except Exception:
                    pass
                if self.gain_supported:
                    try:
                        result["gain"] = round(self.camera.Gain.get(), 3)
                        result["gainRange"] = self.camera.Gain.get_range()
                    except Exception:
                        pass
                if self.auto_gain_supported:
                    try:
                        result["autoGain"] = self.camera.GainAuto.get()[0] != 0
                    except Exception:
                        pass
                if self.frame_rate_supported:
                    try:
                        result["frameRateEnabled"] = self.camera.AcquisitionFrameRateMode.get()[0] != 0
                        result["frameRate"] = round(self.camera.AcquisitionFrameRate.get(), 3)
                        result["frameRateRange"] = self.camera.AcquisitionFrameRate.get_range()
                    except Exception:
                        pass
                if self.white_balance_supported:
                    try:
                        result["autoWhite"] = self.camera.BalanceWhiteAuto.get()[1].upper() != "OFF"
                    except Exception:
                        pass
            return result

    def start_recording(self):
        with self.lock:
            if not self.acquiring:
                raise ValueError("请先开启显示")
            if self.recording:
                raise ValueError("正在录像")
            import cv2
            self.recordings_dir.mkdir(parents=True, exist_ok=True)
            self.recording_path = self.recordings_dir / f"daheng-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.avi"
            try:
                fps = float(self.camera.AcquisitionFrameRate.get())
                self.recording_fps = fps if 0 < fps <= 240 else 30.0
            except Exception:
                self.recording_fps = 30.0
            self.recorded_frames = 0
            self.last_recording = None
            self.last_recording_path = None
            self.error = None
            self.recording = True

    def _stop_recording(self):
        if not self.recording:
            return
        self.recording = False
        if self.writer is not None:
            self.writer.release()
            self.writer = None
        self.last_recording = self.recording_path.name if self.recorded_frames else None
        self.last_recording_path = self.recording_path if self.recorded_frames else None
        self.recording_path = None

    def stop_recording(self):
        with self.lock:
            if not self.recording:
                raise ValueError("当前没有录像")
            self._stop_recording()

    def set_recording_directory(self, directory):
        if type(directory) is not str or not 0 < len(directory.strip()) <= 1024 or "\x00" in directory:
            raise ValueError("录像路径无效")
        path = Path(directory.strip()).expanduser()
        if not path.is_absolute():
            path = RECORDINGS_DIR.parent / path
        try:
            path = path.resolve()
        except (OSError, RuntimeError):
            raise ValueError("录像路径无效") from None
        with self.lock:
            if self.recording:
                raise ValueError("请先停止录像再修改存储路径")
            if path.exists() and not path.is_dir():
                raise ValueError("录像路径不是文件夹")
            try:
                path.mkdir(parents=True, exist_ok=True)
            except OSError:
                raise ValueError("无法创建录像文件夹") from None
            if not os.access(path, os.W_OK):
                raise ValueError("录像文件夹不可写")
            RECORDING_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
            payload = json.dumps({"directory": str(path)}, ensure_ascii=False, indent=2) + "\n"
            temporary = RECORDING_CONFIG_FILE.with_suffix(".json.tmp")
            temporary.write_text(payload, encoding="utf-8")
            temporary.replace(RECORDING_CONFIG_FILE)
            self.recordings_dir = path

    def recording_file(self, filename):
        with self.lock:
            return self.last_recording_path if filename == self.last_recording else None

    def configure(self, auto_exposure=None, exposure=None, auto_white=None, white_balance_ratios=None,
                  auto_gain=None, gain=None, frame_rate_enabled=None, frame_rate=None):
        gx = self._sdk()
        with self.lock:
            if self.camera is None:
                raise ValueError("请先打开相机")
            if self.recording:
                raise ValueError("请先停止录像再调整相机参数")
            if auto_exposure is not None:
                self.camera.ExposureAuto.set(gx.GxAutoEntry.CONTINUOUS if auto_exposure else gx.GxAutoEntry.OFF)
            if exposure is not None:
                self._check_range(exposure, self.camera.ExposureTime.get_range(), "曝光时间")
                self.camera.ExposureTime.set(float(exposure))
            if auto_gain is not None:
                if not self.auto_gain_supported:
                    raise ValueError("当前相机不支持自动增益")
                self.camera.GainAuto.set(gx.GxAutoEntry.CONTINUOUS if auto_gain else gx.GxAutoEntry.OFF)
            if gain is not None:
                if not self.gain_supported:
                    raise ValueError("当前相机不支持增益设置")
                self._check_range(gain, self.camera.Gain.get_range(), "增益")
                if self.auto_gain_supported:
                    self.camera.GainAuto.set(gx.GxAutoEntry.OFF)
                self.camera.Gain.set(float(gain))
            if frame_rate_enabled is not None or frame_rate is not None:
                if not self.frame_rate_supported:
                    raise ValueError("当前相机不支持采集帧率设置")
                if frame_rate_enabled is False and frame_rate is not None:
                    raise ValueError("关闭帧率调节时不能设置采集帧率")
                if frame_rate is not None:
                    self._check_range(frame_rate, self.camera.AcquisitionFrameRate.get_range(), "采集帧率")
                if frame_rate_enabled is not None:
                    self.camera.AcquisitionFrameRateMode.set(gx.GxSwitchEntry.ON if frame_rate_enabled else gx.GxSwitchEntry.OFF)
                if frame_rate is not None:
                    self.camera.AcquisitionFrameRate.set(float(frame_rate))
            if auto_white is not None:
                if not self.white_balance_supported:
                    raise ValueError("当前相机不支持白平衡设置")
                self.camera.BalanceWhiteAuto.set(1 if auto_white else 0)
            if white_balance_ratios is not None:
                if not self.manual_white_balance_supported:
                    raise ValueError("当前相机不支持手动白平衡")
                if not isinstance(white_balance_ratios, dict) or set(white_balance_ratios) != set(self.white_balance_channels):
                    raise ValueError("白平衡比例无效")
                for channel, value in white_balance_ratios.items():
                    self._check_range(value, self.white_balance_ranges[channel], "白平衡比例")
                if self.white_balance_supported:
                    self.camera.BalanceWhiteAuto.set(gx.GxAutoEntry.OFF)
                for channel, selector in (("red", gx.GxBalanceRatioSelectorEntry.RED),
                                          ("green", gx.GxBalanceRatioSelectorEntry.GREEN),
                                          ("blue", gx.GxBalanceRatioSelectorEntry.BLUE)):
                    if channel in white_balance_ratios:
                        self.camera.BalanceRatioSelector.set(selector)
                        self.camera.BalanceRatio.set(float(white_balance_ratios[channel]))
                self.white_balance_ratios.update(white_balance_ratios)

    @staticmethod
    def _check_range(value, limits, label):
        if type(value) not in (int, float) or not math.isfinite(value) or not limits["min"] <= value <= limits["max"]:
            raise ValueError(f"{label}超出相机允许范围")

    def jpeg(self):
        import cv2
        with self.lock:
            if self.frame is None:
                return None
            frame = self.frame.copy()
        frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            raise RuntimeError("图像编码失败")
        return encoded.tobytes()


camera_backend = CameraBackend()
