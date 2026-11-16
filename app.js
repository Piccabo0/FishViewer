"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  connectButton: $("#connectButton"),
  baudRate: $("#baudRate"),
  baudSelect: $("#baudSelect"),
  baudTrigger: $("#baudTrigger"),
  baudMenu: $("#baudMenu"),
  baudSelected: $("#baudSelected"),
  connectionDot: $("#connectionDot"),
  connectionLabel: $("#connectionLabel"),
  connectionHint: $("#connectionHint"),
  consoleOutput: $("#consoleOutput"),
  commandInput: $("#commandInput"),
  autoScroll: $("#autoScroll"),
  showTimestamp: $("#showTimestamp"),
  appendNewline: $("#appendNewline"),
  sendModeLabel: $("#sendModeLabel"),
  rxAscii: $("#rxAscii"),
  rxHex: $("#rxHex"),
  txAscii: $("#txAscii"),
  txHex: $("#txHex"),
  attitudeChart: $("#attitudeChart"),
  gyroChart: $("#gyroChart"),
  angularAccelChart: $("#angularAccelChart"),
  chartEmpty: $("#chartEmpty"),
  toastRegion: $("#toastRegion"),
};

const telemetry = {
  yaw: null,
  pitch: null,
  roll: null,
  gyroX: null,
  gyroY: null,
  gyroZ: null,
  angularAccelX: null,
  angularAccelY: null,
  angularAccelZ: null,
};

const appState = {
  source: "idle",
  connectedAt: null,
  lastPacketAt: 0,
  packetCounter: 0,
  packetRate: 0,
  logs: [],
  history: [],
};

const consoleState = {
  receiveMode: "ascii",
  sendMode: "ascii",
};

const numberAliases = {
  yaw: ["yaw", "heading", "yawDeg"],
  pitch: ["pitch", "pitchDeg"],
  roll: ["roll", "rollDeg"],
  gyroX: ["gyroX", "gx", "omegaX", "angularVelocityX"],
  gyroY: ["gyroY", "gy", "omegaY", "angularVelocityY"],
  gyroZ: ["gyroZ", "gz", "omegaZ", "angularVelocityZ"],
  angularAccelX: ["angularAccelX", "alphaX", "angularAccelerationX"],
  angularAccelY: ["angularAccelY", "alphaY", "angularAccelerationY"],
  angularAccelZ: ["angularAccelZ", "alphaZ", "angularAccelerationZ"],
};

function firstValue(object, aliases) {
  for (const key of aliases) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

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

  async connect(baudRate) {
    if (!("serial" in navigator)) throw new Error("当前浏览器不支持 Web Serial API");
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
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

function handleSerialBytes(bytes) {
  if (consoleState.receiveMode === "hex") {
    writeLog("RX", formatHex(bytes));
    return;
  }
  const text = consoleTextDecoder.decode(bytes, { stream: true });
  if (text) writeLog("RX", text);
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
  if (!data) return;
  const imuData = data.imu && typeof data.imu === "object" ? data.imu : {};
  const hasImuField = Object.values(numberAliases).some((aliases) =>
    aliases.some((key) => data[key] !== undefined || imuData[key] !== undefined)
  );
  if (hasImuField) {
    handleTelemetry(data);
  } else if (data.type === "error") {
    toast(data.message || "设备报告错误", "error");
  }
}

function normalizeTelemetry(data) {
  const next = { ...telemetry };
  const source = data.imu && typeof data.imu === "object" ? { ...data, ...data.imu } : data;
  for (const [target, aliases] of Object.entries(numberAliases)) {
    const value = Number(firstValue(source, aliases));
    if (Number.isFinite(value)) next[target] = value;
  }
  return next;
}

function handleTelemetry(data) {
  Object.assign(telemetry, normalizeTelemetry(data));
  appState.lastPacketAt = Date.now();
  appState.packetCounter += 1;

  appState.history.push({ time: Date.now(), ...telemetry });
  if (appState.history.length > 200) appState.history.shift();

  updateTelemetryStatus();
  charts.forEach((chart) => chart.draw());
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function updateTelemetryStatus() {
  setText("#packetRate", appState.packetRate);
  elements.chartEmpty.classList.add("hidden");
}

class TelemetryChart {
  constructor(canvas, series) {
    this.canvas = canvas;
    this.series = series;
    this.context = canvas.getContext("2d");
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas.parentElement);
  }

  draw() {
    const rect = this.canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;
    this.canvas.width = Math.round(rect.width * scale);
    this.canvas.height = Math.round(rect.height * scale);
    const ctx = this.context;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const padding = { top: 10, right: 8, bottom: 19, left: 38 };
    const width = rect.width - padding.left - padding.right;
    const height = rect.height - padding.top - padding.bottom;
    ctx.strokeStyle = "rgba(44,113,116,.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + height * i / 4;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + width, y);
      ctx.stroke();
    }

    if (appState.history.length < 2) return;
    const visible = appState.history.slice(-200);
    const values = visible.flatMap((point) =>
      this.series.map((item) => point[item.key]).filter(Number.isFinite)
    );
    if (!values.length) return;

    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    const span = max - min || Math.max(Math.abs(max) * 0.1, 1);
    min -= span * 0.12;
    max += span * 0.12;

    if (min < 0 && max > 0) {
      const zeroY = padding.top + (1 - (0 - min) / (max - min)) * height;
      ctx.strokeStyle = "rgba(44,113,116,.18)";
      ctx.beginPath();
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(padding.left + width, zeroY);
      ctx.stroke();
    }

    for (const item of this.series) {
      ctx.beginPath();
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = item.color;
      ctx.shadowBlur = 4;
      let drawing = false;
      visible.forEach((point, index) => {
        const value = point[item.key];
        if (!Number.isFinite(value)) {
          drawing = false;
          return;
        }
        const x = padding.left + index / Math.max(visible.length - 1, 1) * width;
        const y = padding.top + (1 - (value - min) / (max - min)) * height;
        if (!drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = "rgba(84,117,122,.68)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(max.toFixed(1), padding.left - 5, padding.top + 3);
    ctx.fillText(min.toFixed(1), padding.left - 5, padding.top + height);
    ctx.textAlign = "left";
    ctx.fillText("-30s", padding.left, rect.height - 5);
    ctx.textAlign = "right";
    ctx.fillText("现在", rect.width - padding.right, rect.height - 5);
  }
}

const axisColors = ["#e96868", "#26a976", "#4c88d2"];
const charts = [
  new TelemetryChart(elements.attitudeChart, [
    { key: "roll", color: axisColors[0] },
    { key: "pitch", color: axisColors[1] },
    { key: "yaw", color: axisColors[2] },
  ]),
  new TelemetryChart(elements.gyroChart, [
    { key: "gyroX", color: axisColors[0] },
    { key: "gyroY", color: axisColors[1] },
    { key: "gyroZ", color: axisColors[2] },
  ]),
  new TelemetryChart(elements.angularAccelChart, [
    { key: "angularAccelX", color: axisColors[0] },
    { key: "angularAccelY", color: axisColors[1] },
    { key: "angularAccelZ", color: axisColors[2] },
  ]),
];

async function connectSerial() {
  if (appState.source === "serial") {
    await disconnectCurrent("用户断开串口");
    return;
  }

  setConnectionState("connecting", "正在连接…", "请在浏览器窗口中选择串口");
  elements.connectButton.disabled = true;
  try {
    const baud = Number(elements.baudRate.value);
    await serial.connect(baud);
    appState.source = "serial";
    appState.connectedAt = Date.now();
    setConnectionState("online", "PCB 已连接", `${baud.toLocaleString()} baud · 8-N-1`);
    elements.connectButton.innerHTML = '<span class="button-icon">×</span>断开设备';
    writeLog("SYS", `串口连接成功，波特率 ${baud}`);
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
  if (appState.source === "serial") await serial.disconnect();
  appState.source = "idle";
  appState.connectedAt = null;
  elements.connectButton.innerHTML = '<span class="button-icon">⚡</span>连接设备';
  setConnectionState("", "设备未连接", "请选择波特率并连接设备");
  writeLog("SYS", reason);
}

function handleUnexpectedDisconnect(reason) {
  if (appState.source !== "serial") return;
  appState.source = "idle";
  appState.connectedAt = null;
  elements.connectButton.innerHTML = '<span class="button-icon">⚡</span>连接设备';
  setConnectionState("error", "串口已断开", reason);
  toast("设备连接意外断开", "error");
}

async function sendRaw(text, display = true, appendNewline = true) {
  const value = String(text);
  if (!value) return;
  if (display) writeLog("TX", value);
  if (appState.source === "serial") {
    await serial.send(value, { appendNewline });
    return;
  }
  throw new Error("请先连接设备");
}

async function sendConsoleValue(value) {
  if (consoleState.sendMode === "hex") {
    const bytes = parseHexInput(value);
    if (appState.source !== "serial") throw new Error("请先连接设备");
    writeLog("TX", formatHex(bytes));
    await serial.send(bytes, { appendNewline: false });
    return;
  }
  await sendRaw(value, true, elements.appendNewline.checked);
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
    consoleState.receiveMode = mode;
    writeLog("SYS", `接收显示已切换为 ${mode.toUpperCase()}`);
    return;
  }

  consoleState.sendMode = mode;
  elements.sendModeLabel.textContent = `TX · ${mode.toUpperCase()}`;
  elements.commandInput.placeholder = mode === "hex"
    ? "输入 HEX 字节，例如 AA 55 01 0D 0A"
    : '输入文本或 JSON，例如 {"type":"ping"}';
  elements.appendNewline.disabled = mode === "hex";
  elements.appendNewline.closest("label").classList.toggle("disabled", mode === "hex");
}

const baudOptions = $$(".baud-option");

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

elements.baudTrigger.addEventListener("click", (event) => {
  event.stopPropagation();
  setBaudMenuOpen(!elements.baudSelect.classList.contains("open"), true);
});

elements.baudTrigger.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  setBaudMenuOpen(true, true);
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
});

elements.rxAscii.addEventListener("click", () => setConsoleMode("receive", "ascii"));
elements.rxHex.addEventListener("click", () => setConsoleMode("receive", "hex"));
elements.txAscii.addEventListener("click", () => setConsoleMode("send", "ascii"));
elements.txHex.addEventListener("click", () => setConsoleMode("send", "hex"));

elements.showTimestamp.addEventListener("change", () => {
  elements.consoleOutput.classList.toggle("hide-timestamps", !elements.showTimestamp.checked);
});

for (const button of $$(".quick-command")) {
  button.addEventListener("click", async () => {
    const command = button.dataset.command;
    try {
      await sendRaw(command, true, elements.appendNewline.checked);
    } catch (error) {
      toast(error.message, "warn");
    }
  });
}

elements.connectButton.addEventListener("click", connectSerial);

$("#consoleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = elements.commandInput.value;
  try {
    await sendConsoleValue(value);
    elements.commandInput.value = "";
  } catch (error) {
    toast(error.message, "warn");
  }
});

$("#clearLog").addEventListener("click", () => {
  elements.consoleOutput.innerHTML = "";
  appState.logs.length = 0;
  writeLog("SYS", "终端记录已清空");
});

$("#exportLog").addEventListener("click", () => {
  if (!appState.logs.length) return toast("暂无日志可导出", "warn");
  const content = appState.logs.map((item) => `${item.time}\t${item.direction}\t${item.message}`).join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `fishlink-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("日志已导出");
});

if ("serial" in navigator) {
  navigator.serial.addEventListener("disconnect", () => handleUnexpectedDisconnect("USB 设备已拔出"));
} else {
  elements.connectButton.disabled = true;
  elements.connectButton.title = "请使用支持 Web Serial 的桌面 Chrome 或 Edge";
  writeLog("SYS", "未检测到 Web Serial API，请使用桌面 Chrome 或 Edge", "warn");
}

let previousPacketCount = 0;
window.setInterval(() => {
  appState.packetRate = appState.packetCounter - previousPacketCount;
  previousPacketCount = appState.packetCounter;
  setText("#packetRate", appState.packetRate);

  if (appState.source !== "idle" && appState.lastPacketAt && Date.now() - appState.lastPacketAt > 3000) {
    setConnectionState("error", "数据已超时", "串口仍连接，但超过 3 秒未收到遥测");
  }
}, 1000);

window.addEventListener("beforeunload", () => {
  if (serial.reader) serial.reader.cancel().catch(() => {});
});

charts.forEach((chart) => chart.draw());
