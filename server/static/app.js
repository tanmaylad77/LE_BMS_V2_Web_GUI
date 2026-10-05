const state = {
  latest: null,
  viewLog: null,
  heatmapHover: null,
  lastTempUpdatedAt: null,
  tempFlashAt: new Map(),
  lastVcelUpdatedAt: null,
  voltageFlashAt: new Map(),
  activePage: "dashboard",
  dark: localStorage.getItem("le-bms-theme") !== "light",
};

const tempScale = [
  { value: -50, color: [36, 111, 159] },
  { value: 0, color: [50, 156, 210] },
  { value: 18, color: [52, 199, 130] },
  { value: 35, color: [233, 185, 70] },
  { value: 50, color: [240, 91, 80] },
];

const units = {
  VPCK: "V",
  IPCK: "A",
  WPCK: "W",
  PSOC: "%",
  RCAP: "Ah",
  VCLV: "V",
  VCHV: "V",
  TCLT: "C",
  TCHT: "C",
  DCLA: "A",
  CCLA: "A",
};

const $ = (id) => document.getElementById(id);

function css(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function formatValue(value, unit = "") {
  if (value === undefined || value === null || value === "") return "--";
  if (typeof value === "boolean") return value ? "SET" : "OK";
  if (typeof value === "number") {
    const digits = Math.abs(value) >= 100 ? 0 : 2;
    return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
  }
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function formatCellMv(value) {
  return Number.isInteger(value) && value > 0 ? (value / 1000).toFixed(3) : "--";
}

function formatTime(iso) {
  if (!iso) return "--";
  return new Date(iso).toLocaleTimeString();
}

function ageText(iso) {
  if (!iso) return "--";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 1) return "live";
  if (seconds < 60) return `${seconds}s old`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m old`;
  return `${Math.floor(minutes / 60)}h old`;
}

function ageClass(iso) {
  if (!iso) return "stale";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 2) return "fresh";
  if (seconds < 10) return "warm";
  return "stale";
}

function renderAgeChip(id, updatedAt) {
  const el = $(id);
  if (!el) return;
  el.textContent = ageText(updatedAt);
  el.className = `age-chip ${ageClass(updatedAt)}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail || response.statusText);
  }
  return response.json();
}

async function refreshPorts() {
  const data = await api("/api/ports");
  const select = $("portSelect");
  const previous = select.value;
  select.innerHTML = "";
  for (const port of data.ports) {
    const option = document.createElement("option");
    option.value = port.device;
    option.textContent = `${port.device}${port.description ? ` - ${port.description}` : ""}`;
    select.appendChild(option);
  }
  if (data.ports.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No serial ports found";
    select.appendChild(option);
  }
  if (previous) select.value = previous;
}

function render(snapshot) {
  state.latest = snapshot;
  const telemetry = snapshot.telemetry || {};
  const connection = snapshot.connection || {};
  const derived = snapshot.derived || {};
  const updatedAt = snapshot.updated_at || {};

  const badge = $("connectionBadge");
  badge.textContent = connection.connected ? `Connected ${connection.port || ""}` : "Disconnected";
  badge.className = `badge ${connection.connected ? "good" : "bad"}`;
  $("portStatus").textContent = connection.error
    ? `Port ${connection.port || "--"}: ${connection.error}`
    : `Port ${connection.port || "--"} at ${connection.baudrate || 115200} baud`;
  $("lastLine").textContent = `Last line: ${formatTime(connection.last_line_at)}`;
  $("rxChip").textContent = formatTime(connection.last_line_at);
  $("bootChip").textContent = formatBoot(telemetry.BOOT);
  $("svalChip").textContent = telemetry.SVAL === undefined ? "--" : telemetry.SVAL ? "Trusted" : "Untrusted";
  $("svalChip").style.color = telemetry.SVAL === undefined ? "var(--muted)" : telemetry.SVAL ? "var(--good)" : "var(--warn)";
  $("infoChip").textContent = telemetry.INFO || "Waiting for telemetry";

  for (const key of ["VPCK", "IPCK", "WPCK", "PSOC", "RCAP", "VCLV", "VCHV", "TCLT", "TCHT", "DCLA", "CCLA", "STAT"]) {
    $(key).textContent = formatValue(telemetry[key], units[key]);
  }
  $("PSOC_RING").textContent = formatValue(telemetry.PSOC, "%");
  const soc = typeof telemetry.PSOC === "number" ? Math.max(0, Math.min(100, telemetry.PSOC)) : 0;
  $("socRing").style.setProperty("--soc-angle", `${soc * 3.6}deg`);
  for (const key of ["VCLN", "VCHN", "TCLN", "TCHN"]) {
    $(key).textContent = telemetry[key] ?? "--";
  }
  for (const key of ["VLCK", "ICLK", "TLCK"]) {
    const el = $(key);
    el.textContent = formatValue(telemetry[key]);
    el.style.color = telemetry[key] ? "var(--bad)" : "var(--good)";
  }

  renderBNode(derived.b_node || {});
  renderCharts(telemetry, derived.cells || [], updatedAt);
  renderLog(snapshot.raw_log || []);
}

function setupPageNavigation() {
  for (const button of document.querySelectorAll("[data-page-target]")) {
    button.addEventListener("click", () => {
      const page = button.dataset.pageTarget;
      state.activePage = page;
      for (const navButton of document.querySelectorAll("[data-page-target]")) {
        navButton.classList.toggle("active", navButton.dataset.pageTarget === page);
      }
      for (const pageEl of document.querySelectorAll(".page")) {
        pageEl.classList.toggle("active", pageEl.id === `page-${page}`);
      }
      if (page === "telemetry" && state.latest) {
        const telemetry = state.latest.telemetry || {};
        renderCharts(telemetry, state.latest.derived?.cells || [], state.latest.updated_at || {});
      }
    });
  }
}

function formatBoot(value) {
  if (!value) return "--";
  if (typeof value === "object") {
    return value.count === undefined ? "--" : `#${value.count}`;
  }
  return String(value);
}

function normalizeTemperatureSeries(values) {
  if (!Array.isArray(values)) return [];
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  const looksLikeRawDeciC = numeric.some((value) => Math.abs(value) > 150);
  return values.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    return looksLikeRawDeciC ? value / 10 : value;
  });
}

function renderCharts(telemetry, cells, updatedAt = {}) {
  const cellValues = cells.map((cell) => cell.millivolts);
  markVoltageFreshness(updatedAt.VCEL, cellValues);
  renderAgeChip("voltageAge", updatedAt.VCEL);
  renderAgeChip("currentAge", updatedAt.ISHN);
  renderAgeChip("tempAge", updatedAt.TEMP);

  drawBarChart($("voltageChart"), cellValues, {
    count: 16,
    min: 2.8,
    max: 3.8,
    unit: "V",
    transform: (mv) => (Number.isInteger(mv) ? mv / 1000 : null),
    decimals: 3,
    xLabel: "Cell Number",
    yLabel: "Voltage",
    flashAt: state.voltageFlashAt,
  });

  drawBarChart($("currentChart"), telemetry.ISHN || [], {
    count: 8,
    min: -400,
    max: 400,
    unit: "A",
    transform: (amps) => (typeof amps === "number" ? amps : null),
    decimals: 2,
    xLabel: "Shunt Number",
    yLabel: "Current",
  });

  const temps = normalizeTemperatureSeries(telemetry.TEMP || []);
  markHeatmapFreshness(updatedAt.TEMP, temps);
  drawHeatmap($("tempHeatmap"), temps, state.heatmapHover);
  renderCellExtremes(cells);
}

function renderCellExtremes(cells) {
  const valid = cells.filter((cell) => Number.isInteger(cell.millivolts) && cell.millivolts > 0);
  if (!valid.length) {
    $("cellExtremes").textContent = "No valid cell voltages";
    return;
  }
  const min = valid.reduce((a, b) => (a.millivolts <= b.millivolts ? a : b));
  const max = valid.reduce((a, b) => (a.millivolts >= b.millivolts ? a : b));
  $("cellExtremes").textContent = `Min C${min.index} ${min.millivolts} mV | Max C${max.index} ${max.millivolts} mV`;
}

function markVoltageFreshness(updatedAt, values) {
  if (!updatedAt || updatedAt === state.lastVcelUpdatedAt) return;
  state.lastVcelUpdatedAt = updatedAt;
  const now = performance.now();
  for (let index = 0; index < values.length; index += 1) {
    if (Number.isInteger(values[index]) && values[index] > 0) {
      state.voltageFlashAt.set(index, now);
    }
  }
  schedulePulseRedraw();
}

function markHeatmapFreshness(updatedAt, temps) {
  if (!updatedAt || updatedAt === state.lastTempUpdatedAt) return;
  state.lastTempUpdatedAt = updatedAt;
  const now = performance.now();
  const model = heatmapModel($("tempHeatmap"), temps);
  for (let stack = 0; stack < model.cols; stack += 1) {
    for (let sensor = 0; sensor < model.rows; sensor += 1) {
      const sourceIndex = heatmapTempIndex(stack, sensor, model.sourceStride);
      if (typeof temps[sourceIndex] === "number") {
        state.tempFlashAt.set(sourceIndex, now);
      }
    }
  }
  schedulePulseRedraw();
}

function schedulePulseRedraw() {
  if (state.pulseFrame) return;
  const tick = () => {
    state.pulseFrame = null;
    if (!state.latest) return;
    const telemetry = state.latest.telemetry || {};
    drawHeatmap($("tempHeatmap"), normalizeTemperatureSeries(telemetry.TEMP || []), state.heatmapHover);
    drawBarChart($("voltageChart"), (state.latest.derived?.cells || []).map((cell) => cell.millivolts), {
      count: 16,
      min: 2.8,
      max: 3.8,
      unit: "V",
      transform: (mv) => (Number.isInteger(mv) ? mv / 1000 : null),
      decimals: 3,
      xLabel: "Cell Number",
      yLabel: "Voltage",
      flashAt: state.voltageFlashAt,
    });
    if (hasActivePulse()) {
      state.pulseFrame = requestAnimationFrame(tick);
    }
  };
  state.pulseFrame = requestAnimationFrame(tick);
}

function hasActivePulse() {
  const now = performance.now();
  for (const at of state.tempFlashAt.values()) {
    if (now - at < 700) return true;
  }
  for (const at of state.voltageFlashAt.values()) {
    if (now - at < 700) return true;
  }
  return false;
}

function drawBarChart(canvas, values, options) {
  resizeCanvasToDisplaySize(canvas);
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 52, right: 20, top: 26, bottom: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const min = options.min;
  const max = options.max;
  const showEvery = options.count > 12 && plotW < 760 ? 2 : 1;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = css("--panel");
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = css("--chart-grid");
  ctx.fillStyle = css("--muted");
  ctx.lineWidth = 1;
  ctx.font = "13px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i += 1) {
    const value = min + ((max - min) * i) / 4;
    const y = pad.top + plotH - ((value - min) / (max - min)) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(Math.abs(max - min) > 20 ? 0 : 1), pad.left - 8, y);
  }

  const zeroY = pad.top + plotH - ((0 - min) / (max - min)) * plotH;
  ctx.strokeStyle = css("--muted");
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(pad.left, zeroY);
  ctx.lineTo(width - pad.right, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  const barGap = Math.max(4, plotW / options.count * 0.38);
  const barW = Math.max(10, plotW / options.count - barGap);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let i = 0; i < options.count; i += 1) {
    const value = options.transform(values[i]);
    const x = pad.left + i * (plotW / options.count) + (plotW / options.count - barW) / 2;
    const labelY = pad.top + plotH + 12;
    if (i % showEvery === 0) {
      ctx.fillStyle = css("--muted");
      ctx.fillText(String(i + 1), x + barW / 2, labelY);
    }

    if (value === null || Number.isNaN(value)) continue;
    const clamped = Math.max(min, Math.min(max, value));
    const y = pad.top + plotH - ((clamped - min) / (max - min)) * plotH;
    const baseY = min < 0 && max > 0 ? zeroY : pad.top + plotH;
    if (value === 0) {
      ctx.fillStyle = css("--bad");
      ctx.fillRect(x, baseY - 2, barW, 3);
      continue;
    }
    ctx.fillStyle = css("--chart-fill");
    ctx.fillRect(x, Math.min(y, baseY), barW, Math.max(2, Math.abs(baseY - y)));
    const pulse = pulseStrength(options.flashAt?.get(i));
    if (pulse > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.42 * pulse})`;
      ctx.fillRect(x - 2, Math.min(y, baseY) - 2, barW + 4, Math.max(5, Math.abs(baseY - y) + 4));
    }
    ctx.fillStyle = css("--chart-blue");
    ctx.font = "12px Segoe UI, Arial, sans-serif";
    ctx.fillText(value.toFixed(options.decimals), x + barW / 2, Math.min(y, baseY) - 18);
  }

  ctx.save();
  ctx.translate(13, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = css("--muted");
  ctx.textAlign = "center";
  ctx.fillText(`${options.yLabel} (${options.unit})`, 0, 0);
  ctx.restore();

  ctx.fillStyle = css("--muted");
  ctx.textAlign = "center";
  ctx.fillText(options.xLabel, pad.left + plotW / 2, height - 18);
}

function heatmapModel(canvas, temps) {
  const cols = 16;
  const rows = 16;
  const pad = { left: 48, right: 12, top: 20, bottom: 34 };
  const sourceStride = temps.length >= cols * 24 ? 24 : rows;
  const plotW = canvas.width - pad.left - pad.right;
  const plotH = canvas.height - pad.top - pad.bottom;
  return {
    cols,
    rows,
    pad,
    sourceStride,
    plotW,
    plotH,
    cellW: plotW / cols,
    cellH: plotH / rows,
  };
}

function drawHeatmap(canvas, temps, hover = null) {
  resizeCanvasToDisplaySize(canvas);
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const { cols, rows, pad, sourceStride, plotW, plotH, cellW, cellH } = heatmapModel(canvas, temps);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = css("--panel");
  ctx.fillRect(0, 0, width, height);

  for (let stack = 0; stack < cols; stack += 1) {
    for (let sensor = 0; sensor < rows; sensor += 1) {
      const sourceIndex = heatmapTempIndex(stack, rows - sensor - 1, sourceStride);
      const value = typeof temps[sourceIndex] === "number" ? temps[sourceIndex] : null;
      const reading = tempReadingState(value);
      ctx.fillStyle = reading.color;
      ctx.fillRect(pad.left + stack * cellW, pad.top + sensor * cellH, cellW + 0.5, cellH + 0.5);
      const pulse = pulseStrength(state.tempFlashAt.get(sourceIndex));
      if (pulse > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.32 * pulse})`;
        ctx.fillRect(pad.left + stack * cellW, pad.top + sensor * cellH, cellW + 0.5, cellH + 0.5);
      }
      ctx.strokeStyle = state.dark ? "rgba(255,255,255,0.045)" : "rgba(19,32,45,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(pad.left + stack * cellW, pad.top + sensor * cellH, cellW, cellH);

      if (cellW > 44 && cellH > 21) {
        ctx.fillStyle = reading.textColor;
        ctx.font = "700 11px Segoe UI, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(reading.label, pad.left + stack * cellW + cellW / 2, pad.top + sensor * cellH + cellH / 2);
      }
    }
  }

  ctx.strokeStyle = css("--chart-grid");
  ctx.fillStyle = css("--muted");
  ctx.font = "12px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let row = 0; row < rows; row += 1) {
    const sensor = rows - row;
    const y = pad.top + row * cellH + cellH / 2;
    ctx.fillText(String(sensor), pad.left - 8, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let col = 0; col < cols; col += 1) {
    ctx.fillText(String(col + 1), pad.left + col * cellW + cellW / 2, pad.top + plotH + 10);
  }

  ctx.save();
  ctx.translate(13, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("Sensor", 0, 0);
  ctx.restore();
  ctx.fillText("Cell Stack", pad.left + plotW / 2, height - 16);

  if (hover) {
    drawHeatmapHover(ctx, hover, { pad, cellW, cellH, plotW, rows }, temps);
  }
}

function resizeCanvasToDisplaySize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function heatmapTempIndex(stack, sensor, sourceStride) {
  return stack * sourceStride + sensor;
}

function heatmapPointFromEvent(canvas, event, temps) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  const model = heatmapModel(canvas, temps);

  if (
    x < model.pad.left ||
    x >= model.pad.left + model.plotW ||
    y < model.pad.top ||
    y >= model.pad.top + model.plotH
  ) {
    return null;
  }

  const stack = Math.floor((x - model.pad.left) / model.cellW);
  const row = Math.floor((y - model.pad.top) / model.cellH);
  const sensor = model.rows - row - 1;
  const sourceIndex = heatmapTempIndex(stack, sensor, model.sourceStride);
  const value = typeof temps[sourceIndex] === "number" ? temps[sourceIndex] : null;

  return {
    stack,
    sensor,
    row,
    sourceIndex,
    value,
    x: model.pad.left + stack * model.cellW,
    y: model.pad.top + row * model.cellH,
    cellW: model.cellW,
    cellH: model.cellH,
    sourceStride: model.sourceStride,
  };
}

function drawHeatmapHover(ctx, hover, model, temps) {
  const x = hover.x;
  const y = hover.y;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.shadowColor = css("--accent");
  ctx.shadowBlur = 16;
  ctx.strokeRect(x + 1.5, y + 1.5, hover.cellW - 3, hover.cellH - 3);
  ctx.restore();

  const insetW = 192;
  const insetH = 118;
  const insetX = x + hover.cellW + insetW + 18 > model.pad.left + model.plotW
    ? x - insetW - 18
    : x + hover.cellW + 18;
  const insetY = Math.max(model.pad.top + 10, Math.min(y - 38, model.pad.top + model.rows * model.cellH - insetH - 10));

  ctx.save();
  ctx.fillStyle = state.dark ? "rgba(15, 20, 27, 0.96)" : "rgba(255, 255, 255, 0.96)";
  ctx.strokeStyle = css("--accent");
  ctx.lineWidth = 1.5;
  roundRect(ctx, insetX, insetY, insetW, insetH, 10);
  ctx.fill();
  ctx.stroke();

  const reading = tempReadingState(hover.value);
  ctx.fillStyle = reading.color;
  roundRect(ctx, insetX + 14, insetY + 16, 62, 62, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.stroke();

  ctx.fillStyle = reading.textColor;
  ctx.font = "700 14px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(reading.label, insetX + 45, insetY + 47);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = css("--text");
  ctx.font = "700 14px Segoe UI, Arial, sans-serif";
  ctx.fillText(`Stack ${hover.stack + 1}`, insetX + 90, insetY + 32);
  ctx.fillStyle = css("--muted");
  ctx.font = "12px Segoe UI, Arial, sans-serif";
  ctx.fillText(`Sensor ${hover.sensor + 1}`, insetX + 90, insetY + 54);
  ctx.fillText(`Index ${hover.sourceIndex}`, insetX + 90, insetY + 74);
  ctx.fillText(`${hover.sourceStride}-wide source`, insetX + 14, insetY + 102);
  ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function pulseStrength(startedAt) {
  if (!startedAt) return 0;
  const age = performance.now() - startedAt;
  if (age >= 700) return 0;
  return 1 - age / 700;
}

function tempReadingState(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return { label: "--", color: state.dark ? "#111820" : "#e7edf3", textColor: css("--muted") };
  }
  if (value === 0) {
    return { label: "0", color: state.dark ? "#1a2430" : "#dfe8ef", textColor: css("--muted") };
  }
  const color = tempScaleColor(value);
  return { label: value.toFixed(1), color, textColor: luminance(color) > 0.48 ? "#061015" : "#edf7ff" };
}

function tempColor(value) {
  const reading = tempReadingState(value);
  return typeof reading === "string" ? reading : reading.color;
}

function tempScaleColor(value) {
  const clamped = Math.max(tempScale[0].value, Math.min(tempScale[tempScale.length - 1].value, value));
  for (let i = 0; i < tempScale.length - 1; i += 1) {
    const low = tempScale[i];
    const high = tempScale[i + 1];
    if (clamped >= low.value && clamped <= high.value) {
      const t = (clamped - low.value) / (high.value - low.value);
      return rgbToCss([
        lerp(low.color[0], high.color[0], t),
        lerp(low.color[1], high.color[1], t),
        lerp(low.color[2], high.color[2], t),
      ]);
    }
  }
  return rgbToCss(tempScale[tempScale.length - 1].color);
}

function lerp(start, end, t) {
  return Math.round(start + (end - start) * t);
}

function rgbToCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function luminance(color) {
  const values = color.match(/\d+/g)?.slice(0, 3).map(Number) || [0, 0, 0];
  return (0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]) / 255;
}

function setupHeatmapInteraction() {
  const canvas = $("tempHeatmap");
  const tooltip = $("heatTooltip");

  canvas.addEventListener("mousemove", (event) => {
    const temps = normalizeTemperatureSeries(state.latest?.telemetry?.TEMP || []);
    const hover = heatmapPointFromEvent(canvas, event, temps);
    state.heatmapHover = hover;
    drawHeatmap(canvas, temps, hover);

    if (!hover) {
      tooltip.hidden = true;
      return;
    }
    tooltip.hidden = true;
  });

  canvas.addEventListener("mouseleave", () => {
    state.heatmapHover = null;
    tooltip.hidden = true;
    drawHeatmap(canvas, normalizeTemperatureSeries(state.latest?.telemetry?.TEMP || []));
  });
}

function tempStatus(value) {
  if (value === null) return "Missing";
  if (value === 0) return "Zero";
  if (value <= -49) return "Floor";
  if (value < 0) return "Cold";
  if (value < 35) return "Nominal";
  if (value < 45) return "Warm";
  return "Hot";
}

function renderBNode(bnode) {
  const capture = bnode.capture || {};
  const debug = bnode.debug || {};
  const order = bnode.order || [];

  $("captureStatus").textContent =
    capture.active === undefined ? capture.event || "--" : capture.active ? "Capturing" : "Stopped";
  $("captureStatus").className = `pill ${capture.active ? "good" : ""}`;
  $("capturedCount").textContent = capture.captured_count ?? "--";
  $("liveCount").textContent = capture.live_count ?? (debug.live ? debug.live.length : "--");
  $("tempFrames").textContent = debug.temp ?? "--";
  $("voltFrames").textContent = debug.volt ?? "--";
  $("liveNodes").textContent = Array.isArray(debug.live) && debug.live.length ? debug.live.join(", ") : "--";

  const container = $("bOrder");
  container.innerHTML = "";
  for (let index = 0; index < 16; index += 1) {
    const value = order[index];
    const div = document.createElement("div");
    div.className = "order-slot";
    div.innerHTML = `<span>Slot ${index + 1}</span><strong>${value === null || value === undefined ? "-" : value}</strong>`;
    container.appendChild(div);
  }
}

function renderLog(log) {
  const logToRender = state.viewLog || log;
  const container = $("rawLog");
  container.innerHTML = "";
  for (const row of logToRender.slice(-170)) {
    const div = document.createElement("div");
    const direction = row.direction || "rx";
    const level = row.level === "error" ? "error" : direction;
    div.className = "log-row";
    div.innerHTML = `<span>${formatTime(row.at)}</span><span class="${level}">${direction.toUpperCase()}</span><span>${escapeHtml(row.line)}</span>`;
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function selectedPort() {
  return $("manualPort").value.trim() || $("portSelect").value;
}

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
  ws.onmessage = (event) => {
    state.viewLog = null;
    render(JSON.parse(event.data));
  };
  ws.onclose = () => setTimeout(connectWebSocket, 1000);
}

function applyTheme() {
  document.body.classList.toggle("light", !state.dark);
  $("themeToggle").checked = state.dark;
  localStorage.setItem("le-bms-theme", state.dark ? "dark" : "light");
  if (state.latest) render(state.latest);
}

function refreshAgeChips() {
  const updatedAt = state.latest?.updated_at || {};
  renderAgeChip("voltageAge", updatedAt.VCEL);
  renderAgeChip("currentAge", updatedAt.ISHN);
  renderAgeChip("tempAge", updatedAt.TEMP);
}

async function boot() {
  applyTheme();
  await refreshPorts();
  render(await api("/api/state"));
  connectWebSocket();
  setInterval(refreshAgeChips, 1000);

  setupPageNavigation();
  $("themeToggle").addEventListener("change", () => {
    state.dark = $("themeToggle").checked;
    applyTheme();
  });
  setupHeatmapInteraction();
  $("refreshPorts").addEventListener("click", refreshPorts);
  $("connect").addEventListener("click", async () => {
    const port = selectedPort();
    if (!port) return;
    render(await api("/api/connect", { method: "POST", body: JSON.stringify({ port }) }));
  });
  $("disconnect").addEventListener("click", async () => {
    render(await api("/api/disconnect", { method: "POST" }));
  });
  $("clearLog").addEventListener("click", () => {
    state.viewLog = [];
    renderLog([]);
  });
  $("commandForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("commandError").textContent = "";
    try {
      await api("/api/command", {
        method: "POST",
        body: JSON.stringify({ command: $("commandInput").value }),
      });
      $("commandInput").value = "";
    } catch (error) {
      $("commandError").textContent = error.message;
    }
  });
  for (const button of document.querySelectorAll("[data-action]")) {
    button.addEventListener("click", async () => {
      $("commandError").textContent = "";
      try {
        await api("/api/b-node", {
          method: "POST",
          body: JSON.stringify({ action: button.dataset.action }),
        });
      } catch (error) {
        $("commandError").textContent = error.message;
      }
    });
  }
}

boot().catch((error) => {
  $("commandError").textContent = error.message;
});
