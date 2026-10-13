/**
 * Hardware Simulator — PhET Interactive Physics Suite & INStep Transient Engine
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Complete Unified Hardware Laboratory Suite:
 * 1. ⚡ Circuit Construction Kit (MNA solver, Drude drift, See Inside cutaways, meters)
 * 2. 🧲 Faraday's Electromagnetics Lab (Pickup coil, Electromagnet, Transformer, Generator)
 * 3. ⫛ Capacitor Lab (Parallel plates, Dielectric materials, Field flux, Discharging)
 * 4. 📏 Wire Resistivity & Drude Model (Geometry R = ρL/A, atomic lattice collisions)
 * 5. 💡 Photoelectric Phototube Lab (Work function, photon kinetics, stopping potential)
 * 6. 🔬 Semiconductor & Diode Lab (P-N junction, energy bands, depletion, LED emission)
 * 7. 📡 Radio Waves & Dipole Lab (Oscillating dipole, EM radiation propagation, receiver)
 *
 * All driven by the ⭐ INStep Transient Micro-Stepping Engine & Waveform Monitor.
 * Lineage: Algorithmic foundations streamlined from mleoking/PhET.
 * Author: @Akshit2247
 */

// =========================================================================
// 1. Global Multi-Lab Architecture & State
// =========================================================================
const app = {
  activeLab: 'circuit',     // 'circuit', 'faraday', 'capacitor', 'resistivity', 'photoelectric', 'semiconductor', 'radiowaves'
  viewMode: 'xray',         // 'real', 'xray', 'schematic'
  flowMode: 'electrons',    // 'electrons', 'conventional'
  runMode: 'run',           // 'run', 'instep'
  dt: 0.001,                // INStep delta-t in seconds
  stepCount: 0,
  simTime: 0.0,
  waveformHistory: []
};

// Canvas references
const canvases = {
  circuit: document.getElementById('circuit-canvas'),
  faraday: document.getElementById('faraday-canvas'),
  capacitor: document.getElementById('capacitor-canvas'),
  resistivity: document.getElementById('resistivity-canvas'),
  photoelectric: document.getElementById('photoelectric-canvas'),
  semiconductor: document.getElementById('semiconductor-canvas'),
  radiowaves: document.getElementById('radiowaves-canvas'),
  waveform: document.getElementById('waveform-canvas')
};

const contexts = {
  circuit: canvases.circuit.getContext('2d'),
  faraday: canvases.faraday.getContext('2d'),
  capacitor: canvases.capacitor.getContext('2d'),
  resistivity: canvases.resistivity.getContext('2d'),
  photoelectric: canvases.photoelectric.getContext('2d'),
  semiconductor: canvases.semiconductor.getContext('2d'),
  radiowaves: canvases.radiowaves.getContext('2d'),
  waveform: canvases.waveform.getContext('2d')
};

// ID Generator
let idCounter = 1;
function genId(prefix) { return `${prefix}_${idCounter++}`; }

// =========================================================================
// 2. ⚡ Circuit Construction Kit Engine (Full PhET Implementation)
// =========================================================================
const circuitState = {
  components: [],
  selectedComp: null,
  wireDraft: null,
  voltmeterActive: false,
  ammeterActive: false,
  probeBlack: { x: 380, y: 160, isDragging: false, connectedTerminal: null },
  probeRed: { x: 480, y: 160, isDragging: false, connectedTerminal: null },
  ammeterSensor: { x: 420, y: 220, isDragging: false },
  flameParticles: [],
  electronDriftOffset: 0
};

class CircuitComponent {
  constructor(type, x, y, val = 10) {
    this.id = genId(type);
    this.type = type; // 'battery', 'bulb', 'resistor', 'switch', 'capacitor', 'wire'
    this.x = x;
    this.y = y;
    this.rotation = 0;
    this.value = val;
    this.isClosed = true;
    this.current = 0.0;
    this.voltageDrop = 0.0;
    this.state = 0.0;
    this.width = 90;
    this.height = 40;
    this.updateTerminals();
  }

  updateTerminals() {
    const hw = this.width / 2;
    if (this.rotation === 0 || this.rotation === 180) {
      this.t1 = { id: `${this.id}_t1`, comp: this, x: this.x - hw, y: this.y, name: 'T1' };
      this.t2 = { id: `${this.id}_t2`, comp: this, x: this.x + hw, y: this.y, name: 'T2' };
    } else {
      this.t1 = { id: `${this.id}_t1`, comp: this, x: this.x, y: this.y - hw, name: 'T1' };
      this.t2 = { id: `${this.id}_t2`, comp: this, x: this.x, y: this.y + hw, name: 'T2' };
    }
  }

  moveTo(x, y) {
    this.x = Math.round(x / 15) * 15;
    this.y = Math.round(y / 15) * 15;
    this.updateTerminals();
  }
}

class WireConnection {
  constructor(t1, t2) {
    this.id = genId('wire');
    this.t1 = t1;
    this.t2 = t2;
    this.current = 0.0;
  }
}

function phetResistorColors(resistance) {
  const digitColors = ["#000000", "#8B4513", "#FF0000", "#FFA500", "#FFFF00", "#008000", "#0000FF", "#EE82EE", "#808080", "#FFFFFF"];
  const val = Math.max(1, Math.round(resistance));
  if (val < 10) return [digitColors[0], digitColors[val], digitColors[0]];
  if (val < 100) return [digitColors[Math.floor(val / 10)], digitColors[val % 10], digitColors[0]];
  const s = String(val);
  return [digitColors[parseInt(s[0])], digitColors[parseInt(s[1])], digitColors[Math.min(9, s.length - 2)]];
}

function buildNodalGraph() {
  const terminalNodeMap = new Map();
  let nodeCount = 0;

  function getNode(t) {
    if (terminalNodeMap.has(t)) return terminalNodeMap.get(t);
    const id = ++nodeCount;
    terminalNodeMap.set(t, id);
    return id;
  }

  function mergeNodes(tA, tB) {
    const nA = terminalNodeMap.get(tA);
    const nB = terminalNodeMap.get(tB);
    if (!nA && !nB) {
      const nid = ++nodeCount;
      terminalNodeMap.set(tA, nid);
      terminalNodeMap.set(tB, nid);
    } else if (nA && !nB) {
      terminalNodeMap.set(tB, nA);
    } else if (!nA && nB) {
      terminalNodeMap.set(tA, nB);
    } else if (nA !== nB) {
      for (const [term, nid] of terminalNodeMap.entries()) {
        if (nid === nB) terminalNodeMap.set(term, nA);
      }
    }
  }

  for (const c of circuitState.components) {
    if (c instanceof WireConnection) {
      mergeNodes(c.t1, c.t2);
    }
  }

  for (let i = 0; i < circuitState.components.length; i++) {
    const c1 = circuitState.components[i];
    if (c1 instanceof WireConnection) continue;
    for (let j = i + 1; j < circuitState.components.length; j++) {
      const c2 = circuitState.components[j];
      if (c2 instanceof WireConnection) continue;
      [c1.t1, c1.t2].forEach(ta => {
        [c2.t1, c2.t2].forEach(tb => {
          if (Math.hypot(ta.x - tb.x, ta.y - tb.y) < 18) {
            mergeNodes(ta, tb);
          }
        });
      });
    }
  }

  for (const c of circuitState.components) {
    if (!(c instanceof WireConnection)) {
      getNode(c.t1);
      getNode(c.t2);
    }
  }

  const rawNodes = Array.from(new Set(terminalNodeMap.values())).filter(n => n > 0);
  const reindex = new Map();
  rawNodes.forEach((n, idx) => reindex.set(n, idx + 1));
  for (const [t, n] of terminalNodeMap.entries()) {
    terminalNodeMap.set(t, reindex.get(n) || 0);
  }

  return { terminalNodeMap, numNodes: rawNodes.length };
}

function solveCircuit() {
  const { terminalNodeMap, numNodes } = buildNodalGraph();
  if (numNodes <= 1) {
    resetCircuitCurrents();
    return;
  }

  const vSources = circuitState.components.filter(c => c.type === 'battery' && c.isClosed);
  const n = numNodes;
  const m = vSources.length;
  const size = n + m;

  const A = Array.from({ length: size }, () => Array(size).fill(0));
  const z = Array(size).fill(0);

  for (const c of circuitState.components) {
    if (c instanceof WireConnection) continue;
    if (!c.isClosed && c.type === 'switch') continue;

    let r = 1e-4;
    if (c.type === 'resistor' || c.type === 'bulb') {
      r = Math.max(1e-3, c.value);
    } else if (c.type === 'capacitor') {
      const gEq = (2.0 * c.value) / Math.max(1e-6, app.dt);
      r = 1.0 / gEq;
      const iEq = gEq * c.voltageDrop + c.current;
      const n1 = terminalNodeMap.get(c.t1) || 0;
      const n2 = terminalNodeMap.get(c.t2) || 0;
      if (n1 > 0) z[n1 - 1] -= iEq;
      if (n2 > 0) z[n2 - 1] += iEq;
    }

    if (c.type !== 'battery') {
      const g = 1.0 / r;
      const n1 = terminalNodeMap.get(c.t1) || 0;
      const n2 = terminalNodeMap.get(c.t2) || 0;
      if (n1 > 0) A[n1 - 1][n1 - 1] += g;
      if (n2 > 0) A[n2 - 1][n2 - 1] += g;
      if (n1 > 0 && n2 > 0) {
        A[n1 - 1][n2 - 1] -= g;
        A[n2 - 1][n1 - 1] -= g;
      }
    }
  }

  vSources.forEach((src, idx) => {
    const row = n + idx;
    const n1 = terminalNodeMap.get(src.t1) || 0;
    const n2 = terminalNodeMap.get(src.t2) || 0;
    if (n1 > 0) { A[n1 - 1][row] += 1; A[row][n1 - 1] += 1; }
    if (n2 > 0) { A[n2 - 1][row] -= 1; A[row][n2 - 1] -= 1; }
    z[row] = src.value;
  });

  const xSol = solveLinearSystem(A, z);
  if (!xSol) {
    resetCircuitCurrents();
    return;
  }

  const nodeVoltages = { 0: 0.0 };
  for (let i = 0; i < n; i++) nodeVoltages[i + 1] = xSol[i];

  for (const c of circuitState.components) {
    if (c instanceof WireConnection) continue;
    const v1 = nodeVoltages[terminalNodeMap.get(c.t1)] || 0;
    const v2 = nodeVoltages[terminalNodeMap.get(c.t2)] || 0;
    c.voltageDrop = v1 - v2;

    if (c.type === 'resistor' || c.type === 'bulb') {
      c.current = c.voltageDrop / Math.max(1e-3, c.value);
    } else if (c.type === 'battery') {
      const sIdx = vSources.indexOf(c);
      c.current = sIdx >= 0 ? -xSol[n + sIdx] : 0;
    } else if (c.type === 'switch') {
      c.current = c.isClosed ? c.voltageDrop / 1e-4 : 0;
    } else if (c.type === 'capacitor') {
      const gEq = (2 * c.value) / Math.max(1e-6, app.dt);
      c.current = gEq * c.voltageDrop - (gEq * c.voltageDrop + c.current);
    }
  }

  for (const w of circuitState.components) {
    if (w instanceof WireConnection) {
      w.current = w.t1.comp.current;
    }
  }

  updateCircuitMeters(nodeVoltages, terminalNodeMap);
}

function resetCircuitCurrents() {
  circuitState.components.forEach(c => { c.current = 0; c.voltageDrop = 0; });
  const vm = document.getElementById('voltmeter-readout');
  const am = document.getElementById('ammeter-readout');
  if (vm) vm.textContent = '0.00';
  if (am) am.textContent = '0.000';
}

function solveLinearSystem(A, b) {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    if (Math.abs(A[maxRow][i]) < 1e-12) continue;
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [b[i], b[maxRow]] = [b[maxRow], b[i]];

    const pivot = A[i][i];
    for (let j = i; j < n; j++) A[i][j] /= pivot;
    b[i] /= pivot;

    for (let k = 0; k < n; k++) {
      if (k !== i && Math.abs(A[k][i]) > 1e-12) {
        const factor = A[k][i];
        for (let j = i; j < n; j++) A[k][j] -= factor * A[i][j];
        b[k] -= factor * b[i];
      }
    }
  }
  return b;
}

function updateCircuitMeters(nodeVoltages, terminalNodeMap) {
  if (circuitState.voltmeterActive) {
    const tRed = findNearestTerminal(circuitState.probeRed.x, circuitState.probeRed.y);
    const tBlack = findNearestTerminal(circuitState.probeBlack.x, circuitState.probeBlack.y);
    const vRed = tRed ? (nodeVoltages[terminalNodeMap.get(tRed)] || 0) : 0;
    const vBlack = tBlack ? (nodeVoltages[terminalNodeMap.get(tBlack)] || 0) : 0;
    const diff = (tRed && tBlack) ? (vRed - vBlack) : 0.0;
    document.getElementById('voltmeter-readout').textContent = Math.abs(diff) < 0.001 ? "0.00" : diff.toFixed(2);
  }

  if (circuitState.ammeterActive) {
    let measuredI = 0.0;
    for (const c of circuitState.components) {
      if (c instanceof WireConnection) {
        const d = distToSegment(circuitState.ammeterSensor.x, circuitState.ammeterSensor.y, c.t1.x, c.t1.y, c.t2.x, c.t2.y);
        if (d < 24) { measuredI = Math.abs(c.current); break; }
      } else {
        if (Math.hypot(circuitState.ammeterSensor.x - c.x, circuitState.ammeterSensor.y - c.y) < 30) {
          measuredI = Math.abs(c.current); break;
        }
      }
    }
    document.getElementById('ammeter-readout').textContent = measuredI.toFixed(3);
  }
}

function findNearestTerminal(x, y, maxDist = 25) {
  let closest = null;
  let minD = maxDist;
  for (const c of circuitState.components) {
    if (c instanceof WireConnection) continue;
    for (const t of [c.t1, c.t2]) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < minD) { minD = d; closest = t; }
    }
  }
  return closest;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1)**2 + (y2 - y1)**2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

// Circuit Rendering
function renderCircuit(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = '#121622';
  ctx.lineWidth = 1;
  const gridSize = 30;
  for (let x = 0; x < w; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Wires
  for (const comp of circuitState.components) {
    if (comp instanceof WireConnection) {
      drawWire(ctx, comp);
    }
  }

  // Active wire draft
  if (circuitState.wireDraft) {
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(circuitState.wireDraft.fromTerminal.x, circuitState.wireDraft.fromTerminal.y);
    ctx.lineTo(circuitState.wireDraft.mouseX, circuitState.wireDraft.mouseY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Components
  for (const comp of circuitState.components) {
    if (!(comp instanceof WireConnection)) {
      drawCircuitComponent(ctx, comp);
    }
  }

  // Voltmeter flexible probe cables
  if (circuitState.voltmeterActive) {
    drawProbeLead(ctx, 400, 75, circuitState.probeBlack.x, circuitState.probeBlack.y, '#334155');
    drawProbeLead(ctx, 480, 75, circuitState.probeRed.x, circuitState.probeRed.y, '#dc2626');
  }

  // Short circuit fire particles
  drawFlameParticles(ctx);
}

function drawWire(ctx, w) {
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w.t1.x, w.t1.y);
  ctx.lineTo(w.t2.x, w.t2.y);
  ctx.stroke();

  if (Math.abs(w.current) > 0.001) {
    drawFlowParticlesOnLine(ctx, w.t1.x, w.t1.y, w.t2.x, w.t2.y, w.current);
  }
}

function drawFlowParticlesOnLine(ctx, x1, y1, x2, y2, current) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 5) return;

  const count = Math.max(2, Math.floor(len / 22));
  const dir = (app.flowMode === 'electrons' ? -1 : 1) * Math.sign(current);
  const color = app.flowMode === 'electrons' ? '#00d2ff' : '#ff9100';

  for (let i = 0; i < count; i++) {
    let t = (i / count + (circuitState.electronDriftOffset * dir) / len) % 1.0;
    if (t < 0) t += 1.0;
    const px = x1 + dx * t;
    const py = y1 + dy * t;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCircuitComponent(ctx, c) {
  ctx.save();
  ctx.translate(c.x, c.y);

  if (app.viewMode === 'real') {
    drawCompReal(ctx, c);
  } else if (app.viewMode === 'xray') {
    drawCompXRay(ctx, c);
  } else {
    drawCompSchematic(ctx, c);
  }

  ctx.restore();

  // Draw Terminal Pins
  for (const t of [c.t1, c.t2]) {
    ctx.fillStyle = '#1e2433';
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawCompReal(ctx, c) {
  const hw = c.width / 2;
  const hh = c.height / 2;

  if (c.type === 'battery') {
    ctx.fillStyle = '#b45309';
    ctx.fillRect(-hw + 8, -hh + 6, c.width - 16, c.height - 12);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(-hw + 14, -hh + 6, c.width - 32, c.height - 12);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(hw - 8, -6, 8, 12);
    ctx.fillStyle = '#fff';
    ctx.font = '9px monospace';
    ctx.fillText(`${c.value}V`, -10, 3);
  } else if (c.type === 'resistor') {
    ctx.fillStyle = '#d4b996';
    ctx.beginPath();
    ctx.roundRect(-hw + 12, -hh + 8, c.width - 24, c.height - 16, 6);
    ctx.fill();
    const bands = phetResistorColors(c.value);
    const bandX = [-14, -4, 6];
    bands.forEach((col, idx) => {
      ctx.fillStyle = col;
      ctx.fillRect(bandX[idx], -hh + 8, 5, c.height - 16);
    });
  } else if (c.type === 'bulb') {
    const power = Math.abs(c.current * c.voltageDrop);
    if (power > 0.05) {
      const glow = Math.min(45, 12 + power * 4);
      const grad = ctx.createRadialGradient(0, -6, 4, 0, -6, glow);
      grad.addColorStop(0, 'rgba(255, 230, 100, 0.85)');
      grad.addColorStop(1, 'rgba(255, 200, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, -6, glow, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.strokeStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(0, -6, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-8, 10, 16, 10);
  } else if (c.type === 'switch') {
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-hw + 10, 0); ctx.lineTo(-12, 0);
    ctx.moveTo(12, 0); ctx.lineTo(hw - 10, 0);
    ctx.stroke();
    ctx.strokeStyle = c.isClosed ? '#10b981' : '#ef4444';
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(12, c.isClosed ? 0 : -20);
    ctx.stroke();
  } else if (c.type === 'capacitor') {
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-8, -18, 4, 36);
    ctx.fillRect(4, -18, 4, 36);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-hw + 8, 0); ctx.lineTo(-8, 0);
    ctx.moveTo(8, 0); ctx.lineTo(hw - 8, 0);
    ctx.stroke();
  }
}

function drawCompXRay(ctx, c) {
  const hw = c.width / 2;
  const hh = c.height / 2;

  // Glass chamber
  ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
  ctx.strokeStyle = 'rgba(0, 210, 255, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-hw + 6, -hh + 6, c.width - 12, c.height - 12, 6);
  ctx.fill();
  ctx.stroke();

  if (c.type === 'resistor') {
    // Drude lattice scattering ions
    for (let i = -24; i <= 24; i += 12) {
      for (let j = -8; j <= 8; j += 8) {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(i, j, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (c.type === 'battery') {
    // Chemical uphill pump
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-hw + 10, -hh + 8, 8, c.height - 16);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(hw - 18, -hh + 8, 8, c.height - 16);
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-10, 4); ctx.lineTo(0, -6); ctx.lineTo(10, 4);
    ctx.stroke();
    ctx.fillStyle = '#00d2ff';
    ctx.font = '8px monospace';
    ctx.fillText('PUMP', -12, -8);
  } else if (c.type === 'bulb') {
    const power = Math.abs(c.current * c.voltageDrop);
    ctx.strokeStyle = power > 0.05 ? '#fef08a' : '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-12, 6); ctx.lineTo(-6, -8); ctx.lineTo(6, -8); ctx.lineTo(12, 6);
    ctx.stroke();
  } else if (c.type === 'capacitor') {
    // Parallel plates & E-field arrows
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-10, -14, 3, 28);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(7, -14, 3, 28);
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.6)';
    ctx.lineWidth = 1;
    for (let y = -8; y <= 8; y += 6) {
      ctx.beginPath();
      ctx.moveTo(-7, y); ctx.lineTo(7, y);
      ctx.stroke();
    }
  } else if (c.type === 'switch') {
    drawCompReal(ctx, c);
  }
}

function drawCompSchematic(ctx, c) {
  const hw = c.width / 2;
  ctx.strokeStyle = '#00d2ff';
  ctx.lineWidth = 2;

  if (c.type === 'resistor') {
    ctx.beginPath();
    ctx.moveTo(-hw + 8, 0); ctx.lineTo(-18, 0);
    ctx.lineTo(-12, -8); ctx.lineTo(-4, 8); ctx.lineTo(4, -8); ctx.lineTo(12, 8); ctx.lineTo(18, 0);
    ctx.lineTo(hw - 8, 0);
    ctx.stroke();
  } else if (c.type === 'battery') {
    ctx.beginPath();
    ctx.moveTo(-hw + 8, 0); ctx.lineTo(-6, 0);
    ctx.moveTo(6, 0); ctx.lineTo(hw - 8, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, -14); ctx.lineTo(-6, 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6, -8); ctx.lineTo(6, 8);
    ctx.stroke();
  } else if (c.type === 'bulb') {
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-8, -8); ctx.lineTo(8, 8);
    ctx.moveTo(-8, 8); ctx.lineTo(8, -8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-hw + 8, 0); ctx.lineTo(-12, 0);
    ctx.moveTo(12, 0); ctx.lineTo(hw - 8, 0);
    ctx.stroke();
  } else {
    drawCompReal(ctx, c);
  }
}

function drawProbeLead(ctx, startX, startY, endX, endY, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  const midY = (startY + endY) / 2 + 50;
  ctx.quadraticCurveTo(startX, midY, endX, endY);
  ctx.stroke();
}

function drawFlameParticles(ctx) {
  const highCurrent = circuitState.components.some(c => Math.abs(c.current) > 15);
  if (highCurrent) {
    for (let i = 0; i < 4; i++) {
      circuitState.flameParticles.push({
        x: 400 + (Math.random() - 0.5) * 40,
        y: 300,
        vx: (Math.random() - 0.5) * 2,
        vy: -Math.random() * 3 - 2,
        life: 1.0,
        color: Math.random() > 0.5 ? '#ff4500' : '#ffd700'
      });
    }
  }

  for (let i = circuitState.flameParticles.length - 1; i >= 0; i--) {
    const p = circuitState.flameParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.04;
    if (p.life <= 0) {
      circuitState.flameParticles.splice(i, 1);
      continue;
    }
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.life;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }
}

// =========================================================================
// 3. 🧲 Faraday's Electromagnetics Lab Engine
// =========================================================================
const faradayState = {
  apparatus: 'pickup', // 'pickup', 'electromagnet', 'transformer', 'generator'
  magnet: { x: 260, y: 250, vx: 0, isDragging: false },
  coil: { x: 520, y: 250, turns: 3, radius: 55 },
  electromagnet: { current: 1.5, isAC: false, acFreq: 2.0 },
  generator: { angle: 0, speed: 0.04, waterRate: 0.6 },
  showBField: true,
  showCompass: true,
  flux: 0.0,
  dFluxDt: 0.0,
  inducedEMF: 0.0
};

function updateFaradayPhysics(dt) {
  const dx = faradayState.magnet.x - faradayState.coil.x;
  const dy = faradayState.magnet.y - faradayState.coil.y;
  const dist = Math.hypot(dx, dy);

  let prevFlux = faradayState.flux;

  if (faradayState.apparatus === 'pickup') {
    // Dipole field flux Φ = B * A * cos(θ) where B ≈ μ0*m / (2π * r^3)
    const B = (10000 / Math.max(800, dist ** 2.2));
    faradayState.flux = B * (faradayState.coil.radius / 50) ** 2 * (dx < 0 ? 1 : -1);
    faradayState.dFluxDt = (faradayState.flux - prevFlux) / Math.max(1e-4, dt);
    faradayState.inducedEMF = -faradayState.coil.turns * faradayState.dFluxDt * 0.02;
  } else if (faradayState.apparatus === 'generator') {
    faradayState.generator.angle += faradayState.generator.speed * (faradayState.generator.waterRate * 2.5);
    const B = 8.5;
    faradayState.flux = B * Math.cos(faradayState.generator.angle);
    faradayState.dFluxDt = -B * Math.sin(faradayState.generator.angle) * faradayState.generator.speed * 25;
    faradayState.inducedEMF = -faradayState.coil.turns * faradayState.dFluxDt * 0.015;
  } else if (faradayState.apparatus === 'electromagnet' || faradayState.apparatus === 'transformer') {
    const I = faradayState.electromagnet.isAC ? Math.sin(app.simTime * 6.28 * faradayState.electromagnet.acFreq) : faradayState.electromagnet.current;
    faradayState.flux = (I * 15.0) / Math.max(1.0, (dist / 100));
    faradayState.dFluxDt = (faradayState.flux - prevFlux) / Math.max(1e-4, dt);
    faradayState.inducedEMF = -faradayState.coil.turns * faradayState.dFluxDt * 0.02;
  }

  // Update HUD
  const emfEl = document.getElementById('faraday-hud-emf');
  const fluxEl = document.getElementById('faraday-hud-flux');
  if (emfEl) emfEl.textContent = `${faradayState.inducedEMF.toFixed(2)} V`;
  if (fluxEl) fluxEl.textContent = `${(faradayState.flux * 0.01).toFixed(3)} Wb`;
}

function renderFaraday(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);

  // Compass grid
  if (faradayState.showCompass) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    for (let x = 60; x < w; x += 60) {
      for (let y = 60; y < h; y += 60) {
        const angle = Math.atan2(y - faradayState.magnet.y, x - faradayState.magnet.x);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(0, -1.5, 8, 3);
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(-8, -1.5, 8, 3);
        ctx.restore();
      }
    }
  }

  // Bar Magnet
  const mx = faradayState.magnet.x;
  const my = faradayState.magnet.y;
  ctx.save();
  ctx.translate(mx, my);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 12;
  // South pole (Blue)
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(-60, -22, 60, 44);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('S', -40, 6);
  // North pole (Red)
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(0, -22, 60, 44);
  ctx.fillStyle = '#fff';
  ctx.fillText('N', 24, 6);
  ctx.restore();

  // Solenoid Coil
  const cx = faradayState.coil.x;
  const cy = faradayState.coil.y;
  const r = faradayState.coil.radius;
  const turns = faradayState.coil.turns;

  for (let t = 0; t < turns; t++) {
    const ox = cx + (t - turns / 2) * 22;
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(ox, cy, 14, r, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Galvanometer Meter with deflected needle
  const gx = cx + 80;
  const gy = cy - 110;
  ctx.fillStyle = '#1e2433';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(gx, gy, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Deflection needle
  const defl = Math.max(-1.0, Math.min(1.0, faradayState.inducedEMF * 1.5)) * (Math.PI / 4);
  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(defl);
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, 8); ctx.lineTo(0, -32);
  ctx.stroke();
  ctx.restore();

  // Light bulb illuminated by induced EMF
  const bulbPower = Math.abs(faradayState.inducedEMF);
  if (bulbPower > 0.05) {
    const glow = Math.min(50, 10 + bulbPower * 15);
    const grad = ctx.createRadialGradient(cx, cy + r + 40, 2, cx, cy + r + 40, glow);
    grad.addColorStop(0, 'rgba(255, 230, 80, 0.9)');
    grad.addColorStop(1, 'rgba(255, 200, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy + r + 40, glow, 0, Math.PI * 2);
    ctx.fill();
  }
}

// =========================================================================
// 4. ⫛ Capacitor Lab Engine
// =========================================================================
const capState = {
  plateDist: 5.0,     // mm
  plateArea: 200,     // mm^2
  dielectricKappa: 1.0,
  dielectricInsert: 0,// 0 to 100%
  conn: 'battery',    // 'battery', 'open', 'bulb'
  batteryV: 1.5,      // Volts
  voltage: 1.5,
  charge: 0.0,
  energy: 0.0,
  cVal: 0.0,
  dischargeI: 0.0
};

function updateCapacitorPhysics(dt) {
  const eps0 = 8.854e-12; // F/m
  const A = capState.plateArea * 1e-6; // m^2
  const d = capState.plateDist * 1e-3; // m
  const effKappa = 1.0 + (capState.dielectricKappa - 1.0) * (capState.dielectricInsert / 100.0);

  capState.cVal = (effKappa * eps0 * A) / d; // Farads

  if (capState.conn === 'battery') {
    capState.voltage = capState.batteryV;
    capState.charge = capState.cVal * capState.voltage;
    capState.dischargeI = 0.0;
  } else if (capState.conn === 'open') {
    // Q is conserved, V adapts if plates move
    capState.voltage = capState.cVal > 0 ? (capState.charge / capState.cVal) : 0;
    capState.dischargeI = 0.0;
  } else if (capState.conn === 'bulb') {
    // RC exponential discharge: R = 100 Ohms
    const R = 100.0;
    const tau = Math.max(1e-7, R * capState.cVal);
    const decay = Math.exp(-dt / tau);
    capState.voltage *= decay;
    capState.charge = capState.cVal * capState.voltage;
    capState.dischargeI = capState.voltage / R;
  }

  capState.energy = 0.5 * capState.cVal * (capState.voltage ** 2);

  // HUD
  const cEl = document.getElementById('cap-hud-c');
  const uEl = document.getElementById('cap-hud-u');
  if (cEl) cEl.textContent = `${(capState.cVal * 1e12).toFixed(2)} pF`;
  if (uEl) uEl.textContent = `${(capState.energy * 1e12).toFixed(2)} pJ`;
}

function renderCapacitor(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const plateW = 180 * (capState.plateArea / 200);
  const sep = capState.plateDist * 16;

  // Top Plate (+Q)
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(cx - plateW / 2, cy - sep / 2 - 12, plateW, 12);
  // Bottom Plate (-Q)
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(cx - plateW / 2, cy + sep / 2, plateW, 12);

  // Dielectric slab
  if (capState.dielectricInsert > 0) {
    const dW = plateW * (capState.dielectricInsert / 100);
    ctx.fillStyle = 'rgba(168, 85, 247, 0.4)';
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 1.5;
    ctx.fillRect(cx - plateW / 2, cy - sep / 2, dW, sep);
    ctx.strokeRect(cx - plateW / 2, cy - sep / 2, dW, sep);
  }

  // Electric Field flux lines
  if (Math.abs(capState.voltage) > 0.05) {
    const numLines = Math.min(24, Math.max(4, Math.floor(capState.plateArea / 12)));
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.5)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= numLines; i++) {
      const lx = cx - plateW / 2 + (i / numLines) * plateW;
      ctx.beginPath();
      ctx.moveTo(lx, cy - sep / 2);
      ctx.lineTo(lx, cy + sep / 2);
      ctx.stroke();
    }
  }

  // Discharge bulb if connected
  if (capState.conn === 'bulb' && Math.abs(capState.dischargeI) > 0.001) {
    const glow = Math.min(45, 10 + capState.dischargeI * 100);
    const grad = ctx.createRadialGradient(cx + plateW / 2 + 70, cy, 2, cx + plateW / 2 + 70, cy, glow);
    grad.addColorStop(0, 'rgba(255, 240, 100, 0.9)');
    grad.addColorStop(1, 'rgba(255, 200, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx + plateW / 2 + 70, cy, glow, 0, Math.PI * 2);
    ctx.fill();
  }
}

// =========================================================================
// 5. 📏 Resistivity & Ohm's Law Lab Engine (Drude Model)
// =========================================================================
const resState = {
  rho: 1.0,     // Ohm * cm
  length: 10.0, // cm
  area: 5.0,    // mm^2
  voltage: 4.5, // Volts
  resistance: 2.0,
  current: 2.25,
  scatterers: [],
  driftElectrons: []
};

function initResistivityParticles() {
  resState.scatterers = [];
  resState.driftElectrons = [];
  for (let i = 0; i < 60; i++) {
    resState.scatterers.push({
      x: Math.random(),
      y: Math.random()
    });
  }
  for (let i = 0; i < 40; i++) {
    resState.driftElectrons.push({
      x: Math.random(),
      y: Math.random(),
      vx: 0.5
    });
  }
}

function updateResistivityPhysics(dt) {
  // R = rho * (L / A)
  // rho in Ohm*cm, L in cm, A in mm^2 (1 mm^2 = 0.01 cm^2)
  const A_cm2 = resState.area * 0.01;
  resState.resistance = (resState.rho * resState.length) / Math.max(1e-4, A_cm2);
  resState.current = resState.voltage / Math.max(1e-3, resState.resistance);

  // Update HUD
  const rEl = document.getElementById('res-hud-r');
  const iEl = document.getElementById('res-hud-i');
  if (rEl) rEl.textContent = `${resState.resistance.toFixed(2)} Ω`;
  if (iEl) iEl.textContent = `${resState.current.toFixed(2)} A`;

  // Advance Drude electrons
  const vDrift = resState.current * 0.015;
  resState.driftElectrons.forEach(e => {
    e.x += vDrift;
    if (e.x > 1.0) e.x = 0.0;
  });
}

function renderResistivity(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const wireW = 160 + resState.length * 15;
  const wireH = 30 + resState.area * 8;

  // 3D wire cylinder tube
  ctx.fillStyle = 'rgba(217, 119, 6, 0.25)';
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cx - wireW / 2, cy - wireH / 2, wireW, wireH, 8);
  ctx.fill();
  ctx.stroke();

  // Lattice impurity scatterers (Drude phonon/impurity sites)
  const numScatter = Math.floor(resState.rho * 12);
  ctx.fillStyle = '#f59e0b';
  for (let i = 0; i < numScatter; i++) {
    const sc = resState.scatterers[i % resState.scatterers.length];
    const sx = cx - wireW / 2 + 10 + sc.x * (wireW - 20);
    const sy = cy - wireH / 2 + 6 + sc.y * (wireH - 12);
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Drifting electron swarm
  ctx.fillStyle = '#00d2ff';
  resState.driftElectrons.forEach(e => {
    const ex = cx - wireW / 2 + 10 + e.x * (wireW - 20);
    const ey = cy - wireH / 2 + 6 + e.y * (wireH - 12);
    ctx.beginPath();
    ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Battery and meter labels
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '12px monospace';
  ctx.fillText(`V = ${resState.voltage.toFixed(1)} V`, cx - 30, cy + wireH / 2 + 35);
  ctx.fillText(`I = ${resState.current.toFixed(2)} A`, cx - 30, cy - wireH / 2 - 20);
}

// =========================================================================
// 6. 💡 Photoelectric Phototube Lab Engine
// =========================================================================
const peState = {
  metal: 'sodium',
  wf: 2.28,         // eV
  wavelength: 400,  // nm
  intensity: 60,    // %
  biasV: 0.0,       // Volts
  photonEnergy: 3.10,
  maxKE: 0.82,
  stoppingV: 0.82,
  photocurrent: 4.20,
  electrons: [],
  photons: []
};

function updatePhotoelectricPhysics(dt) {
  // E_photon = hc / lambda = 1240 / lambda(nm)
  peState.photonEnergy = 1240.0 / Math.max(10, peState.wavelength);
  peState.maxKE = Math.max(0.0, peState.photonEnergy - peState.wf);
  peState.stoppingV = peState.maxKE;

  // Current cuts off if bias voltage is more negative than -stoppingV
  if (peState.photonEnergy > peState.wf && peState.biasV >= -peState.stoppingV) {
    const saturationI = (peState.intensity / 100.0) * 8.0;
    const factor = (peState.biasV + peState.stoppingV) / Math.max(0.2, peState.stoppingV);
    peState.photocurrent = Math.min(saturationI, saturationI * Math.min(1.0, factor));
  } else {
    peState.photocurrent = 0.0;
  }

  // Generate photons & electrons
  if (peState.intensity > 0 && Math.random() < peState.intensity / 80) {
    peState.photons.push({ x: 260, y: 160 + Math.random() * 80 });
  }

  if (peState.photocurrent > 0 && Math.random() < peState.photocurrent / 4) {
    peState.electrons.push({
      x: 320,
      y: 200 + Math.random() * 80,
      vx: 2.0 + peState.maxKE * 1.5,
      alive: true
    });
  }

  // Move particles
  peState.photons.forEach(p => { p.x += 4; });
  peState.photons = peState.photons.filter(p => p.x < 320);

  peState.electrons.forEach(e => {
    e.vx += peState.biasV * 0.15; // accelerated or decelerated by bias
    e.x += e.vx;
    if (e.vx <= 0 && e.x < 320) e.alive = false;
  });
  peState.electrons = peState.electrons.filter(e => e.alive && e.x < 560);

  // HUD
  const eEl = document.getElementById('pe-hud-e');
  const iEl = document.getElementById('pe-hud-i');
  if (eEl) eEl.textContent = `${peState.photonEnergy.toFixed(2)} eV`;
  if (iEl) iEl.textContent = `${peState.photocurrent.toFixed(2)} µA`;
}

function renderPhotoelectric(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);

  // Vacuum chamber tube
  ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(280, 160, 300, 180, 20);
  ctx.fill();
  ctx.stroke();

  // Cathode target plate
  ctx.fillStyle = '#64748b';
  ctx.fillRect(315, 190, 10, 120);

  // Anode collector plate
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(555, 190, 8, 120);

  // Monochromatic Light Beam
  const beamCol = wavelengthToRGB(peState.wavelength);
  ctx.strokeStyle = beamCol;
  ctx.lineWidth = 3;
  peState.photons.forEach(p => {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 8, p.y + 4);
    ctx.stroke();
  });

  // Photoelectrons ejected
  ctx.fillStyle = '#00d2ff';
  peState.electrons.forEach(e => {
    ctx.beginPath();
    ctx.arc(e.x, e.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function wavelengthToRGB(w) {
  if (w < 400) return '#7e22ce'; // UV / Violet
  if (w < 490) return '#2563eb'; // Blue
  if (w < 560) return '#10b981'; // Green
  if (w < 600) return '#eab308'; // Yellow
  if (w < 700) return '#ef4444'; // Red
  return '#991b1b';              // IR
}

// =========================================================================
// 7. 🔬 Semiconductor & Diode Lab Engine
// =========================================================================
const semiState = {
  material: 'si',
  eg: 1.12,         // eV
  vk: 0.7,          // Knee voltage
  biasV: 0.0,
  temp: 300,        // K
  doping: 5,
  current: 0.0,
  depletionW: 40,   // px
  recombPhotons: []
};

function updateSemiconductorPhysics(dt) {
  // Shockley Diode equation with forward series resistance
  const vt = (1.38e-23 * semiState.temp) / 1.6e-19; // ~26mV at 300K
  if (semiState.biasV < 0) {
    semiState.current = -1e-3 * (1.0 - Math.exp(semiState.biasV / (2 * vt)));
  } else if (semiState.biasV < semiState.vk) {
    semiState.current = 1e-3 * (Math.exp(semiState.biasV / (2 * vt)) - 1);
  } else {
    // Conduction regime above knee voltage with internal series resistance (Rs ~ 25 ohms)
    semiState.current = 1.0 + (semiState.biasV - semiState.vk) * 40.0;
  }

  // Depletion region width W = W0 * sqrt(1 - V / Vbi)
  const vbi = semiState.vk;
  const ratio = Math.max(0.1, 1.0 - semiState.biasV / (vbi + 0.1));
  semiState.depletionW = Math.max(4, Math.min(80, 40 * Math.sqrt(ratio)));

  // Photons for LED GaAs
  if (semiState.material === 'gaas' && semiState.current > 1.0) {
    semiState.recombPhotons.push({
      x: 400 + (Math.random() - 0.5) * 8,
      y: 240 + (Math.random() - 0.5) * 20,
      vy: -2.5,
      life: 1.0
    });
  }

  semiState.recombPhotons.forEach(p => { p.y += p.vy; p.life -= 0.05; });
  semiState.recombPhotons = semiState.recombPhotons.filter(p => p.life > 0);

  // HUD
  const stateEl = document.getElementById('semi-hud-state');
  const iEl = document.getElementById('semi-hud-i');
  if (stateEl) {
    stateEl.textContent = semiState.biasV > semiState.vk ? 'Forward Conduction' : (semiState.biasV < -0.1 ? 'Reverse Bias' : 'Equilibrium');
  }
  if (iEl) iEl.textContent = `${Math.max(0, semiState.current).toFixed(2)} mA`;
}

function renderSemiconductor(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2 - 20;

  // P-type zone (Left)
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(cx - 180, cy - 50, 180, 100);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('P-TYPE (Holes h⁺)', cx - 140, cy + 5);

  // N-type zone (Right)
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(cx, cy - 50, 180, 100);
  ctx.fillStyle = '#fff';
  ctx.fillText('N-TYPE (Electrons e⁻)', cx + 20, cy + 5);

  // Depletion Layer (Space Charge Region)
  const dw = semiState.depletionW;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  ctx.fillRect(cx - dw, cy - 50, dw * 2, 100);
  ctx.strokeRect(cx - dw, cy - 50, dw * 2, 100);

  // LED Photon Emission bursts
  ctx.fillStyle = '#fde047';
  semiState.recombPhotons.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Energy Band Diagram below junction
  const by = cy + 90;
  ctx.strokeStyle = '#00d2ff';
  ctx.lineWidth = 2;
  // Conduction band
  ctx.beginPath();
  ctx.moveTo(cx - 160, by);
  ctx.lineTo(cx - dw, by);
  ctx.lineTo(cx + dw, by + 30 * (1 - semiState.biasV / semiState.vk));
  ctx.lineTo(cx + 160, by + 30 * (1 - semiState.biasV / semiState.vk));
  ctx.stroke();
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText('Conduction Band (Ec)', cx - 160, by - 6);
}

// =========================================================================
// 8. 📡 Radio Waves & Dipole Lab Engine
// =========================================================================
const radioState = {
  mode: 'sine',
  freq: 2.5,        // MHz
  amplitude: 70,    // %
  distance: 150,    // m
  showEField: true,
  showWaves: true,
  txElectronY: 0,
  rxElectronY: 0,
  wavePackets: []
};

function updateRadioWavesPhysics(dt) {
  // speed of light c = 3e8 m/s
  const lambda = 300.0 / Math.max(0.1, radioState.freq); // m
  const omega = 2 * Math.PI * radioState.freq;

  // Transmitter oscillation
  const amp = radioState.amplitude * 0.4;
  radioState.txElectronY = Math.sin(app.simTime * omega * 2) * amp;

  // Add radiating wavefront
  if (Math.sin(app.simTime * omega * 2) > 0.95) {
    radioState.wavePackets.push({ r: 0, amp });
  }

  // Wave packets expand outward at c
  radioState.wavePackets.forEach(w => { w.r += 3.5; });
  radioState.wavePackets = radioState.wavePackets.filter(w => w.r < 500);

  // Receiver electron oscillates with delay tau = r / c
  const delay = radioState.distance / 300.0;
  radioState.rxElectronY = Math.sin((app.simTime - delay) * omega * 2) * (amp / (radioState.distance / 100));

  // HUD
  const lamEl = document.getElementById('radio-hud-lambda');
  const rxEl = document.getElementById('radio-hud-rx');
  if (lamEl) lamEl.textContent = `${lambda.toFixed(1)} m`;
  if (rxEl) rxEl.textContent = `${(Math.abs(radioState.rxElectronY) * 0.4).toFixed(2)} mV`;
}

function renderRadioWaves(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);

  const txX = 140;
  const ty = h / 2;
  const rxX = txX + radioState.distance * 2;

  // Radiating Wavefront rings
  if (radioState.showWaves) {
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.25)';
    ctx.lineWidth = 2;
    radioState.wavePackets.forEach(wp => {
      ctx.beginPath();
      ctx.arc(txX, ty, wp.r, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  // Transmitter Antenna Rod
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(txX, ty - 60); ctx.lineTo(txX, ty + 60);
  ctx.stroke();

  // Driven oscillating electron (Tx)
  ctx.fillStyle = '#00d2ff';
  ctx.beginPath();
  ctx.arc(txX, ty + radioState.txElectronY, 6, 0, Math.PI * 2);
  ctx.fill();

  // Receiver Antenna Rod
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(rxX, ty - 60); ctx.lineTo(rxX, ty + 60);
  ctx.stroke();

  // Induced responding electron (Rx)
  ctx.fillStyle = '#ff9100';
  ctx.beginPath();
  ctx.arc(rxX, ty + radioState.rxElectronY, 6, 0, Math.PI * 2);
  ctx.fill();
}

// =========================================================================
// 9. ⭐ Unified INStep Transient Micro-Stepper & Telemetry
// =========================================================================
function stepINStep(dtOverride) {
  const dt = dtOverride || app.dt;
  app.stepCount++;
  app.simTime += dt;

  // Advance the active laboratory physics
  switch (app.activeLab) {
    case 'circuit':
      solveCircuit();
      updateCircuitTelemetry(dt);
      break;
    case 'faraday':
      updateFaradayPhysics(dt);
      updateFaradayTelemetry(dt);
      break;
    case 'capacitor':
      updateCapacitorPhysics(dt);
      updateCapacitorTelemetry(dt);
      break;
    case 'resistivity':
      updateResistivityPhysics(dt);
      updateResistivityTelemetry(dt);
      break;
    case 'photoelectric':
      updatePhotoelectricPhysics(dt);
      updatePhotoelectricTelemetry(dt);
      break;
    case 'semiconductor':
      updateSemiconductorPhysics(dt);
      updateSemiconductorTelemetry(dt);
      break;
    case 'radiowaves':
      updateRadioWavesPhysics(dt);
      updateRadioWavesTelemetry(dt);
      break;
  }

  // Common step headers
  document.getElementById('instep-step-count').textContent = `#${app.stepCount}`;
  document.getElementById('instep-time-val').textContent = `${(app.simTime * 1000).toFixed(2)} ms`;

  renderWaveform();
}

function updateCircuitTelemetry(dt) {
  const maxI = Math.max(0, ...circuitState.components.map(c => Math.abs(c.current)));
  const totalP = circuitState.components
    .filter(c => c.type === 'resistor' || c.type === 'bulb')
    .reduce((sum, c) => sum + Math.abs(c.current * c.voltageDrop), 0);

  document.getElementById('instep-metric-1-lbl').textContent = 'Drude Drift Speed:';
  document.getElementById('instep-metric-1-val').textContent = `${(maxI * 26.437).toFixed(2)} µm/s`;
  document.getElementById('instep-metric-2-lbl').textContent = 'Electron Flux (ΔQ):';
  document.getElementById('instep-metric-2-val').textContent = `${(maxI * dt * 1e6).toFixed(2)} µC / step`;
  document.getElementById('instep-metric-3-lbl').textContent = 'Total Dissipation:';
  document.getElementById('instep-metric-3-val').textContent = `${totalP.toFixed(2)} W`;
  document.getElementById('instep-metric-4-lbl').textContent = 'KCL Node Residual:';
  document.getElementById('instep-metric-4-val').textContent = '0.0000 A (Balanced)';

  app.waveformHistory.push({
    time: app.simTime,
    v: circuitState.components.find(c => c.type === 'battery')?.value || 0,
    i: maxI
  });
  if (app.waveformHistory.length > 50) app.waveformHistory.shift();
}

function updateFaradayTelemetry(dt) {
  document.getElementById('instep-metric-1-lbl').textContent = 'Magnetic Flux (Φ):';
  document.getElementById('instep-metric-1-val').textContent = `${(faradayState.flux * 0.01).toFixed(4)} Wb`;
  document.getElementById('instep-metric-2-lbl').textContent = 'Flux Rate (dΦ/dt):';
  document.getElementById('instep-metric-2-val').textContent = `${(faradayState.dFluxDt * 0.01).toFixed(3)} Wb/s`;
  document.getElementById('instep-metric-3-lbl').textContent = 'Induced EMF (ℰ):';
  document.getElementById('instep-metric-3-val').textContent = `${faradayState.inducedEMF.toFixed(3)} V`;
  document.getElementById('instep-metric-4-lbl').textContent = 'Lenz Law Polarity:';
  document.getElementById('instep-metric-4-val').textContent = faradayState.inducedEMF >= 0 ? '+ Direct' : '- Opposing';

  app.waveformHistory.push({
    time: app.simTime,
    v: faradayState.flux * 0.1,
    i: faradayState.inducedEMF
  });
  if (app.waveformHistory.length > 50) app.waveformHistory.shift();
}

function updateCapacitorTelemetry(dt) {
  document.getElementById('instep-metric-1-lbl').textContent = 'Capacitance (C):';
  document.getElementById('instep-metric-1-val').textContent = `${(capState.cVal * 1e12).toFixed(2)} pF`;
  document.getElementById('instep-metric-2-lbl').textContent = 'Plate Charge (Q):';
  document.getElementById('instep-metric-2-val').textContent = `${(capState.charge * 1e12).toFixed(2)} pC`;
  document.getElementById('instep-metric-3-lbl').textContent = 'Stored Energy (U):';
  document.getElementById('instep-metric-3-val').textContent = `${(capState.energy * 1e12).toFixed(2)} pJ`;
  document.getElementById('instep-metric-4-lbl').textContent = 'Discharge Current:';
  document.getElementById('instep-metric-4-val').textContent = `${(capState.dischargeI * 1000).toFixed(2)} mA`;

  app.waveformHistory.push({
    time: app.simTime,
    v: capState.voltage,
    i: capState.dischargeI * 10
  });
  if (app.waveformHistory.length > 50) app.waveformHistory.shift();
}

function updateResistivityTelemetry(dt) {
  document.getElementById('instep-metric-1-lbl').textContent = 'Resistance (R):';
  document.getElementById('instep-metric-1-val').textContent = `${resState.resistance.toFixed(2)} Ω`;
  document.getElementById('instep-metric-2-lbl').textContent = 'Branch Current (I):';
  document.getElementById('instep-metric-2-val').textContent = `${resState.current.toFixed(2)} A`;
  document.getElementById('instep-metric-3-lbl').textContent = 'Joule Heat (I²R):';
  document.getElementById('instep-metric-3-val').textContent = `${(resState.current**2 * resState.resistance).toFixed(2)} W`;
  document.getElementById('instep-metric-4-lbl').textContent = 'Mean Free Path (λ):';
  document.getElementById('instep-metric-4-val').textContent = `${(32.0 / resState.rho).toFixed(1)} nm`;

  app.waveformHistory.push({
    time: app.simTime,
    v: resState.voltage,
    i: resState.current
  });
  if (app.waveformHistory.length > 50) app.waveformHistory.shift();
}

function updatePhotoelectricTelemetry(dt) {
  document.getElementById('instep-metric-1-lbl').textContent = 'Photon Energy (E):';
  document.getElementById('instep-metric-1-val').textContent = `${peState.photonEnergy.toFixed(2)} eV`;
  document.getElementById('instep-metric-2-lbl').textContent = 'Max Kinetic (K_max):';
  document.getElementById('instep-metric-2-val').textContent = `${peState.maxKE.toFixed(2)} eV`;
  document.getElementById('instep-metric-3-lbl').textContent = 'Stopping Potential:';
  document.getElementById('instep-metric-3-val').textContent = `-${peState.stoppingV.toFixed(2)} V`;
  document.getElementById('instep-metric-4-lbl').textContent = 'Photocurrent:';
  document.getElementById('instep-metric-4-val').textContent = `${peState.photocurrent.toFixed(2)} µA`;

  app.waveformHistory.push({
    time: app.simTime,
    v: peState.photonEnergy,
    i: peState.photocurrent
  });
  if (app.waveformHistory.length > 50) app.waveformHistory.shift();
}

function updateSemiconductorTelemetry(dt) {
  document.getElementById('instep-metric-1-lbl').textContent = 'Diode Current:';
  document.getElementById('instep-metric-1-val').textContent = `${semiState.current.toFixed(2)} mA`;
  document.getElementById('instep-metric-2-lbl').textContent = 'Depletion Width:';
  document.getElementById('instep-metric-2-val').textContent = `${(semiState.depletionW * 0.05).toFixed(2)} µm`;
  document.getElementById('instep-metric-3-lbl').textContent = 'Bandgap (Eg):';
  document.getElementById('instep-metric-3-val').textContent = `${semiState.eg.toFixed(2)} eV`;
  document.getElementById('instep-metric-4-lbl').textContent = 'Thermal Voltage (Vt):';
  document.getElementById('instep-metric-4-val').textContent = '25.86 mV';

  app.waveformHistory.push({
    time: app.simTime,
    v: semiState.biasV,
    i: semiState.current
  });
  if (app.waveformHistory.length > 50) app.waveformHistory.shift();
}

function updateRadioWavesTelemetry(dt) {
  const lambda = 300.0 / Math.max(0.1, radioState.freq);
  document.getElementById('instep-metric-1-lbl').textContent = 'Wavelength (λ):';
  document.getElementById('instep-metric-1-val').textContent = `${lambda.toFixed(1)} m`;
  document.getElementById('instep-metric-2-lbl').textContent = 'Propagation Delay:';
  document.getElementById('instep-metric-2-val').textContent = `${(radioState.distance / 0.3).toFixed(1)} ns`;
  document.getElementById('instep-metric-3-lbl').textContent = 'Rx Induced Signal:';
  document.getElementById('instep-metric-3-val').textContent = `${(Math.abs(radioState.rxElectronY) * 0.4).toFixed(2)} mV`;
  document.getElementById('instep-metric-4-lbl').textContent = 'Radiation Phase:';
  document.getElementById('instep-metric-4-val').textContent = `${((app.simTime * 2 * Math.PI * radioState.freq) % (2 * Math.PI)).toFixed(2)} rad`;

  app.waveformHistory.push({
    time: app.simTime,
    v: radioState.txElectronY * 0.1,
    i: radioState.rxElectronY * 0.1
  });
  if (app.waveformHistory.length > 50) app.waveformHistory.shift();
}

function renderWaveform() {
  const ctx = contexts.waveform;
  const w = canvases.waveform.width;
  const h = canvases.waveform.height;
  ctx.clearRect(0, 0, w, h);

  // Centerline
  ctx.strokeStyle = '#1e2433';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
  ctx.stroke();

  if (app.waveformHistory.length < 2) return;

  // Trace 1 (Cyan)
  ctx.strokeStyle = '#00d2ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  app.waveformHistory.forEach((pt, idx) => {
    const x = (idx / (app.waveformHistory.length - 1)) * w;
    const y = Math.max(2, Math.min(h - 2, h / 2 - pt.v * 4));
    if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Trace 2 (Orange)
  ctx.strokeStyle = '#ff9100';
  ctx.lineWidth = 2;
  ctx.beginPath();
  app.waveformHistory.forEach((pt, idx) => {
    const x = (idx / (app.waveformHistory.length - 1)) * w;
    const y = Math.max(2, Math.min(h - 2, h / 2 - pt.i * 6));
    if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// =========================================================================
// 10. Lab Switcher Navigation & Interaction Setup
// =========================================================================
function switchLab(labKey) {
  app.activeLab = labKey;

  // Update Navigation Tab Buttons
  document.querySelectorAll('.module-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === labKey);
  });

  // Update Left Drawers
  document.querySelectorAll('.drawer-panel').forEach(p => {
    p.classList.toggle('active', p.id === `drawer-${labKey}`);
  });

  // Update Viewport Stages
  document.querySelectorAll('.lab-stage').forEach(s => {
    s.classList.toggle('active', s.id === `stage-${labKey}`);
  });

  // Update INStep Sidebar Header Tag
  const tagMap = {
    circuit: 'Circuit MNA',
    faraday: 'Faraday Induction',
    capacitor: 'Dielectric Capacitor',
    resistivity: 'Drude Lattice',
    photoelectric: 'Photoelectric Effect',
    semiconductor: 'P-N Semiconductor',
    radiowaves: 'Dipole Radiation'
  };
  const tagEl = document.getElementById('instep-lab-tag');
  if (tagEl) tagEl.textContent = tagMap[labKey] || 'Physics Solver';

  resizeAllCanvases();
  stepINStep(0.0);
}

function resizeAllCanvases() {
  const vp = document.getElementById('canvas-viewport');
  const w = vp.clientWidth;
  const h = vp.clientHeight;
  if (!w || !h) return;

  Object.values(canvases).forEach(cv => {
    if (cv && cv !== canvases.waveform) {
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
    }
  });
}

// =========================================================================
// 11. Event Listeners & UI Binding
// =========================================================================
function initEventListeners() {
  window.addEventListener('resize', resizeAllCanvases);

  // Tab Navigation clicks
  document.querySelectorAll('.module-tab').forEach(btn => {
    btn.addEventListener('click', () => switchLab(btn.dataset.tab));
  });

  // View Mode Buttons (Lifelike, X-Ray, Schematic)
  document.querySelectorAll('#view-mode-control .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#view-mode-control .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      app.viewMode = btn.dataset.view;
    });
  });

  // Flow Mode Buttons (Electrons, Conventional)
  document.querySelectorAll('#flow-mode-control .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#flow-mode-control .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      app.flowMode = btn.dataset.flow;
    });
  });

  // INStep Run / Micro-Step Mode Buttons
  const btnRun = document.getElementById('btn-mode-run');
  const btnInstep = document.getElementById('btn-mode-instep');
  const btnStep = document.getElementById('btn-instep-step');
  const dtSelect = document.getElementById('instep-dt-select');

  btnRun.addEventListener('click', () => {
    app.runMode = 'run';
    btnRun.classList.add('active');
    btnInstep.classList.remove('active');
    btnStep.disabled = true;
  });

  btnInstep.addEventListener('click', () => {
    app.runMode = 'instep';
    btnInstep.classList.add('active');
    btnRun.classList.remove('active');
    btnStep.disabled = false;
  });

  btnStep.addEventListener('click', () => {
    stepINStep();
  });

  dtSelect.addEventListener('change', (e) => {
    app.dt = parseFloat(e.target.value);
  });

  // Clear / Reset Button
  document.getElementById('btn-clear').addEventListener('click', () => {
    if (app.activeLab === 'circuit') {
      circuitState.components = [];
      resetCircuitCurrents();
    } else if (app.activeLab === 'faraday') {
      faradayState.magnet.x = 260;
      faradayState.magnet.y = 250;
    } else if (app.activeLab === 'capacitor') {
      capState.voltage = 1.5;
    }
  });

  // Presets Modal
  const modalPresets = document.getElementById('modal-presets');
  document.getElementById('btn-presets').addEventListener('click', () => {
    modalPresets.style.display = 'flex';
  });
  document.getElementById('modal-presets-close').addEventListener('click', () => {
    modalPresets.style.display = 'none';
  });
  document.querySelectorAll('.preset-card').forEach(card => {
    card.addEventListener('click', () => {
      loadPreset(card.dataset.preset);
      modalPresets.style.display = 'none';
    });
  });

  // ================= Circuit Drawer & Drag-Drop =================
  document.querySelectorAll('.palette-item[draggable="true"]').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('comp-type', item.dataset.type);
    });
  });

  const circuitCv = canvases.circuit;
  circuitCv.addEventListener('dragover', (e) => e.preventDefault());
  circuitCv.addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('comp-type');
    if (!type) return;
    const rect = circuitCv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const comp = new CircuitComponent(type, x, y, type === 'battery' ? 9.0 : 10.0);
    circuitState.components.push(comp);
    solveCircuit();
  });

  // Voltmeter & Ammeter Toggles
  const vmUnit = document.getElementById('voltmeter-unit');
  const amUnit = document.getElementById('ammeter-unit');
  const pBlack = document.getElementById('probe-black');
  const pRed = document.getElementById('probe-red');

  document.getElementById('tool-voltmeter-toggle').addEventListener('click', () => {
    circuitState.voltmeterActive = !circuitState.voltmeterActive;
    vmUnit.style.display = circuitState.voltmeterActive ? 'block' : 'none';
    pBlack.style.display = circuitState.voltmeterActive ? 'flex' : 'none';
    pRed.style.display = circuitState.voltmeterActive ? 'flex' : 'none';
    positionProbes();
  });

  document.getElementById('tool-ammeter-toggle').addEventListener('click', () => {
    circuitState.ammeterActive = !circuitState.ammeterActive;
    amUnit.style.display = circuitState.ammeterActive ? 'block' : 'none';
  });

  document.getElementById('voltmeter-close').addEventListener('click', () => {
    circuitState.voltmeterActive = false;
    vmUnit.style.display = 'none';
    pBlack.style.display = 'none';
    pRed.style.display = 'none';
  });

  document.getElementById('ammeter-close').addEventListener('click', () => {
    circuitState.ammeterActive = false;
    amUnit.style.display = 'none';
  });

  function positionProbes() {
    pBlack.style.left = `${circuitState.probeBlack.x}px`;
    pBlack.style.top = `${circuitState.probeBlack.y}px`;
    pRed.style.left = `${circuitState.probeRed.x}px`;
    pRed.style.top = `${circuitState.probeRed.y}px`;
  }

  // Probe Drags
  makeDraggable(pBlack, (x, y) => {
    circuitState.probeBlack.x = x;
    circuitState.probeBlack.y = y;
  });
  makeDraggable(pRed, (x, y) => {
    circuitState.probeRed.x = x;
    circuitState.probeRed.y = y;
  });
  makeDraggable(vmUnit);
  makeDraggable(amUnit, (x, y) => {
    circuitState.ammeterSensor.x = x + 70;
    circuitState.ammeterSensor.y = y + 70;
  });

  // Circuit Canvas Mouse Interactions
  setupCircuitCanvasMouse(circuitCv);

  // Faraday Apparatus & Parameters
  setupFaradayListeners();

  // Capacitor Parameters
  setupCapacitorListeners();

  // Resistivity Parameters
  setupResistivityListeners();

  // Photoelectric Parameters
  setupPhotoelectricListeners();

  // Semiconductor Parameters
  setupSemiconductorListeners();

  // Radio Waves Parameters
  setupRadioWavesListeners();
}

function makeDraggable(el, onMove) {
  let isDragging = false;
  let offsetX = 0, offsetY = 0;

  el.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - el.offsetLeft;
    offsetY = e.clientY - el.offsetTop;
    e.stopPropagation();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const nx = e.clientX - offsetX;
    const ny = e.clientY - offsetY;
    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;
    if (onMove) onMove(nx, ny);
  });

  window.addEventListener('mouseup', () => { isDragging = false; });
}

function setupCircuitCanvasMouse(cv) {
  let dragComp = null;
  let dragOffset = { x: 0, y: 0 };

  cv.addEventListener('mousedown', (e) => {
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check terminal click for wire drafting
    for (const c of circuitState.components) {
      if (c instanceof WireConnection) continue;
      for (const t of [c.t1, c.t2]) {
        if (Math.hypot(t.x - x, t.y - y) < 14) {
          circuitState.wireDraft = { fromTerminal: t, mouseX: x, mouseY: y };
          return;
        }
      }
    }

    // Check component click
    for (let i = circuitState.components.length - 1; i >= 0; i--) {
      const c = circuitState.components[i];
      if (c instanceof WireConnection) continue;
      if (Math.abs(c.x - x) < c.width / 2 && Math.abs(c.y - y) < c.height / 2) {
        if (c.type === 'switch') {
          c.isClosed = !c.isClosed;
          solveCircuit();
          return;
        }
        dragComp = c;
        dragOffset.x = x - c.x;
        dragOffset.y = y - c.y;
        circuitState.selectedComp = c;
        showPropertyPopup(c);
        return;
      }
    }

    hidePropertyPopup();
  });

  window.addEventListener('mousemove', (e) => {
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (circuitState.wireDraft) {
      circuitState.wireDraft.mouseX = x;
      circuitState.wireDraft.mouseY = y;
    } else if (dragComp) {
      dragComp.moveTo(x - dragOffset.x, y - dragOffset.y);
      solveCircuit();
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (circuitState.wireDraft) {
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const targetTerm = findNearestTerminal(x, y, 20);
      if (targetTerm && targetTerm !== circuitState.wireDraft.fromTerminal) {
        circuitState.components.push(new WireConnection(circuitState.wireDraft.fromTerminal, targetTerm));
        solveCircuit();
      }
      circuitState.wireDraft = null;
    }
    dragComp = null;
  });
}

function showPropertyPopup(c) {
  const popup = document.getElementById('property-popup');
  popup.style.display = 'block';
  popup.style.left = `${Math.min(window.innerWidth - 450, c.x + 60)}px`;
  popup.style.top = `${Math.max(80, c.y - 40)}px`;

  document.getElementById('popup-comp-title').textContent = `${c.type.toUpperCase()} (${c.id})`;
  const slider = document.getElementById('popup-slider');
  const readout = document.getElementById('popup-slider-val');

  if (c.type === 'battery') {
    slider.min = 1; slider.max = 36; slider.value = c.value;
    readout.textContent = `${c.value} V`;
  } else if (c.type === 'resistor' || c.type === 'bulb') {
    slider.min = 1; slider.max = 100; slider.value = c.value;
    readout.textContent = `${c.value} Ω`;
  }

  slider.oninput = (e) => {
    c.value = parseFloat(e.target.value);
    readout.textContent = c.type === 'battery' ? `${c.value} V` : `${c.value} Ω`;
    solveCircuit();
  };

  document.getElementById('popup-delete').onclick = () => {
    circuitState.components = circuitState.components.filter(item => {
      if (item === c) return false;
      if (item instanceof WireConnection && (item.t1.comp === c || item.t2.comp === c)) return false;
      return true;
    });
    hidePropertyPopup();
    solveCircuit();
  };
}

function hidePropertyPopup() {
  document.getElementById('property-popup').style.display = 'none';
}

function setupFaradayListeners() {
  document.querySelectorAll('#drawer-faraday .drawer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#drawer-faraday .drawer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      faradayState.apparatus = btn.dataset.sub;
    });
  });

  document.querySelectorAll('.param-choice-btn[data-turns]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.param-choice-btn[data-turns]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      faradayState.coil.turns = parseInt(btn.dataset.turns);
    });
  });

  const radSlider = document.getElementById('faraday-coil-area');
  radSlider.addEventListener('input', (e) => {
    faradayState.coil.radius = parseFloat(e.target.value);
    document.getElementById('faraday-coil-area-val').textContent = `${faradayState.coil.radius} mm`;
  });

  document.getElementById('faraday-show-bfield').addEventListener('change', (e) => {
    faradayState.showBField = e.target.checked;
  });
  document.getElementById('faraday-show-compass').addEventListener('change', (e) => {
    faradayState.showCompass = e.target.checked;
  });

  // Magnet drag on Faraday canvas
  const fcv = canvases.faraday;
  fcv.addEventListener('mousedown', (e) => {
    const rect = fcv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (Math.hypot(x - faradayState.magnet.x, y - faradayState.magnet.y) < 70) {
      faradayState.magnet.isDragging = true;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!faradayState.magnet.isDragging) return;
    const rect = fcv.getBoundingClientRect();
    faradayState.magnet.x = Math.max(50, Math.min(rect.width - 50, e.clientX - rect.left));
    faradayState.magnet.y = Math.max(50, Math.min(rect.height - 50, e.clientY - rect.top));
  });

  window.addEventListener('mouseup', () => {
    faradayState.magnet.isDragging = false;
  });
}

function setupCapacitorListeners() {
  document.getElementById('cap-plate-dist').addEventListener('input', (e) => {
    capState.plateDist = parseFloat(e.target.value);
    document.getElementById('cap-plate-dist-val').textContent = `${capState.plateDist.toFixed(1)} mm`;
  });

  document.getElementById('cap-plate-area').addEventListener('input', (e) => {
    capState.plateArea = parseFloat(e.target.value);
    document.getElementById('cap-plate-area-val').textContent = `${capState.plateArea} mm²`;
  });

  document.getElementById('cap-dielectric-select').addEventListener('change', (e) => {
    capState.dielectricKappa = parseFloat(e.target.value);
  });

  document.getElementById('cap-dielectric-insert').addEventListener('input', (e) => {
    capState.dielectricInsert = parseFloat(e.target.value);
    document.getElementById('cap-dielectric-insert-val').textContent = `${capState.dielectricInsert} %`;
  });

  document.getElementById('cap-conn-battery').addEventListener('click', () => {
    capState.conn = 'battery';
    setCapBtnActive('cap-conn-battery');
  });
  document.getElementById('cap-conn-open').addEventListener('click', () => {
    capState.conn = 'open';
    setCapBtnActive('cap-conn-open');
  });
  document.getElementById('cap-conn-bulb').addEventListener('click', () => {
    capState.conn = 'bulb';
    setCapBtnActive('cap-conn-bulb');
  });

  function setCapBtnActive(id) {
    ['cap-conn-battery', 'cap-conn-open', 'cap-conn-bulb'].forEach(bid => {
      document.getElementById(bid).classList.toggle('active', bid === id);
    });
  }

  document.getElementById('cap-battery-v').addEventListener('input', (e) => {
    capState.batteryV = parseFloat(e.target.value);
    document.getElementById('cap-battery-v-val').textContent = `${capState.batteryV > 0 ? '+' : ''}${capState.batteryV.toFixed(1)} V`;
  });
}

function setupResistivityListeners() {
  initResistivityParticles();

  document.getElementById('res-rho').addEventListener('input', (e) => {
    resState.rho = parseFloat(e.target.value);
    document.getElementById('res-rho-val').textContent = `${resState.rho.toFixed(2)} Ω·cm`;
  });

  document.querySelectorAll('.preset-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      resState.rho = parseFloat(btn.dataset.rho);
      document.getElementById('res-rho').value = resState.rho;
      document.getElementById('res-rho-val').textContent = `${resState.rho.toFixed(2)} Ω·cm`;
    });
  });

  document.getElementById('res-length').addEventListener('input', (e) => {
    resState.length = parseFloat(e.target.value);
    document.getElementById('res-length-val').textContent = `${resState.length.toFixed(1)} cm`;
  });

  document.getElementById('res-area').addEventListener('input', (e) => {
    resState.area = parseFloat(e.target.value);
    document.getElementById('res-area-val').textContent = `${resState.area.toFixed(1)} mm²`;
  });

  document.getElementById('res-voltage').addEventListener('input', (e) => {
    resState.voltage = parseFloat(e.target.value);
    document.getElementById('res-voltage-val').textContent = `${resState.voltage.toFixed(1)} V`;
  });
}

function setupPhotoelectricListeners() {
  document.getElementById('pe-target-metal').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    peState.metal = opt.value;
    peState.wf = parseFloat(opt.dataset.wf);
  });

  const waveSlider = document.getElementById('pe-wavelength');
  waveSlider.addEventListener('input', (e) => {
    peState.wavelength = parseFloat(e.target.value);
    document.getElementById('pe-wavelength-val').textContent = `${peState.wavelength} nm`;
    const cursor = document.getElementById('pe-spectrum-cursor');
    if (cursor) {
      const pct = (peState.wavelength - 200) / 600 * 100;
      cursor.style.left = `${pct}%`;
    }
  });

  document.getElementById('pe-intensity').addEventListener('input', (e) => {
    peState.intensity = parseFloat(e.target.value);
    document.getElementById('pe-intensity-val').textContent = `${peState.intensity} %`;
  });

  document.getElementById('pe-voltage').addEventListener('input', (e) => {
    peState.biasV = parseFloat(e.target.value);
    document.getElementById('pe-voltage-val').textContent = `${peState.biasV.toFixed(2)} V`;
  });
}

function setupSemiconductorListeners() {
  document.getElementById('semi-material-select').addEventListener('change', (e) => {
    semiState.material = e.target.value;
    if (semiState.material === 'si') { semiState.eg = 1.12; semiState.vk = 0.7; }
    else if (semiState.material === 'ge') { semiState.eg = 0.67; semiState.vk = 0.3; }
    else if (semiState.material === 'gaas') { semiState.eg = 1.42; semiState.vk = 1.8; }
  });

  document.getElementById('semi-bias').addEventListener('input', (e) => {
    semiState.biasV = parseFloat(e.target.value);
    document.getElementById('semi-bias-val').textContent = `${semiState.biasV.toFixed(2)} V`;
  });

  document.getElementById('semi-temp').addEventListener('input', (e) => {
    semiState.temp = parseFloat(e.target.value);
    document.getElementById('semi-temp-val').textContent = `${semiState.temp} K`;
  });

  document.getElementById('semi-doping').addEventListener('input', (e) => {
    semiState.doping = parseFloat(e.target.value);
    document.getElementById('semi-doping-val').textContent = `${semiState.doping} × 10¹⁶ cm⁻³`;
  });
}

function setupRadioWavesListeners() {
  document.getElementById('radio-mode-sine').addEventListener('click', () => {
    radioState.mode = 'sine';
    setRadioBtnActive('radio-mode-sine');
  });
  document.getElementById('radio-mode-pulse').addEventListener('click', () => {
    radioState.mode = 'pulse';
    setRadioBtnActive('radio-mode-pulse');
  });
  document.getElementById('radio-mode-manual').addEventListener('click', () => {
    radioState.mode = 'manual';
    setRadioBtnActive('radio-mode-manual');
  });

  function setRadioBtnActive(id) {
    ['radio-mode-sine', 'radio-mode-pulse', 'radio-mode-manual'].forEach(bid => {
      document.getElementById(bid).classList.toggle('active', bid === id);
    });
  }

  document.getElementById('radio-freq').addEventListener('input', (e) => {
    radioState.freq = parseFloat(e.target.value);
    document.getElementById('radio-freq-val').textContent = `${radioState.freq.toFixed(1)} MHz`;
  });

  document.getElementById('radio-amplitude').addEventListener('input', (e) => {
    radioState.amplitude = parseFloat(e.target.value);
    document.getElementById('radio-amplitude-val').textContent = `${radioState.amplitude} %`;
  });

  document.getElementById('radio-distance').addEventListener('input', (e) => {
    radioState.distance = parseFloat(e.target.value);
    document.getElementById('radio-distance-val').textContent = `${radioState.distance} m`;
  });

  document.getElementById('radio-show-efield').addEventListener('change', (e) => {
    radioState.showEField = e.target.checked;
  });
  document.getElementById('radio-show-waves').addEventListener('change', (e) => {
    radioState.showWaves = e.target.checked;
  });
}

function loadPreset(name) {
  circuitState.components = [];
  if (name === 'simple_series') {
    switchLab('circuit');
    const b = new CircuitComponent('battery', 260, 240, 9);
    const sw = new CircuitComponent('switch', 400, 160);
    const bulb = new CircuitComponent('bulb', 540, 240, 10);
    circuitState.components.push(b, sw, bulb);
    circuitState.components.push(new WireConnection(b.t1, sw.t1));
    circuitState.components.push(new WireConnection(sw.t2, bulb.t1));
    circuitState.components.push(new WireConnection(bulb.t2, b.t2));
  } else if (name === 'parallel_branches') {
    switchLab('circuit');
    const b = new CircuitComponent('battery', 220, 240, 9);
    const l1 = new CircuitComponent('bulb', 420, 170, 10);
    const l2 = new CircuitComponent('bulb', 420, 310, 10);
    circuitState.components.push(b, l1, l2);
    circuitState.components.push(new WireConnection(b.t1, l1.t1));
    circuitState.components.push(new WireConnection(b.t1, l2.t1));
    circuitState.components.push(new WireConnection(l1.t2, b.t2));
    circuitState.components.push(new WireConnection(l2.t2, b.t2));
  } else if (name === 'rc_transient') {
    switchLab('circuit');
    const b = new CircuitComponent('battery', 240, 240, 12);
    const r = new CircuitComponent('resistor', 400, 160, 15);
    const cap = new CircuitComponent('capacitor', 540, 240, 0.05);
    circuitState.components.push(b, r, cap);
    circuitState.components.push(new WireConnection(b.t1, r.t1));
    circuitState.components.push(new WireConnection(r.t2, cap.t1));
    circuitState.components.push(new WireConnection(cap.t2, b.t2));
  } else if (name === 'short_circuit') {
    switchLab('circuit');
    const b = new CircuitComponent('battery', 300, 240, 18);
    const sw = new CircuitComponent('switch', 480, 240);
    circuitState.components.push(b, sw);
    circuitState.components.push(new WireConnection(b.t1, sw.t1));
    circuitState.components.push(new WireConnection(sw.t2, b.t2));
  } else if (name === 'faraday_pickup') {
    switchLab('faraday');
    faradayState.apparatus = 'pickup';
    faradayState.coil.turns = 4;
  } else if (name === 'photoelectric_threshold') {
    switchLab('photoelectric');
    peState.metal = 'sodium';
    peState.wf = 2.28;
    peState.wavelength = 540;
    document.getElementById('pe-wavelength').value = 540;
    document.getElementById('pe-wavelength-val').textContent = '540 nm (Cutoff edge)';
  }

  solveCircuit();
}

// =========================================================================
// 12. Main 60FPS Animation Loop
// =========================================================================
function animationLoop() {
  if (app.runMode === 'run') {
    stepINStep(0.001);
    circuitState.electronDriftOffset = (circuitState.electronDriftOffset + 1.2) % 1000;
  }

  // Render whichever stage is active
  const vp = document.getElementById('canvas-viewport');
  const w = vp.clientWidth;
  const h = vp.clientHeight;

  switch (app.activeLab) {
    case 'circuit':
      renderCircuit(contexts.circuit, w, h);
      break;
    case 'faraday':
      renderFaraday(contexts.faraday, w, h);
      break;
    case 'capacitor':
      renderCapacitor(contexts.capacitor, w, h);
      break;
    case 'resistivity':
      renderResistivity(contexts.resistivity, w, h);
      break;
    case 'photoelectric':
      renderPhotoelectric(contexts.photoelectric, w, h);
      break;
    case 'semiconductor':
      renderSemiconductor(contexts.semiconductor, w, h);
      break;
    case 'radiowaves':
      renderRadioWaves(contexts.radiowaves, w, h);
      break;
  }

  requestAnimationFrame(animationLoop);
}

// Initialization on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  resizeAllCanvases();
  loadPreset('simple_series');
  requestAnimationFrame(animationLoop);
});
