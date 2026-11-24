"use strict";

const $ = (selector) => document.querySelector(selector);

const elements = {
  connectButton: $("#connectButton"),
  baudRate: $("#baudRate"),
  baudSelect: $("#baudSelect"),
  baudTrigger: $("#baudTrigger"),
  baudMenu: $("#baudMenu"),
  baudSelected: $("#baudSelected"),
  serialConfigTrigger: $("#serialConfigTrigger"),
  serialConfigDialog: $("#serialConfigDialog"),
  serialConfigDialogPanel: $(".serial-config-dialog"),
  serialConfigClose: $("#serialConfigClose"),
  serialConfigDone: $("#serialConfigDone"),
  portSelect: $("#portSelect"),
  portTrigger: $("#portTrigger"),
  portMenu: $("#portMenu"),
  portSelected: $("#portSelected"),
  connectionDot: $("#connectionDot"),
  connectionLabel: $("#connectionLabel"),
  connectionHint: $("#connectionHint"),
  consoleOutput: $("#consoleOutput"),
  commandInput: $("#commandInput"),
  autoScroll: $("#autoScroll"),
  logMode: $("#logMode"),
  receiveWrap: $("#receiveWrap"),
  hideReceive: $("#hideReceive"),
  appendNewline: $("#appendNewline"),
  parseEscapes: $("#parseEscapes"),
  autoChecksum: $("#autoChecksum"),
  checksumType: $("#checksumType"),
  checksumSetting: $("#checksumSetting"),
  loopSend: $("#loopSend"),
  loopInterval: $("#loopInterval"),
  sendButton: $("#sendButton"),
  sendModeLabel: $("#sendModeLabel"),
  rxAscii: $("#rxAscii"),
  rxHex: $("#rxHex"),
  txAscii: $("#txAscii"),
  txHex: $("#txHex"),
  dataBits: $("#dataBits"),
  stopBits: $("#stopBits"),
  parity: $("#parity"),
  flowControl: $("#flowControl"),
  serialFrameSummary: $("#serialFrameSummary"),
  serialSettingsNote: $(".serial-settings-note"),
  toastRegion: $("#toastRegion"),
};

const appState = {
  source: "idle",
  connectedAt: null,
  logs: [],
  selectedPort: null,
  knownPorts: [],
};

const consoleState = {
  receiveMode: "ascii",
  sendMode: "ascii",
  loopTimer: null,
  loopActive: false,
};

const quickCommandState = { items: [], editingIndex: null, selectedIndex: null };
const quickCommandStorageKey = "fishlink.quickCommands.v1";

function validateQuickCommands(value) {
  if (!Array.isArray(value) || value.length > 500) throw new Error("快捷指令 JSON 必须是最多 500 项的数组");
  return value.map((item) => {
    const format = item?.format ?? "hex";
    if (!item || typeof item.name !== "string" || typeof item.data !== "string" ||
        !item.name.trim() || item.name.trim().length > 40 || !item.data || item.data.length > 4096 ||
        !["hex", "ascii"].includes(format)) {
      throw new Error("每项必须包含名称、格式和数据");
    }
    return { name: item.name.trim(), format,
      data: format === "hex" ? formatHex(parseHexInput(item.data)) : item.data };
  });
}

function renderQuickCommands() {
  const list = $("#quickCommandList");
  list.replaceChildren();
  $("#editQuickCommand").disabled = quickCommandState.selectedIndex === null;
  if (!quickCommandState.items.length) {
    const empty = document.createElement("p");
    empty.className = "quick-command-empty";
    empty.textContent = "暂无快捷指令，点击“新建”添加。";
    list.append(empty);
  }
  quickCommandState.items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "quick-command-row";
    row.classList.toggle("selected", index === quickCommandState.selectedIndex);
    row.addEventListener("click", () => selectQuickCommand(index));
    const name = document.createElement("button");
    name.type = "button";
    name.className = "quick-command-name";
    name.textContent = item.name;
    name.title = "选择 " + item.name;
    const data = document.createElement("span");
    data.className = "quick-command-data";
    data.textContent = `${item.format.toUpperCase()} · ${item.data}`;
    data.title = data.textContent;
    const send = document.createElement("button");
    send.type = "button";
    send.className = "quick-send";
    send.textContent = "➜";
    send.title = "发送 " + item.name;
    send.setAttribute("aria-label", "发送 " + item.name);
    send.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        if (appState.source !== "serial") throw new Error("请先连接设备");
        const bytes = item.format === "hex" ? parseHexInput(item.data) : new TextEncoder().encode(item.data);
        await serial.send(bytes, { appendNewline: false });
        writeLog("TX", item.format === "hex" ? formatHex(bytes) : item.data);
      } catch (error) { toast(error.message, "warn"); }
    });
    row.append(name, data, send);
    list.append(row);
  });
}

function selectQuickCommand(index) {
  quickCommandState.selectedIndex = index;
  $("#editQuickCommand").disabled = false;
  $("#quickCommandList").querySelectorAll(".quick-command-row").forEach((row, rowIndex) => {
    row.classList.toggle("selected", rowIndex === index);
  });
}

async function saveQuickCommands(items, selectedIndex = quickCommandState.selectedIndex) {
  const payload = JSON.stringify(items);
  const response = await fetch("/api/quick-commands", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: payload,
  });
  if (!response.ok) throw new Error("快捷指令文件保存失败，请使用本地 web_server.py 启动页面");
  localStorage.setItem(quickCommandStorageKey, payload);
  quickCommandState.items = items;
  quickCommandState.selectedIndex = selectedIndex;
  renderQuickCommands();
}

async function loadQuickCommands() {
  try {
    const response = await fetch("/api/quick-commands");
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error();
    quickCommandState.items = validateQuickCommands(await response.json());
    localStorage.setItem(quickCommandStorageKey, JSON.stringify(quickCommandState.items));
  } catch {
    try { quickCommandState.items = validateQuickCommands(JSON.parse(localStorage.getItem(quickCommandStorageKey) || "[]")); }
    catch { quickCommandState.items = []; }
  }
  renderQuickCommands();
}

function openQuickCommandDialog(index = null) {
  quickCommandState.editingIndex = index;
  const item = index === null ? null : quickCommandState.items[index];
  $("#quickCommandDialogTitle").textContent = item ? "编辑快捷指令" : "新建快捷指令";
  $("#quickCommandName").value = item?.name || "";
  $("#quickCommandFormat").value = item?.format || "hex";
  $("#quickCommandData").value = item?.data || "";
  $("#quickCommandData").placeholder = item?.format === "ascii" ? "例如 START" : "FF FE 04 01 01 03";
  $("#deleteQuickCommand").hidden = !item;
  $("#quickCommandDialog").showModal();
  $("#quickCommandName").focus();
}

$("#addQuickCommand").addEventListener("click", () => openQuickCommandDialog());
$("#editQuickCommand").addEventListener("click", () => {
  if (quickCommandState.selectedIndex !== null) openQuickCommandDialog(quickCommandState.selectedIndex);
});
$("#quickCommandFormat").addEventListener("change", (event) => {
  $("#quickCommandData").placeholder = event.target.value === "ascii" ? "例如 START" : "FF FE 04 01 01 03";
});
$("#cancelQuickCommand").addEventListener("click", () => $("#quickCommandDialog").close());
$("#quickCommandForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const format = $("#quickCommandFormat").value;
    const data = $("#quickCommandData").value;
    const item = { name: $("#quickCommandName").value.trim(), format,
      data: format === "hex" ? formatHex(parseHexInput(data)) : data };
    const items = [...quickCommandState.items];
    if (quickCommandState.editingIndex === null) items.push(item);
    else items[quickCommandState.editingIndex] = item;
    const selectedIndex = quickCommandState.editingIndex ?? items.length - 1;
    await saveQuickCommands(validateQuickCommands(items), selectedIndex);
    $("#quickCommandDialog").close();
  } catch (error) { toast(error.message, "warn"); }
});
$("#deleteQuickCommand").addEventListener("click", async () => {
  try {
    const items = quickCommandState.items.filter((_, index) => index !== quickCommandState.editingIndex);
    await saveQuickCommands(items, null);
    $("#quickCommandDialog").close();
  } catch (error) { toast(error.message, "warn"); }
});
loadQuickCommands();
window.addEventListener("storage", (event) => {
  if (event.key !== quickCommandStorageKey) return;
  quickCommandState.selectedIndex = null;
  loadQuickCommands();
});

const servoState = { minAngle: -60, maxAngle: 60, angle: 0 };
let servoSendTimer = null;
let servoSendQueue = Promise.resolve();

function validateServoConfig(config) {
  const minAngle = Number(config?.minAngle);
  const maxAngle = Number(config?.maxAngle);
  if (!Number.isInteger(minAngle) || !Number.isInteger(maxAngle) ||
      minAngle < -60 || maxAngle > 60 || minAngle >= maxAngle) {
    throw new Error("舵机角度范围须为 -60° 到 60° 内递增的整数");
  }
  return { minAngle, maxAngle };
}

function renderServoControls() {
  const slider = $("#servoAngleSlider");
  const connected = appState.source === "serial";
  slider.min = servoState.minAngle;
  slider.max = servoState.maxAngle;
  slider.value = servoState.angle;
  slider.disabled = !connected;
  const directInput = $("#servoDirectAngle");
  directInput.min = servoState.minAngle;
  directInput.max = servoState.maxAngle;
  directInput.value = servoState.angle;
  directInput.disabled = !connected;
  $("#servoDirectForm button[type='submit']").disabled = !connected;
  $("#servoAngleValue").value = String(servoState.angle);
  $("#servoAngleValue").textContent = String(servoState.angle);
  $("#servoMinLabel").textContent = `${servoState.minAngle}°`;
  $("#servoMaxLabel").textContent = `${servoState.maxAngle}°`;
  $("#servoDecrease").disabled = !connected || servoState.angle <= servoState.minAngle;
  $("#servoIncrease").disabled = !connected || servoState.angle >= servoState.maxAngle;
}

function setServoAngle(value) {
  servoState.angle = Math.max(servoState.minAngle, Math.min(servoState.maxAngle, Math.round(Number(value))));
  renderServoControls();
  window.servoViewer?.setAngle(servoState.angle);
}

function buildServoFrame(angle) {
  if (!Number.isInteger(angle) || angle < -60 || angle > 60) throw new Error("舵机角度必须为 -60° 到 60° 的整数");
  const data = angle + 60;
  return Uint8Array.of(0xFF, 0xFE, 0x02, 0x01, data, data);
}

function cancelServoSendTimer() {
  if (servoSendTimer !== null) window.clearTimeout(servoSendTimer);
  servoSendTimer = null;
}

function queueServoSend(angle) {
  servoSendQueue = servoSendQueue.then(async () => {
    if (appState.source !== "serial") throw new Error("请先连接串口设备");
    const frame = buildServoFrame(angle);
    await serial.send(frame, { appendNewline: false });
    writeLog("TX", formatHex(frame));
  }).catch((error) => toast(error.message, "warn"));
}

function scheduleServoSend(angle, delay = 0) {
  cancelServoSendTimer();
  if (appState.source !== "serial") {
    if (!delay) toast("请先连接串口设备", "warn");
    return;
  }
  if (delay) servoSendTimer = window.setTimeout(() => { servoSendTimer = null; queueServoSend(angle); }, delay);
  else queueServoSend(angle);
}

function applyServoConfig(config) {
  Object.assign(servoState, validateServoConfig(config));
  setServoAngle(servoState.angle);
}

async function loadServoConfig() {
  try {
    const response = await fetch("/api/servo-config");
    if (!response.ok) throw new Error();
    applyServoConfig(await response.json());
  } catch { renderServoControls(); }
}

$("#servoAngleSlider").addEventListener("input", (event) => {
  setServoAngle(event.target.value);
  scheduleServoSend(servoState.angle, 120);
});
$("#servoAngleSlider").addEventListener("change", (event) => {
  setServoAngle(event.target.value);
  scheduleServoSend(servoState.angle);
});
const servoHoldStops = [];

function bindServoHold(button, direction) {
  let pointerId = null;
  let startTimer = null;
  let repeatTimer = null;

  function stop() {
    if (startTimer !== null) window.clearTimeout(startTimer);
    if (repeatTimer !== null) window.clearInterval(repeatTimer);
    startTimer = null;
    repeatTimer = null;
    if (pointerId !== null && button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    pointerId = null;
  }

  function step() {
    if (button.disabled) { stop(); return; }
    setServoAngle(servoState.angle + direction);
    scheduleServoSend(servoState.angle);
    if (button.disabled) stop();
  }

  button.addEventListener("pointerdown", (event) => {
    if (button.disabled || event.button !== 0) return;
    stop();
    pointerId = event.pointerId;
    button.setPointerCapture(pointerId);
    step();
    if (pointerId !== null) {
      startTimer = window.setTimeout(() => {
        startTimer = null;
        repeatTimer = window.setInterval(step, 120);
      }, 350);
    }
  });
  button.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    const rect = button.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) stop();
  });
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("lostpointercapture", stop);
  button.addEventListener("click", (event) => {
    if (event.detail === 0) step();
  });
  servoHoldStops.push(stop);
}

bindServoHold($("#servoDecrease"), -1);
bindServoHold($("#servoIncrease"), 1);
window.addEventListener("blur", () => servoHoldStops.forEach((stop) => stop()));
$("#servoDirectForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = $("#servoDirectAngle").value;
  const angle = Number(value);
  if (!value.trim() || !Number.isInteger(angle) || angle < servoState.minAngle || angle > servoState.maxAngle) {
    toast(`请输入 ${servoState.minAngle}° 到 ${servoState.maxAngle}° 之间的整数角度`, "warn");
    return;
  }
  setServoAngle(angle);
  scheduleServoSend(angle);
});
$("#servoSettingsButton").addEventListener("click", () => {
  $("#servoMinInput").value = servoState.minAngle;
  $("#servoMaxInput").value = servoState.maxAngle;
  $("#servoSettingsDialog").showModal();
});
$("#cancelServoSettings").addEventListener("click", () => $("#servoSettingsDialog").close());
$("#servoSettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const config = validateServoConfig({ minAngle: $("#servoMinInput").value, maxAngle: $("#servoMaxInput").value });
    const response = await fetch("/api/servo-config", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error("舵机范围保存失败，请使用本地 web_server.py 启动页面");
    servoHoldStops.forEach((stop) => stop());
    cancelServoSendTimer();
    applyServoConfig(config);
    $("#servoSettingsDialog").close();
    toast("舵机角度范围已保存");
  } catch (error) { toast(error.message, "warn"); }
});
renderServoControls();
loadServoConfig();

function timestamp(date = new Date()) {
  return date.toLocaleTimeString("zh-CN", { hour12: false }) + `.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function setConnectionState(state, label, hint) {
  elements.connectionDot.className = `status-dot ${state}`;
  elements.connectionLabel.textContent = label;
  elements.connectionHint.textContent = hint;
}

function toast(message, type = "info") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  window.setTimeout(() => item.remove(), 3200);
}

function writeLog(direction, message, level = "info") {
  const entry = { time: timestamp(), direction, message: String(message), level };
  appState.logs.push(entry);
  if (appState.logs.length > 500) appState.logs.shift();
  if (direction === "RX" && elements.hideReceive.checked) return;

  const row = document.createElement("div");
  row.className = `log-line ${direction.toLowerCase()} ${level}`;
  const time = document.createElement("time");
  const tag = document.createElement("b");
  const text = document.createElement("span");
  time.textContent = entry.time;
  tag.textContent = direction;
  text.textContent = entry.message;
  row.append(time, tag, text);
  elements.consoleOutput.append(row);

  while (elements.consoleOutput.children.length > 300) {
    elements.consoleOutput.firstElementChild.remove();
  }
  if (elements.autoScroll.checked) elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
}

class SerialConnection {
  constructor(onLine, onBytes) {
    this.port = null;
    this.reader = null;
    this.reading = false;
    this.buffer = "";
    this.onLine = onLine;
    this.onBytes = onBytes;
  }

  async connect(options, selectedPort) {
    if (!("serial" in navigator)) throw new Error("当前浏览器不支持 Web Serial API");
    if (!selectedPort) throw new Error("请先选择串口");
    this.port = selectedPort;
    await this.port.open(options);
    this.reading = true;
    this.readLoop();
  }

  async readLoop() {
    const decoder = new TextDecoder();
    try {
      while (this.port?.readable && this.reading) {
        this.reader = this.port.readable.getReader();
        try {
          while (this.reading) {
            const { value, done } = await this.reader.read();
            if (done) break;
            this.onBytes(value);
            this.buffer += decoder.decode(value, { stream: true });
            const lines = this.buffer.split(/\r?\n/);
            this.buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.trim()) this.onLine(line.trim());
            }
          }
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    } catch (error) {
      if (this.reading) {
        writeLog("ERR", error.message, "error");
        handleUnexpectedDisconnect(error.message);
      }
    }
  }

  async send(payload, { appendNewline = true } = {}) {
    if (!this.port?.writable) throw new Error("串口尚未连接");
    let bytes;
    if (payload instanceof Uint8Array) {
      bytes = payload;
    } else {
      const text = String(payload);
      const output = appendNewline && !text.endsWith("\n") ? `${text}\n` : text;
      bytes = new TextEncoder().encode(output);
    }
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect() {
    this.reading = false;
    if (this.reader) await this.reader.cancel().catch(() => {});
    if (this.port) await this.port.close().catch(() => {});
    this.port = null;
    this.buffer = "";
  }
}

const serial = new SerialConnection(handleSerialLine, handleSerialBytes);
const consoleTextDecoder = new TextDecoder();
let consoleReceiveBuffer = "";
let consoleReceiveFlushTimer = null;

function formatHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function parseHexInput(input) {
  const compact = String(input)
    .replace(/0x/gi, "")
    .replace(/[\s,;:_-]+/g, "");
  if (!compact) throw new Error("请输入要发送的 HEX 字节");
  if (!/^[0-9a-f]+$/i.test(compact)) throw new Error("HEX 数据只能包含 0-9 和 A-F");
  if (compact.length % 2 !== 0) throw new Error("HEX 数据必须由完整字节组成，例如 AA 55 01");
  return Uint8Array.from(compact.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
}

const imuDefaultConfig = {
  frameFormat: "FF FE 84 14\nSEQ_L SEQ_H\nAX_L AX_H AY_L AY_H AZ_L AZ_H\nGX_L GX_H GY_L GY_H GZ_L GZ_H\nROLL_L ROLL_H PITCH_L PITCH_H YAW_L YAW_H\nCRC_H CRC_L",
  accelDivisor: 1000, gyroDivisor: 10, angleDivisor: 100,
};
const imuState = { config: imuDefaultConfig, header: [], fields: {}, frameLength: 0, bytes: [] };

function compileImuConfig(config) {
  const tokens = config.frameFormat.trim().split(/\s+/);
  const header = [];
  const fields = {};
  let fieldStarted = false;
  for (const [index, token] of tokens.entries()) {
    if (/^[0-9a-f]{2}$/i.test(token) && !fieldStarted) header.push(Number.parseInt(token, 16));
    else if (/^[A-Z][A-Z0-9]*_[LH]$/.test(token)) {
      fieldStarted = true;
      fields[token] = index;
    } else throw new Error(`无效的帧格式标记：${token}`);
  }
  if (!header.length || tokens.length > 256 || tokens.length <= header.length) throw new Error("帧格式需要帧头和字段，最长 256 字节");
  for (const name of ["AX", "AY", "AZ", "GX", "GY", "GZ", "ROLL", "PITCH", "YAW"]) {
    if (fields[`${name}_L`] === undefined || fields[`${name}_H`] === undefined) throw new Error(`缺少 ${name} 的 L/H 字节`);
  }
  const divisors = [config.accelDivisor, config.gyroDivisor, config.angleDivisor].map(Number);
  if (divisors.some((number) => !Number.isFinite(number) || number <= 0 || number > 1_000_000)) throw new Error("数据除数必须大于 0");
  return { config: { frameFormat: config.frameFormat.trim(), accelDivisor: divisors[0], gyroDivisor: divisors[1], angleDivisor: divisors[2] },
    header, fields, frameLength: tokens.length };
}

function applyImuConfig(config) {
  Object.assign(imuState, compileImuConfig(config));
  imuState.bytes = [];
  $("#imuRoll").textContent = "--";
  $("#imuPitch").textContent = "--";
  $("#imuYaw").textContent = "--";
  for (const id of ["imuAx", "imuAy", "imuAz", "imuGx", "imuGy", "imuGz"]) $(`#${id}`).textContent = "--";
}

function markImuDisconnected() {
  imuState.bytes = [];
}

function readImuSigned(frame, name) {
  const value = frame[imuState.fields[`${name}_L`]] | (frame[imuState.fields[`${name}_H`]] << 8);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function handleImuFrame(frame) {
  const { accelDivisor, gyroDivisor, angleDivisor } = imuState.config;
  const ax = readImuSigned(frame, "AX") / accelDivisor;
  const ay = readImuSigned(frame, "AY") / accelDivisor;
  const az = readImuSigned(frame, "AZ") / accelDivisor;
  const gx = readImuSigned(frame, "GX") / gyroDivisor;
  const gy = readImuSigned(frame, "GY") / gyroDivisor;
  const gz = readImuSigned(frame, "GZ") / gyroDivisor;
  const roll = readImuSigned(frame, "ROLL") / angleDivisor;
  const pitch = readImuSigned(frame, "PITCH") / angleDivisor;
  const yaw = readImuSigned(frame, "YAW") / angleDivisor;
  window.imuViewer?.setAttitude(roll, pitch, yaw);
  $("#imuRoll").textContent = roll.toFixed(2);
  $("#imuPitch").textContent = pitch.toFixed(2);
  $("#imuYaw").textContent = yaw.toFixed(2);
  $("#imuAx").textContent = ax.toFixed(3);
  $("#imuAy").textContent = ay.toFixed(3);
  $("#imuAz").textContent = az.toFixed(3);
  $("#imuGx").textContent = gx.toFixed(1);
  $("#imuGy").textContent = gy.toFixed(1);
  $("#imuGz").textContent = gz.toFixed(1);
}

function receiveImuBytes(chunk) {
  for (const byte of chunk) imuState.bytes.push(byte);
  const { header, frameLength } = imuState;
  while (imuState.bytes.length >= header.length) {
    const index = imuState.bytes.findIndex((_, position) =>
      position + header.length <= imuState.bytes.length && header.every((byte, offset) => imuState.bytes[position + offset] === byte));
    if (index < 0) {
      imuState.bytes.splice(0, Math.max(0, imuState.bytes.length - header.length + 1));
      break;
    }
    if (index) imuState.bytes.splice(0, index);
    if (imuState.bytes.length < frameLength) break;
    handleImuFrame(imuState.bytes.splice(0, frameLength));
  }
}

async function loadImuConfig() {
  try {
    const response = await fetch("/api/imu-config");
    if (!response.ok) throw new Error();
    applyImuConfig(await response.json());
  } catch { applyImuConfig(imuDefaultConfig); }
}

$("#imuConfigButton").addEventListener("click", () => {
  const config = imuState.config;
  $("#imuFrameFormat").value = config.frameFormat;
  $("#imuAccelDivisor").value = config.accelDivisor;
  $("#imuGyroDivisor").value = config.gyroDivisor;
  $("#imuAngleDivisor").value = config.angleDivisor;
  $("#imuConfigDialog").showModal();
});
$("#cancelImuConfig").addEventListener("click", () => $("#imuConfigDialog").close());
$("#imuConfigForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const compiled = compileImuConfig({
      frameFormat: $("#imuFrameFormat").value,
      accelDivisor: $("#imuAccelDivisor").value,
      gyroDivisor: $("#imuGyroDivisor").value,
      angleDivisor: $("#imuAngleDivisor").value,
    });
    const response = await fetch("/api/imu-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(compiled.config) });
    if (!response.ok) throw new Error("IMU 配置保存失败，请使用本地 web_server.py 启动页面");
    applyImuConfig(compiled.config);
    $("#imuConfigDialog").close();
    toast("IMU 帧格式已保存");
  } catch (error) { toast(error.message, "warn"); }
});
applyImuConfig(imuDefaultConfig);
loadImuConfig();

function flushConsoleReceiveBuffer() {
  if (consoleReceiveFlushTimer) window.clearTimeout(consoleReceiveFlushTimer);
  consoleReceiveFlushTimer = null;
  if (!consoleReceiveBuffer) return;
  const text = consoleReceiveBuffer;
  consoleReceiveBuffer = "";
  writeLog("RX", text);
}

function discardConsoleReceiveBuffer() {
  if (consoleReceiveFlushTimer) window.clearTimeout(consoleReceiveFlushTimer);
  consoleReceiveFlushTimer = null;
  consoleReceiveBuffer = "";
}

function handleSerialBytes(bytes) {
  receiveImuBytes(bytes);
  if (consoleState.receiveMode === "hex") {
    flushConsoleReceiveBuffer();
    writeLog("RX", formatHex(bytes));
    return;
  }
  const text = consoleTextDecoder.decode(bytes, { stream: true });
  if (!text) return;

  consoleReceiveBuffer += text;
  const lines = consoleReceiveBuffer.split(/\r\n|\r|\n/);
  consoleReceiveBuffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line) writeLog("RX", line);
  }

  if (consoleReceiveFlushTimer) window.clearTimeout(consoleReceiveFlushTimer);
  if (consoleReceiveBuffer.length >= 512) {
    flushConsoleReceiveBuffer();
  } else if (consoleReceiveBuffer) {
    consoleReceiveFlushTimer = window.setTimeout(flushConsoleReceiveBuffer, 80);
  }
}

function parseLooseData(line) {
  try {
    return JSON.parse(line);
  } catch {
    const result = {};
    const pairs = line.split(/[,;]\s*/);
    for (const pair of pairs) {
      const [rawKey, rawValue] = pair.split(/[:=]/, 2);
      if (!rawKey || rawValue === undefined) continue;
      const key = rawKey.trim();
      const value = rawValue.trim();
      result[key] = value === "true" ? true : value === "false" ? false : Number.isFinite(Number(value)) ? Number(value) : value;
    }
    return Object.keys(result).length ? result : null;
  }
}

function handleSerialLine(line) {
  const data = parseLooseData(line);
  if (data?.type === "error") {
    toast(data.message || "设备报告错误", "error");
  }
}

const serialSettingControls = [
  elements.dataBits,
  elements.stopBits,
  elements.parity,
  elements.flowControl,
];

function getSerialOptions() {
  return {
    baudRate: Number(elements.baudRate.value),
    dataBits: Number(elements.dataBits.value),
    stopBits: Number(elements.stopBits.value),
    parity: elements.parity.value,
    flowControl: elements.flowControl.value,
  };
}

function updateSerialFrameSummary() {
  const parityCode = { none: "N", odd: "O", even: "E" }[elements.parity.value];
  const frame = `${elements.dataBits.value}-${parityCode}-${elements.stopBits.value}`;
  elements.serialFrameSummary.textContent = elements.flowControl.value === "hardware" ? `${frame} · HW` : frame;
}

function setSerialSettingsDisabled(disabled) {
  for (const control of serialSettingControls) control.disabled = disabled;
  elements.serialConfigTrigger.disabled = disabled;
  if (disabled) setSerialConfigDialogOpen(false);
  elements.serialSettingsNote.textContent = disabled ? "连接中，配置已锁定" : "连接后配置将锁定";
}

for (const control of serialSettingControls) {
  control.addEventListener("change", updateSerialFrameSummary);
}
updateSerialFrameSummary();

async function connectSerial() {
  if (appState.source === "serial") {
    await disconnectCurrent("用户断开串口");
    return;
  }

  if (!appState.selectedPort) {
    setConnectionState("", "设备未连接", "请先在串口列表中选择设备");
    setPortMenuOpen(true, true);
    elements.portTrigger.focus();
    toast("请先选择串口", "warn");
    return;
  }

  setConnectionState("connecting", "正在连接…", `正在打开 ${elements.portSelected.textContent}`);
  elements.connectButton.disabled = true;
  try {
    const serialOptions = getSerialOptions();
    await serial.connect(serialOptions, appState.selectedPort);
    appState.source = "serial";
    renderServoControls();
    appState.connectedAt = Date.now();
    elements.portTrigger.disabled = true;
    elements.baudTrigger.disabled = true;
    setSerialSettingsDisabled(true);
    const frame = elements.serialFrameSummary.textContent;
    const flow = serialOptions.flowControl === "hardware" ? "硬件流控" : "无流控";
    setConnectionState("online", "PCB 已连接", `${elements.portSelected.textContent} · ${serialOptions.baudRate.toLocaleString()} baud · ${frame}`);
    elements.connectButton.innerHTML = '<span class="button-icon">×</span>断开设备';
    writeLog("SYS", `串口连接成功 · ${serialOptions.baudRate} baud · ${frame} · ${flow}`);
    toast("串口连接成功");
  } catch (error) {
    setConnectionState("error", "连接失败", error.message);
    writeLog("ERR", error.message, "error");
    toast(error.message, "error");
  } finally {
    elements.connectButton.disabled = false;
  }
}

async function disconnectCurrent(reason = "连接已断开") {
  servoHoldStops.forEach((stop) => stop());
  cancelServoSendTimer();
  markImuDisconnected();
  stopLoopSend();
  flushConsoleReceiveBuffer();
  if (appState.source === "serial") await serial.disconnect();
  appState.source = "idle";
  renderServoControls();
  appState.connectedAt = null;
  elements.portTrigger.disabled = false;
  elements.baudTrigger.disabled = false;
  setSerialSettingsDisabled(false);
  elements.connectButton.innerHTML = '<span class="button-icon">⚡</span>连接设备';
  setConnectionState("", "设备未连接", "");
  writeLog("SYS", reason);
}

function handleUnexpectedDisconnect(reason) {
  if (appState.source !== "serial") return;
  servoHoldStops.forEach((stop) => stop());
  cancelServoSendTimer();
  markImuDisconnected();
  stopLoopSend();
  flushConsoleReceiveBuffer();
  appState.source = "idle";
  renderServoControls();
  appState.connectedAt = null;
  elements.portTrigger.disabled = false;
  elements.baudTrigger.disabled = false;
  setSerialSettingsDisabled(false);
  elements.connectButton.innerHTML = '<span class="button-icon">⚡</span>连接设备';
  setConnectionState("error", "串口已断开", reason);
  toast("设备连接意外断开", "error");
}

function parseEscapeSequences(value) {
  return String(value).replace(/\\(x[\da-fA-F]{2}|r|n|t|0|\\)/g, (match, code) => {
    if (code[0].toLowerCase() === "x") return String.fromCharCode(Number.parseInt(code.slice(1), 16));
    return { r: "\r", n: "\n", t: "\t", 0: "\0", "\\": "\\" }[code] ?? match;
  });
}

function appendChecksum(bytes, type) {
  if (type === "sum8") {
    const sum = bytes.reduce((total, byte) => (total + byte) & 0xFF, 0);
    return Uint8Array.from([...bytes, sum]);
  }

  let crc = 0xFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
    }
  }
  return Uint8Array.from([...bytes, crc & 0xFF, (crc >>> 8) & 0xFF]);
}

async function buildSendPayload(value) {
  if (consoleState.sendMode === "hex") {
    const bytes = parseHexInput(value);
    return { bytes, display: formatHex(bytes) };
  }

  let text = elements.parseEscapes.checked ? parseEscapeSequences(value) : String(value);
  if (!text) throw new Error("请输入要发送的内容");
  if (elements.appendNewline.checked && !text.endsWith("\n")) text += "\r\n";
  return { bytes: new TextEncoder().encode(text), display: text.replace(/\r/g, "\\r").replace(/\n/g, "\\n") };
}

async function sendConsoleValue(value) {
  if (appState.source !== "serial") throw new Error("请先连接设备");
  const payload = await buildSendPayload(value);
  const bytes = elements.autoChecksum.checked
    ? appendChecksum(payload.bytes, elements.checksumType.value)
    : payload.bytes;
  writeLog("TX", elements.autoChecksum.checked ? formatHex(bytes) : payload.display);
  await serial.send(bytes, { appendNewline: false });
}

function stopLoopSend(message = "") {
  if (consoleState.loopTimer) window.clearTimeout(consoleState.loopTimer);
  consoleState.loopTimer = null;
  consoleState.loopActive = false;
  elements.sendButton.textContent = "发送 ↗";
  if (message) writeLog("SYS", message);
}

async function runLoopSend(value) {
  if (!consoleState.loopActive) return;
  try {
    await sendConsoleValue(value);
  } catch (error) {
    stopLoopSend();
    toast(error.message, "warn");
    return;
  }
  const interval = Math.max(50, Number(elements.loopInterval.value) || 1000);
  consoleState.loopTimer = window.setTimeout(() => runLoopSend(value), interval);
}

function setConsoleMode(direction, mode) {
  const isReceive = direction === "receive";
  const buttons = isReceive
    ? [elements.rxAscii, elements.rxHex]
    : [elements.txAscii, elements.txHex];
  for (const button of buttons) {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  if (isReceive) {
    flushConsoleReceiveBuffer();
    consoleState.receiveMode = mode;
    writeLog("SYS", `接收显示已切换为 ${mode.toUpperCase()}`);
    return;
  }

  consoleState.sendMode = mode;
  elements.sendModeLabel.textContent = `TX · ${mode.toUpperCase()}`;
  elements.commandInput.disabled = false;
  elements.commandInput.placeholder = mode === "hex"
    ? "输入 HEX 字节，例如 AA 55 01 0D 0A"
    : '输入文本或 JSON，例如 {"type":"ping"}';
  for (const control of [elements.appendNewline, elements.parseEscapes]) {
    control.disabled = mode !== "ascii";
    control.closest("label").classList.toggle("disabled", mode !== "ascii");
  }
}

function portDisplayName(port, index) {
  try {
    const info = port.getInfo();
    const vendor = info.usbVendorId?.toString(16).toUpperCase().padStart(4, "0");
    const product = info.usbProductId?.toString(16).toUpperCase().padStart(4, "0");
    const usbId = vendor && product ? ` · ${vendor}:${product}` : "";
    return `串口 ${index + 1}${usbId}`;
  } catch {
    return `串口 ${index + 1}`;
  }
}

function selectPort(port) {
  if (!appState.knownPorts.includes(port)) appState.knownPorts.push(port);
  appState.selectedPort = port;
  const index = appState.knownPorts.indexOf(port);
  elements.portSelected.textContent = portDisplayName(port, index);
  renderPortMenu();
}

function renderPortMenu() {
  elements.portMenu.innerHTML = "";

  if (!appState.knownPorts.length) {
    const empty = document.createElement("button");
    empty.className = "baud-option port-option";
    empty.type = "button";
    empty.disabled = true;
    empty.textContent = "未检测到已授权串口";
    elements.portMenu.append(empty);
  }

  appState.knownPorts.forEach((port, index) => {
    const option = document.createElement("button");
    const selected = port === appState.selectedPort;
    option.className = `baud-option port-option${selected ? " selected" : ""}`;
    option.type = "button";
    option.role = "option";
    option.setAttribute("aria-selected", String(selected));
    option.textContent = portDisplayName(port, index);
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      selectPort(port);
      setPortMenuOpen(false);
      elements.portTrigger.focus();
    });
    elements.portMenu.append(option);
  });
}

async function authorizeFirstSerialPort() {
  try {
    const port = await navigator.serial.requestPort();
    await refreshSerialPorts(port);
    selectPort(port);
    setPortMenuOpen(false);
    elements.portTrigger.focus();
  } catch (error) {
    if (error.name !== "NotFoundError") toast(error.message, "error");
  }
}

async function refreshSerialPorts(preferredPort = null) {
  if (!("serial" in navigator)) return;
  const ports = await navigator.serial.getPorts();
  if (preferredPort && !ports.includes(preferredPort)) ports.push(preferredPort);
  appState.knownPorts = ports;

  if (preferredPort) appState.selectedPort = preferredPort;
  if (appState.selectedPort && !ports.includes(appState.selectedPort)) appState.selectedPort = null;
  if (!appState.selectedPort && ports.length === 1) appState.selectedPort = ports[0];

  if (appState.selectedPort) {
    elements.portSelected.textContent = portDisplayName(
      appState.selectedPort,
      ports.indexOf(appState.selectedPort)
    );
  } else {
    elements.portSelected.textContent = "选择串口";
  }
  renderPortMenu();
}

function setPortMenuOpen(open, focusSelected = false) {
  elements.portSelect.classList.toggle("open", open);
  elements.portTrigger.setAttribute("aria-expanded", String(open));
  elements.portMenu.hidden = !open;
  if (open && focusSelected) {
    requestAnimationFrame(() => {
      const target = elements.portMenu.querySelector(".port-option.selected:not(:disabled)")
        || elements.portMenu.querySelector(".port-option:not(:disabled)");
      target?.focus();
    });
  }
}

const baudOptions = [...elements.baudMenu.querySelectorAll(".baud-option")];

function setBaudMenuOpen(open, focusSelected = false) {
  elements.baudSelect.classList.toggle("open", open);
  elements.baudTrigger.setAttribute("aria-expanded", String(open));
  elements.baudMenu.hidden = !open;
  if (open && focusSelected) {
    requestAnimationFrame(() => {
      baudOptions.find((option) => option.classList.contains("selected"))?.focus();
    });
  }
}

function setSerialConfigDialogOpen(open) {
  const wasOpen = !elements.serialConfigDialog.hidden;
  elements.serialConfigTrigger.setAttribute("aria-expanded", String(open));
  elements.serialConfigDialog.hidden = !open;
  document.body.classList.toggle("modal-open", open);
  if (open) {
    requestAnimationFrame(() => elements.dataBits.focus());
  } else if (wasOpen && !elements.serialConfigTrigger.disabled) {
    elements.serialConfigTrigger.focus();
  }
}

function chooseBaud(option) {
  elements.baudRate.value = option.dataset.value;
  elements.baudSelected.textContent = option.textContent.trim();
  for (const item of baudOptions) {
    const selected = item === option;
    item.classList.toggle("selected", selected);
    item.setAttribute("aria-selected", String(selected));
  }
  setBaudMenuOpen(false);
  elements.baudTrigger.focus();
}

elements.portTrigger.addEventListener("click", async (event) => {
  event.stopPropagation();
  if (!appState.knownPorts.length) {
    await authorizeFirstSerialPort();
    return;
  }
  await refreshSerialPorts();
  const open = !elements.portSelect.classList.contains("open");
  setPortMenuOpen(open, open);
  setBaudMenuOpen(false);
  setSerialConfigDialogOpen(false);
});

elements.portTrigger.addEventListener("keydown", async (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  if (!appState.knownPorts.length) {
    await authorizeFirstSerialPort();
    return;
  }
  await refreshSerialPorts();
  setPortMenuOpen(true, true);
  setBaudMenuOpen(false);
  setSerialConfigDialogOpen(false);
});

elements.portMenu.addEventListener("keydown", (event) => {
  const options = [...elements.portMenu.querySelectorAll(".port-option:not(:disabled)")];
  const currentIndex = options.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    setPortMenuOpen(false);
    elements.portTrigger.focus();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  let nextIndex = currentIndex;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = options.length - 1;
  if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + options.length) % options.length;
  if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + options.length) % options.length;
  options[nextIndex]?.focus();
});

elements.baudTrigger.addEventListener("click", (event) => {
  event.stopPropagation();
  setBaudMenuOpen(!elements.baudSelect.classList.contains("open"), true);
  setPortMenuOpen(false);
  setSerialConfigDialogOpen(false);
});

elements.baudTrigger.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  setBaudMenuOpen(true, true);
  setPortMenuOpen(false);
  setSerialConfigDialogOpen(false);
});

elements.serialConfigTrigger.addEventListener("click", (event) => {
  event.stopPropagation();
  setPortMenuOpen(false);
  setBaudMenuOpen(false);
  setSerialConfigDialogOpen(true);
});

elements.serialConfigClose.addEventListener("click", () => setSerialConfigDialogOpen(false));
elements.serialConfigDone.addEventListener("click", () => setSerialConfigDialogOpen(false));

elements.serialConfigDialog.addEventListener("click", (event) => {
  if (event.target === elements.serialConfigDialog) setSerialConfigDialogOpen(false);
});

elements.serialConfigDialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setSerialConfigDialogOpen(false);
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...elements.serialConfigDialogPanel.querySelectorAll("button:not(:disabled), select:not(:disabled)")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

for (const option of baudOptions) {
  option.addEventListener("click", (event) => {
    event.stopPropagation();
    chooseBaud(option);
  });
}

elements.baudMenu.addEventListener("keydown", (event) => {
  const currentIndex = baudOptions.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    setBaudMenuOpen(false);
    elements.baudTrigger.focus();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  let nextIndex = currentIndex;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = baudOptions.length - 1;
  if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + baudOptions.length) % baudOptions.length;
  if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + baudOptions.length) % baudOptions.length;
  baudOptions[nextIndex].focus();
});

document.addEventListener("click", (event) => {
  if (!elements.baudSelect.contains(event.target)) setBaudMenuOpen(false);
  if (!elements.portSelect.contains(event.target)) setPortMenuOpen(false);
});

elements.rxAscii.addEventListener("click", () => setConsoleMode("receive", "ascii"));
elements.rxHex.addEventListener("click", () => setConsoleMode("receive", "hex"));
elements.txAscii.addEventListener("click", () => setConsoleMode("send", "ascii"));
elements.txHex.addEventListener("click", () => setConsoleMode("send", "hex"));

elements.logMode.addEventListener("change", () => {
  elements.consoleOutput.classList.toggle("plain-receive", !elements.logMode.checked);
});

elements.receiveWrap.addEventListener("change", () => {
  elements.consoleOutput.classList.toggle("no-wrap", !elements.receiveWrap.checked);
});

elements.autoChecksum.addEventListener("change", () => {
  elements.checksumType.disabled = !elements.autoChecksum.checked;
  elements.checksumSetting.classList.toggle("disabled", !elements.autoChecksum.checked);
});

elements.connectButton.addEventListener("click", connectSerial);

$("#consoleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = elements.commandInput.value;
  if (consoleState.loopActive) {
    stopLoopSend("循环发送已停止");
    return;
  }
  try {
    if (elements.loopSend.checked) {
      const interval = Number(elements.loopInterval.value);
      if (!Number.isFinite(interval) || interval < 50) throw new Error("循环周期不能小于 50 ms");
      consoleState.loopActive = true;
      elements.sendButton.textContent = "停止";
      writeLog("SYS", `循环发送已启动 · ${interval} ms`);
      await runLoopSend(value);
    } else {
      await sendConsoleValue(value);
      elements.commandInput.value = "";
    }
  } catch (error) {
    stopLoopSend();
    toast(error.message, "warn");
  }
});

$("#clearLog").addEventListener("click", () => {
  discardConsoleReceiveBuffer();
  elements.consoleOutput.innerHTML = "";
  appState.logs.length = 0;
  writeLog("SYS", "终端记录已清空");
});

$("#exportLog").addEventListener("click", () => {
  const receiveLogs = appState.logs.filter((item) => item.direction === "RX");
  if (!receiveLogs.length) return toast("暂无接收数据可保存", "warn");
  const content = receiveLogs.map((item) => `${item.time}\t${item.message}`).join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `fishlink-rx-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("接收数据已保存");
});

if ("serial" in navigator) {
  refreshSerialPorts().catch((error) => writeLog("ERR", error.message, "warn"));
  navigator.serial.addEventListener("connect", () => refreshSerialPorts());
  navigator.serial.addEventListener("disconnect", (event) => {
    if (event.target === serial.port) handleUnexpectedDisconnect("USB 设备已拔出");
    refreshSerialPorts();
  });
} else {
  elements.connectButton.disabled = true;
  elements.portTrigger.disabled = true;
  elements.baudTrigger.disabled = true;
  elements.serialConfigTrigger.disabled = true;
  elements.connectButton.title = "请使用支持 Web Serial 的桌面 Chrome 或 Edge";
  writeLog("SYS", "未检测到 Web Serial API，请使用桌面 Chrome 或 Edge", "warn");
}

window.addEventListener("beforeunload", () => {
  if (serial.reader) serial.reader.cancel().catch(() => {});
});
