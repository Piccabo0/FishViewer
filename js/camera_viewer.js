"use strict";

const cameraUi = Object.fromEntries([
  "Device", "Refresh", "Toggle", "AcquisitionToggle", "Image",
  "Placeholder", "AutoExposure", "Exposure", "ExposureValue", "Apply", "AutoWhite", "Snapshot", "Fps",
  "RecordToggle", "RecordingDownload", "WhiteBalanceManual", "WhiteRed", "WhiteGreen",
  "WhiteBlue", "ApplyWhite", "WhiteRedField", "WhiteGreenField", "WhiteBlueField",
  "AutoGain", "Gain", "GainValue", "ApplyGain",
  "FrameRateEnabled", "FrameRate", "ApplyFrameRate", "SettingsError",
  "SettingsButton", "SettingsDialog", "SettingsClose", "TabExposure", "TabGain", "TabWhite",
  "TabFrameRate", "PageExposure", "PageGain", "PageWhite", "PageFrameRate",
  "RecordingPathButton", "RecordingPathDialog", "RecordingPathClose", "RecordingPathBrowse",
  "RecordingPathInput", "RecordingPathError", "RecordingPathCancel"
].map((name) => [name, document.getElementById(`camera${name}`)]));

let cameraState = { opened: false, acquiring: false };
let cameraBusy = false;
let recordingPathBusy = false;
let frameTimer = null;
let fpsTimer = null;
let frameUrl = null;
const exposureMin = 20;
const exposureMax = 1000000;
const exposureSliderSteps = 10000;
let exposureDraft = 20000;
let gainDraft = 0;
const cameraTabs = ["Exposure", "Gain", "White", "FrameRate"];

function selectCameraTab(name, focus = false) {
  for (const tab of cameraTabs) {
    const selected = tab === name;
    cameraUi[`Tab${tab}`].setAttribute("aria-selected", String(selected));
    cameraUi[`Tab${tab}`].tabIndex = selected ? 0 : -1;
    cameraUi[`Page${tab}`].hidden = !selected;
  }
  if (focus) cameraUi[`Tab${name}`].focus();
}

function exposureFromSlider(position) {
  return Math.round(exposureMin * Math.pow(exposureMax / exposureMin, Number(position) / exposureSliderSteps));
}

function showExposureDraft() {
  cameraUi.ExposureValue.textContent = `${exposureDraft.toLocaleString("zh-CN")} μs`;
  cameraUi.Exposure.setAttribute("aria-valuetext", `${exposureDraft} 微秒`);
  cameraUi.Exposure.style.setProperty("--range-fill", `${Number(cameraUi.Exposure.value) / exposureSliderSteps * 100}%`);
}

cameraUi.Exposure.value = Math.round(Math.log(exposureDraft / exposureMin) / Math.log(exposureMax / exposureMin) * exposureSliderSteps);
showExposureDraft();

function showGainDraft() {
  cameraUi.GainValue.textContent = `${gainDraft} dB`;
  cameraUi.Gain.setAttribute("aria-valuetext", `${gainDraft} dB`);
  cameraUi.Gain.style.setProperty("--range-fill", `${gainDraft / 25 * 100}%`);
}

showGainDraft();

async function cameraRequest(path, data) {
  let response;
  try {
    response = await fetch(`/api/camera/${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: data === undefined ? {} : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
  } catch {
    throw new Error("");
  }
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "相机操作失败");
  return result;
}

function showCameraState(state) {
  cameraState = state;
  const settingsLocked = cameraBusy || !state.opened || state.recording;
  cameraUi.Toggle.disabled = cameraBusy || (!state.opened && !cameraUi.Device.options.length);
  cameraUi.Toggle.textContent = state.opened ? "关闭相机" : "打开相机";
  cameraUi.AcquisitionToggle.disabled = cameraBusy || !state.opened;
  cameraUi.AcquisitionToggle.textContent = state.acquiring ? "关闭显示" : "开启显示";
  cameraUi.AcquisitionToggle.classList.toggle("active", Boolean(state.acquiring));
  cameraUi.Refresh.disabled = cameraBusy || state.opened;
  cameraUi.Device.disabled = cameraBusy || state.opened;
  cameraUi.Apply.disabled = settingsLocked;
  cameraUi.Snapshot.disabled = !state.acquiring || cameraBusy;
  cameraUi.RecordToggle.disabled = cameraBusy || !state.acquiring;
  cameraUi.RecordToggle.textContent = state.recording ? "停止录像" : "开始录像";
  cameraUi.RecordToggle.classList.toggle("active", Boolean(state.recording));
  cameraUi.RecordingPathButton.disabled = cameraBusy || recordingPathBusy;
  if (state.recordingDirectory && !cameraUi.RecordingPathDialog.open) {
    cameraUi.RecordingPathInput.value = state.recordingDirectory;
  }
  cameraUi.RecordingPathBrowse.disabled = cameraBusy || recordingPathBusy || Boolean(state.recording);
  cameraUi.RecordingDownload.hidden = !state.lastRecording;
  if (state.lastRecording) {
    cameraUi.RecordingDownload.href = `/api/camera/recording/${encodeURIComponent(state.lastRecording)}`;
    cameraUi.RecordingDownload.download = state.lastRecording;
  }
  cameraUi.Fps.textContent = state.fps == null ? "--" : `${state.fps} fps`;
  if (state.autoExposure != null) cameraUi.AutoExposure.checked = state.autoExposure;
  cameraUi.AutoExposure.disabled = settingsLocked;
  cameraUi.Exposure.disabled = settingsLocked || cameraUi.AutoExposure.checked;
  if (state.autoGain != null) cameraUi.AutoGain.checked = state.autoGain;
  cameraUi.AutoGain.disabled = settingsLocked || !state.autoGainSupported;
  cameraUi.Gain.disabled = settingsLocked || cameraUi.AutoGain.checked;
  cameraUi.ApplyGain.disabled = settingsLocked || !state.gainSupported;
  if (state.autoWhite != null) cameraUi.AutoWhite.checked = state.autoWhite;
  else if (state.opened && !state.whiteBalanceSupported) cameraUi.AutoWhite.checked = false;
  cameraUi.AutoWhite.disabled = settingsLocked || !state.whiteBalanceSupported;
  const manualWhiteSupported = state.opened && state.manualWhiteBalanceSupported;
  const whiteChannels = state.whiteBalanceChannels || [];
  cameraUi.WhiteBalanceManual.hidden = Boolean(state.opened && !manualWhiteSupported);
  cameraUi.ApplyWhite.disabled = settingsLocked || !manualWhiteSupported || cameraUi.AutoWhite.checked;
  for (const [channel, input, field] of [["red", cameraUi.WhiteRed, cameraUi.WhiteRedField],
                                        ["green", cameraUi.WhiteGreen, cameraUi.WhiteGreenField],
                                        ["blue", cameraUi.WhiteBlue, cameraUi.WhiteBlueField]]) {
    const channelSupported = whiteChannels.includes(channel);
    field.hidden = Boolean(state.opened && !channelSupported);
    const limits = state.whiteBalanceRanges?.[channel] || state.whiteBalanceRange;
    if (limits) {
      input.min = limits.min;
      input.max = limits.max;
    }
    if (state.whiteBalanceRatios && document.activeElement !== input) {
      input.value = state.whiteBalanceRatios[channel];
    }
    input.disabled = settingsLocked || !channelSupported || cameraUi.AutoWhite.checked;
  }
  if (state.frameRateEnabled != null) cameraUi.FrameRateEnabled.checked = state.frameRateEnabled;
  if (state.frameRate != null && document.activeElement !== cameraUi.FrameRate) cameraUi.FrameRate.value = state.frameRate;
  if (state.frameRateRange) {
    cameraUi.FrameRate.min = state.frameRateRange.min;
    cameraUi.FrameRate.max = state.frameRateRange.max;
  }
  cameraUi.FrameRateEnabled.disabled = settingsLocked;
  cameraUi.FrameRate.disabled = settingsLocked || !cameraUi.FrameRateEnabled.checked;
  cameraUi.ApplyFrameRate.disabled = settingsLocked || !state.frameRateSupported;
  cameraUi.SettingsError.hidden = !state.opened || !state.error;
  cameraUi.SettingsError.textContent = state.opened ? state.error || "" : "";
  if (!state.acquiring) {
    cameraUi.Image.hidden = true;
    cameraUi.Placeholder.hidden = false;
    cameraUi.Placeholder.textContent = state.error || "打开相机并开启显示后显示画面";
  }
}

async function cameraAction(path, data = {}) {
  cameraBusy = true;
  showCameraState(cameraState);
  try {
    showCameraState(await cameraRequest(path, data));
  } catch (error) {
    cameraState = { ...cameraState, error: error.message || null };
  } finally {
    cameraBusy = false;
    showCameraState(cameraState);
  }
}

async function refreshCameraDevices() {
  cameraBusy = true;
  showCameraState(cameraState);
  try {
    const { devices } = await cameraRequest("devices");
    cameraUi.Device.replaceChildren(...devices.map((name, index) => new Option(`${index + 1}. ${name}`, index)));
    cameraState = { ...cameraState, error: devices.length ? null : "未发现大恒相机" };
  } catch (error) {
    cameraState = { ...cameraState, error: error.message || null };
  } finally {
    cameraBusy = false;
    showCameraState(cameraState);
  }
}

async function updateCameraFrame() {
  if (document.querySelector("#dashboard").dataset.activePage !== "2" || !cameraState.acquiring) return;
  try {
    const response = await fetch(`/api/camera/frame?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    if (!response.headers.get("Content-Type")?.includes("image/jpeg")) return;
    const nextUrl = URL.createObjectURL(await response.blob());
    cameraUi.Image.onload = () => {
      if (frameUrl) URL.revokeObjectURL(frameUrl);
      frameUrl = nextUrl;
    };
    cameraUi.Image.src = nextUrl;
    cameraUi.Image.hidden = false;
    cameraUi.Placeholder.hidden = true;
  } catch (error) {
    cameraUi.Placeholder.textContent = error.message;
  }
}

cameraUi.Refresh.addEventListener("click", refreshCameraDevices);
cameraUi.RecordingPathButton.addEventListener("click", async () => {
  cameraUi.RecordingPathError.hidden = true;
  cameraUi.RecordingPathError.textContent = "";
  cameraUi.RecordingPathDialog.showModal();
  try {
    const state = await cameraRequest("status");
    showCameraState(state);
    cameraUi.RecordingPathInput.value = state.recordingDirectory || "";
  } catch (error) {
    cameraUi.RecordingPathError.textContent = error.message || "无法读取存储路径";
    cameraUi.RecordingPathError.hidden = false;
  }
  cameraUi.RecordingPathBrowse.focus();
});
cameraUi.RecordingPathClose.addEventListener("click", () => cameraUi.RecordingPathDialog.close());
cameraUi.RecordingPathCancel.addEventListener("click", () => cameraUi.RecordingPathDialog.close());
cameraUi.RecordingPathDialog.addEventListener("close", () => cameraUi.RecordingPathButton.focus());
cameraUi.RecordingPathDialog.addEventListener("click", (event) => {
  if (event.target !== cameraUi.RecordingPathDialog) return;
  const bounds = cameraUi.RecordingPathDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
    cameraUi.RecordingPathDialog.close();
  }
});
cameraUi.RecordingPathBrowse.addEventListener("click", async () => {
  if (cameraState.recording || recordingPathBusy) return;
  recordingPathBusy = true;
  showCameraState(cameraState);
  try {
    const result = await cameraRequest("record/browse", {});
    showCameraState(result);
    cameraUi.RecordingPathInput.value = result.recordingDirectory || "";
    if (!result.cancelled) cameraUi.RecordingPathDialog.close();
  } catch (error) {
    cameraUi.RecordingPathError.textContent = error.message || "无法保存存储路径";
    cameraUi.RecordingPathError.hidden = false;
  } finally {
    recordingPathBusy = false;
    showCameraState(cameraState);
  }
});
cameraUi.SettingsButton.addEventListener("click", () => {
  selectCameraTab("Exposure");
  cameraUi.SettingsDialog.showModal();
  cameraUi.SettingsButton.setAttribute("aria-expanded", "true");
  cameraUi.TabExposure.focus();
});
cameraUi.SettingsClose.addEventListener("click", () => cameraUi.SettingsDialog.close());
cameraUi.SettingsDialog.addEventListener("close", () => {
  cameraUi.SettingsButton.setAttribute("aria-expanded", "false");
  cameraUi.SettingsButton.focus();
});
cameraUi.SettingsDialog.addEventListener("click", (event) => {
  if (event.target !== cameraUi.SettingsDialog) return;
  const bounds = cameraUi.SettingsDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
    cameraUi.SettingsDialog.close();
  }
});
for (const [index, name] of cameraTabs.entries()) {
  cameraUi[`Tab${name}`].addEventListener("click", () => selectCameraTab(name));
  cameraUi[`Tab${name}`].addEventListener("keydown", (event) => {
    const next = event.key === "ArrowRight" ? (index + 1) % cameraTabs.length
      : event.key === "ArrowLeft" ? (index - 1 + cameraTabs.length) % cameraTabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? cameraTabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectCameraTab(cameraTabs[next], true);
  });
}
cameraUi.Toggle.addEventListener("click", () => cameraAction(
  cameraState.opened ? "close" : "open",
  cameraState.opened ? {} : { index: Number(cameraUi.Device.value) }
));
cameraUi.AcquisitionToggle.addEventListener("click", () => cameraAction(cameraState.acquiring ? "stop" : "start"));
cameraUi.RecordToggle.addEventListener("click", () => cameraAction(cameraState.recording ? "record/stop" : "record/start"));
cameraUi.Exposure.addEventListener("input", () => {
  exposureDraft = exposureFromSlider(cameraUi.Exposure.value);
  showExposureDraft();
});
cameraUi.AutoExposure.addEventListener("change", () => { cameraUi.Exposure.disabled = cameraUi.AutoExposure.checked || cameraState.recording; });
cameraUi.Apply.addEventListener("click", () => {
  cameraAction("configure", {
    autoExposure: cameraUi.AutoExposure.checked,
    ...(!cameraUi.AutoExposure.checked ? { exposure: exposureDraft } : {})
  });
});
cameraUi.Gain.addEventListener("input", () => {
  gainDraft = Number(Number(cameraUi.Gain.value).toFixed(1));
  showGainDraft();
});
cameraUi.AutoGain.addEventListener("change", () => { cameraUi.Gain.disabled = cameraUi.AutoGain.checked || cameraState.recording; });
cameraUi.ApplyGain.addEventListener("click", () => {
  cameraAction("configure", {
    ...(cameraState.autoGainSupported ? { autoGain: cameraUi.AutoGain.checked } : {}),
    ...(!cameraUi.AutoGain.checked ? { gain: gainDraft } : {})
  });
});
cameraUi.AutoWhite.addEventListener("change", () => {
  const automatic = cameraUi.AutoWhite.checked;
  for (const [channel, input] of [["red", cameraUi.WhiteRed], ["green", cameraUi.WhiteGreen], ["blue", cameraUi.WhiteBlue]]) {
    input.disabled = automatic || !cameraState.whiteBalanceChannels?.includes(channel);
  }
  cameraUi.ApplyWhite.disabled = automatic;
  cameraAction("configure", { autoWhite: automatic });
});
cameraUi.ApplyWhite.addEventListener("click", () => {
  const inputs = (cameraState.whiteBalanceChannels || []).map((channel) => ({
    red: cameraUi.WhiteRed, green: cameraUi.WhiteGreen, blue: cameraUi.WhiteBlue
  })[channel]);
  if (!inputs.length) return;
  if (!inputs.every((input) => input.reportValidity())) return;
  cameraAction("configure", { whiteBalanceRatios: Object.fromEntries(
    (cameraState.whiteBalanceChannels || []).map((channel, index) => [channel, Number(inputs[index].value)])
  ) });
});
cameraUi.FrameRateEnabled.addEventListener("change", () => {
  cameraUi.FrameRate.disabled = !cameraUi.FrameRateEnabled.checked || cameraState.recording;
});
cameraUi.ApplyFrameRate.addEventListener("click", () => {
  if (cameraUi.FrameRateEnabled.checked && !cameraUi.FrameRate.reportValidity()) return;
  cameraAction("configure", {
    frameRateEnabled: cameraUi.FrameRateEnabled.checked,
    ...(cameraUi.FrameRateEnabled.checked ? { frameRate: Number(cameraUi.FrameRate.value) } : {})
  });
});
cameraUi.Snapshot.addEventListener("click", async () => {
  cameraBusy = true;
  showCameraState(cameraState);
  try {
    const result = await cameraRequest("snapshot", {});
    toast(`图像已保存：${result.savedImage}`);
  } catch (error) {
    toast(error.message || "保存图像失败", "warn");
  } finally {
    cameraBusy = false;
    showCameraState(cameraState);
  }
});

document.querySelector('[data-page="2"]').addEventListener("click", async () => {
  if (!cameraUi.Device.options.length && !cameraState.opened) await refreshCameraDevices();
  try {
    const state = await cameraRequest("status");
    showCameraState({ ...state, error: cameraState.error || state.error });
  }
  catch (error) { if (error.message) cameraUi.Placeholder.textContent = error.message; }
  if (!frameTimer) frameTimer = setInterval(updateCameraFrame, 100);
  if (!fpsTimer) fpsTimer = setInterval(async () => {
    if (document.querySelector("#dashboard").dataset.activePage !== "2" || !cameraState.acquiring) return;
    try {
      const state = await cameraRequest("status");
      cameraUi.Fps.textContent = state.fps == null ? "--" : `${state.fps} fps`;
    } catch {}
  }, 1000);
});
