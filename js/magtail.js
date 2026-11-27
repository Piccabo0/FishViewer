"use strict";

if (document.body.classList.contains("secondary-board")) {
  const panel = document.querySelector(".magtail-panel");
  const status = panel.querySelector("#magtailStatus");
  const adcDisplay = panel.querySelector("#magtailAdc");
  const telemetryButton = panel.querySelector("#magtailTelemetryToggle");
  const connectionWarning = document.querySelector("#magtailConnectionWarning");
  const connectionWarningClose = document.querySelector("#magtailConnectionWarningClose");
  const dutyInput = panel.querySelector("#magtailDuty");
  const frequencyInput = panel.querySelector("#magtailFrequency");
  const voltageOutput = panel.querySelector("#magtailVoltage");
  const modeNames = {
    "00": "停止", "01": "正转", "02": "反转", "03": "刹车", "04": "往复转动",
  };
  let receiveBuffer = [];
  let telemetryEnabled = false;
  let telemetryPending = false;

  connectionWarningClose.addEventListener("click", () => connectionWarning.close());

  function showMagTailError(error) {
    if (error.message === "请先连接第二页的开发板") {
      if (!connectionWarning.open) connectionWarning.showModal();
      connectionWarningClose.focus();
      return;
    }
    status.textContent = error.message;
    toast(error.message, "warn");
  }

  function showTelemetryState() {
    telemetryButton.textContent = telemetryEnabled ? "停止回传" : "开启回传";
    telemetryButton.classList.toggle("active", telemetryEnabled);
    telemetryButton.setAttribute("aria-pressed", String(telemetryEnabled));
  }

  function updateVoltage() {
    const duty = Number(dutyInput.value);
    voltageOutput.textContent = dutyInput.value !== "" && Number.isFinite(duty) && duty >= 0 && duty <= 99
      ? `${(duty * 30 / 99).toFixed(1)} V`
      : "-- V";
  }

  dutyInput.addEventListener("input", updateVoltage);
  panel.querySelectorAll("[data-step-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = panel.querySelector(`#${button.dataset.stepTarget}`);
      const current = input.value === "" ? Number(input.min) : Math.round(Number(input.value));
      const next = Math.min(Number(input.max), Math.max(Number(input.min), current + Number(button.dataset.stepDelta)));
      input.value = String(next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  async function sendMagTailFrame(frame, message) {
    if (appState.source !== "serial") throw new Error("请先连接第二页的开发板");
    await serial.send(Uint8Array.from(frame), { appendNewline: false });
    writeLog("TX", formatHex(frame));
    status.textContent = message;
  }

  panel.querySelectorAll("[data-magtail-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      const mode = button.dataset.magtailMode;
      const modeByte = Number.parseInt(mode, 16);
      try {
        await sendMagTailFrame([0xFF, 0xFE, 0x02, 0x01, modeByte, modeByte], `已发送：${modeNames[mode]}`);
        if (modeByte <= 4) {
          panel.querySelectorAll(".magtail-action-grid button").forEach((item) => {
            item.classList.toggle("active", item === button);
          });
        }
      } catch (error) {
        showMagTailError(error);
      }
    });
  });

  telemetryButton.addEventListener("click", async () => {
    if (telemetryPending) return;
    telemetryPending = true;
    telemetryButton.disabled = true;
    const connection = appState.connectedAt;
    const mode = telemetryEnabled ? 0x06 : 0x05;
    try {
      await sendMagTailFrame([0xFF, 0xFE, 0x02, 0x01, mode, mode],
        `已发送：${telemetryEnabled ? "停止" : "开启"}电流回传`);
      if (appState.source === "serial" && appState.connectedAt === connection) {
        telemetryEnabled = !telemetryEnabled;
        showTelemetryState();
      }
    } catch (error) {
      showMagTailError(error);
    } finally {
      telemetryPending = false;
      telemetryButton.disabled = false;
    }
  });

  window.addEventListener("fishlink:disconnected", () => {
    telemetryEnabled = false;
    showTelemetryState();
    adcDisplay.textContent = "--";
    adcDisplay.removeAttribute("title");
    receiveBuffer = [];
  });

  panel.querySelector("#magtailParameters").addEventListener("submit", async (event) => {
    event.preventDefault();
    const duty = Number(dutyInput.value);
    const frequency = Number(frequencyInput.value);
    if (!Number.isInteger(duty) || duty < 0 || duty > 99 ||
        !Number.isInteger(frequency) || frequency < 1 || frequency > 50) {
      status.textContent = "占空比须为 0–99%，往复频率须为 1–50 Hz";
      return;
    }
    // The protocol example uses CMD + 0x07 + DUTY + FREQ for this checksum.
    const checksum = (0x02 + 0x07 + duty + frequency) & 0xFF;
    try {
      await sendMagTailFrame(
        [0xFF, 0xFE, 0x02, 0x03, 0x07, duty, frequency, checksum],
        `已设置：${duty}% · ${frequency} Hz`
      );
    } catch (error) {
      showMagTailError(error);
    }
  });

  serial.addByteListener((bytes) => {
    receiveBuffer.push(...bytes);
    while (receiveBuffer.length >= 7) {
      const start = receiveBuffer.findIndex((byte, index) =>
        byte === 0xFF && receiveBuffer[index + 1] === 0xFE);
      if (start < 0) {
        receiveBuffer = receiveBuffer.slice(-1);
        break;
      }
      if (start > 0) receiveBuffer.splice(0, start);
      if (receiveBuffer.length < 7) break;
      if (receiveBuffer[2] === 0x82 && receiveBuffer[3] === 0x02) {
        const adc = receiveBuffer[4] | (receiveBuffer[5] << 8);
        if (adc <= 0x0FFF) {
          adcDisplay.textContent = String(adc);
          adcDisplay.title = `0x${adc.toString(16).toUpperCase().padStart(4, "0")}`;
        }
        receiveBuffer.splice(0, 7);
      } else {
        receiveBuffer.shift();
      }
    }
    if (receiveBuffer.length > 64) receiveBuffer = receiveBuffer.slice(-6);
  });
}
