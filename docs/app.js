/**
 * PhET Hardware Simulator — 2D Interactive Physics Laboratories & INStep Engine
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Built with authentic 2D educational aesthetics modeled after PhET Interactive Simulations.
 * Features:
 * - ⚡ Circuit Construction Kit (MNA matrix solver, Drude electrons, Lifelike/See Inside/Schematic)
 * - 🧲 Faraday's Electromagnetics Lab (Bar magnet, pickup coil, galvanometer, induction EMF)
 * - ⫛ Capacitor Lab (Parallel plates, dielectric slabs, E-field lines, RC discharge)
 * - 📏 Wire Resistance (Drude model, geometry R = ρL/A, atomic lattice scattering)
 * - 💡 Photoelectric Effect (Target cathode work function, monochromatic photons, stopping potential)
 * - 🔬 Semiconductor & Diode Lab (P-N junction, depletion zone, bandgap, LED emission)
 * - 📡 Radio Waves Dipole (Oscillating dipole, EM wave propagation at c, receiver antenna)
 * - ⭐ INStep Transient Micro-Stepping Engine & Waveform Monitor
 *
 * Author: @Akshit2247
 */

// =========================================================================
// 1. Simulator Core State & Canvas Setup
// =========================================================================
const app = {
  activeLab: 'circuit',
  viewMode: 'real',         // 'real' (Lifelike), 'xray' (See Inside), 'schematic'
  flowMode: 'electrons',    // 'electrons', 'conventional'
  runMode: 'run',           // 'run', 'instep'
  dt: 0.001,
  stepCount: 0,
  simTime: 0.0,
  waveformHistory: []
};

const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');
const waveCanvas = document.getElementById('waveform-canvas');
const waveCtx = waveCanvas.getContext('2d');

let idCounter = 1;
function genId(p) { return `${p}_${idCounter++}`; }

// =========================================================================
// 2. ⚡ Circuit Construction Kit (PhET 2D Engine)
// =========================================================================
const circuit = {
  components: [],
  selectedComp: null,
  wireDraft: null,
  voltmeterActive: false,
  ammeterActive: false,
  probeBlack: { x: 340, y: 140, isDragging: false },
  probeRed: { x: 440, y: 140, isDragging: false },
  ammeterSensor: { x: 400, y: 220, isDragging: false },
  electronOffset: 0
};

class CircuitComp {
  constructor(type, x, y, val = 10) {
    this.id = genId(type);
    this.type = type; // 'battery', 'bulb', 'resistor', 'switch', 'capacitor'
    this.x = x;
    this.y = y;
    this.val = val;
    this.isClosed = true;
    this.current = 0.0;
    this.voltageDrop = 0.0;
    this.width = 96;
    this.height = 40;
    this.updateTerminals();
  }

  updateTerminals() {
    const hw = this.width / 2;
    this.t1 = { id: `${this.id}_t1`, comp: this, x: this.x - hw, y: this.y, name: 'T1' };
    this.t2 = { id: `${this.id}_t2`, comp: this, x: this.x + hw, y: this.y, name: 'T2' };
  }

  moveTo(x, y) {
    this.x = Math.round(x / 10) * 10;
    this.y = Math.round(y / 10) * 10;
    this.updateTerminals();
  }
}

class WireConn {
  constructor(t1, t2) {
    this.id = genId('wire');
    this.t1 = t1;
    this.t2 = t2;
    this.current = 0.0;
  }
}

function phetResistorColors(res) {
  const digitColors = ["#1e293b", "#78350f", "#dc2626", "#ea580c", "#eab308", "#16a34a", "#2563eb", "#7c3aed", "#64748b", "#f8fafc"];
  const val = Math.max(1, Math.round(res));
  if (val < 10) return [digitColors[0], digitColors[val], digitColors[0]];
  if (val < 100) return [digitColors[Math.floor(val / 10)], digitColors[val % 10], digitColors[0]];
  const s = String(val);
  return [digitColors[parseInt(s[0])], digitColors[parseInt(s[1])], digitColors[Math.min(9, s.length - 2)]];
}

function buildCircuitGraph() {
  const map = new Map();
  let count = 0;

  function merge(tA, tB) {
    const nA = map.get(tA);
    const nB = map.get(tB);
    if (!nA && !nB) {
      const nid = ++count;
      map.set(tA, nid);
      map.set(tB, nid);
    } else if (nA && !nB) {
      map.set(tB, nA);
    } else if (!nA && nB) {
      map.set(tA, nB);
    } else if (nA !== nB) {
      for (const [t, n] of map.entries()) {
        if (n === nB) map.set(t, nA);
      }
    }
  }

  for (const c of circuit.components) {
    if (c instanceof WireConn) {
      merge(c.t1, c.t2);
    }
  }

  for (let i = 0; i < circuit.components.length; i++) {
    const c1 = circuit.components[i];
    if (c1 instanceof WireConn) continue;
    for (let j = i + 1; j < circuit.components.length; j++) {
      const c2 = circuit.components[j];
      if (c2 instanceof WireConn) continue;
      [c1.t1, c1.t2].forEach(ta => {
        [c2.t1, c2.t2].forEach(tb => {
          if (Math.hypot(ta.x - tb.x, ta.y - tb.y) < 16) {
            merge(ta, tb);
          }
        });
      });
    }
  }

  for (const c of circuit.components) {
    if (!(c instanceof WireConn)) {
      if (!map.has(c.t1)) map.set(c.t1, ++count);
      if (!map.has(c.t2)) map.set(c.t2, ++count);
    }
  }

  const raw = Array.from(new Set(map.values())).filter(n => n > 0);
  const reindex = new Map();
  raw.forEach((n, idx) => reindex.set(n, idx + 1));
  for (const [t, n] of map.entries()) {
    map.set(t, reindex.get(n) || 0);
  }

  return { map, numNodes: raw.length };
}

function solveCircuit() {
  const { map, numNodes } = buildCircuitGraph();
  if (numNodes <= 1) {
    resetCircuitStats();
    return;
  }

  const vSources = circuit.components.filter(c => c.type === 'battery' && c.isClosed);
  const n = numNodes;
  const m = vSources.length;
  const size = n + m;

  const A = Array.from({ length: size }, () => Array(size).fill(0));
  const z = Array(size).fill(0);

  for (const c of circuit.components) {
    if (c instanceof WireConn) continue;
    if (!c.isClosed && c.type === 'switch') continue;

    let r = 1e-4;
    if (c.type === 'resistor' || c.type === 'bulb') {
      r = Math.max(1e-3, c.val);
    } else if (c.type === 'capacitor') {
      const gEq = (2.0 * c.val) / Math.max(1e-6, app.dt);
      r = 1.0 / gEq;
      const iEq = gEq * c.voltageDrop + c.current;
      const n1 = map.get(c.t1) || 0;
      const n2 = map.get(c.t2) || 0;
      if (n1 > 0) z[n1 - 1] -= iEq;
      if (n2 > 0) z[n2 - 1] += iEq;
    }

    if (c.type !== 'battery') {
      const g = 1.0 / r;
      const n1 = map.get(c.t1) || 0;
      const n2 = map.get(c.t2) || 0;
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
    const n1 = map.get(src.t1) || 0;
    const n2 = map.get(src.t2) || 0;
    if (n1 > 0) { A[n1 - 1][row] += 1; A[row][n1 - 1] += 1; }
    if (n2 > 0) { A[n2 - 1][row] -= 1; A[row][n2 - 1] -= 1; }
    z[row] = src.val;
  });

  const xSol = solveLinearMatrix(A, z);
  if (!xSol) {
    resetCircuitStats();
    return;
  }

  const nodeV = { 0: 0.0 };
  for (let i = 0; i < n; i++) nodeV[i + 1] = xSol[i];

  for (const c of circuit.components) {
    if (c instanceof WireConn) continue;
    const v1 = nodeV[map.get(c.t1)] || 0;
    const v2 = nodeV[map.get(c.t2)] || 0;
    c.voltageDrop = v1 - v2;

    if (c.type === 'resistor' || c.type === 'bulb') {
      c.current = c.voltageDrop / Math.max(1e-3, c.val);
    } else if (c.type === 'battery') {
      const sIdx = vSources.indexOf(c);
      c.current = sIdx >= 0 ? -xSol[n + sIdx] : 0;
    } else if (c.type === 'switch') {
      c.current = c.isClosed ? c.voltageDrop / 1e-4 : 0;
    } else if (c.type === 'capacitor') {
      const gEq = (2 * c.val) / Math.max(1e-6, app.dt);
      c.current = gEq * c.voltageDrop - (gEq * c.voltageDrop + c.current);
    }
  }

  for (const w of circuit.components) {
    if (w instanceof WireConn) {
      w.current = w.t1.comp.current;
    }
  }

  updateCircuitMeters(nodeV, map);
}

function resetCircuitStats() {
  circuit.components.forEach(c => { c.current = 0; c.voltageDrop = 0; });
  const vm = document.getElementById('voltmeter-readout');
  const am = document.getElementById('ammeter-readout');
  if (vm) vm.textContent = '0.00';
  if (am) am.textContent = '0.000';
}

function solveLinearMatrix(A, b) {
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

function updateCircuitMeters(nodeV, map) {
  if (circuit.voltmeterActive) {
    const tRed = findTerminalNear(circuit.probeRed.x, circuit.probeRed.y);
    const tBlack = findTerminalNear(circuit.probeBlack.x, circuit.probeBlack.y);
    const vRed = tRed ? (nodeV[map.get(tRed)] || 0) : 0;
    const vBlack = tBlack ? (nodeV[map.get(tBlack)] || 0) : 0;
    const diff = (tRed && tBlack) ? (vRed - vBlack) : 0.0;
    document.getElementById('voltmeter-readout').textContent = Math.abs(diff) < 0.001 ? "0.00" : diff.toFixed(2);
  }

  if (circuit.ammeterActive) {
    let measuredI = 0.0;
    for (const c of circuit.components) {
      if (c instanceof WireConn) {
        const d = distToLine(circuit.ammeterSensor.x, circuit.ammeterSensor.y, c.t1.x, c.t1.y, c.t2.x, c.t2.y);
        if (d < 22) { measuredI = Math.abs(c.current); break; }
      } else {
        if (Math.hypot(circuit.ammeterSensor.x - c.x, circuit.ammeterSensor.y - c.y) < 28) {
          measuredI = Math.abs(c.current); break;
        }
      }
    }
    document.getElementById('ammeter-readout').textContent = measuredI.toFixed(3);
  }
}

function findTerminalNear(x, y, maxD = 24) {
  let best = null, minD = maxD;
  for (const c of circuit.components) {
    if (c instanceof WireConn) continue;
    for (const t of [c.t1, c.t2]) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < minD) { minD = d; best = t; }
    }
  }
  return best;
}

function distToLine(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1)**2 + (y2 - y1)**2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = Math.max(0, Math.min(1, ((px - x1)*(x2 - x1) + (py - y1)*(y2 - y1)) / l2));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

// =========================================================================
// 3. PhET 2D Rendering Engine (Clean Vector Illustrations)
// =========================================================================

function renderCircuitLab(ctx, w, h) {
  // Clear with PhET Slate Blue Blueprint Board
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, w, h);

  // Subtle Grid Lines
  ctx.strokeStyle = '#264770';
  ctx.lineWidth = 1;
  const grid = 25;
  for (let x = 0; x < w; x += grid) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += grid) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Wires
  for (const c of circuit.components) {
    if (c instanceof WireConn) {
      drawPhetWire(ctx, c);
    }
  }

  // Draft Wire
  if (circuit.wireDraft) {
    ctx.strokeStyle = '#f39c12';
    ctx.lineWidth = 4;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(circuit.wireDraft.fromT.x, circuit.wireDraft.fromT.y);
    ctx.lineTo(circuit.wireDraft.mouseX, circuit.wireDraft.mouseY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Components
  for (const c of circuit.components) {
    if (!(c instanceof WireConn)) {
      drawPhetComponent(ctx, c);
    }
  }

  // Voltmeter flexible lead wires
  if (circuit.voltmeterActive) {
    drawFlexibleLead(ctx, 380, 70, circuit.probeBlack.x, circuit.probeBlack.y, '#1e293b');
    drawFlexibleLead(ctx, 440, 70, circuit.probeRed.x, circuit.probeRed.y, '#dc2626');
  }
}

function drawPhetWire(ctx, w) {
  ctx.strokeStyle = '#e67e22'; // PhET Copper/Orange Wire
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w.t1.x, w.t1.y);
  ctx.lineTo(w.t2.x, w.t2.y);
  ctx.stroke();

  // Outer border for clean 2D look
  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Drifting Blue Electron Particles (with '-' sign)
  if (Math.abs(w.current) > 0.001) {
    drawPhetElectronsOnWire(ctx, w.t1.x, w.t1.y, w.t2.x, w.t2.y, w.current);
  }
}

function drawPhetElectronsOnWire(ctx, x1, y1, x2, y2, current) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 6) return;

  const count = Math.max(2, Math.floor(len / 20));
  const dir = (app.flowMode === 'electrons' ? -1 : 1) * Math.sign(current);

  for (let i = 0; i < count; i++) {
    let t = (i / count + (circuit.electronOffset * dir) / len) % 1.0;
    if (t < 0) t += 1.0;
    const px = x1 + dx * t;
    const py = y1 + dy * t;

    // Blue circle with white '-'
    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (app.flowMode === 'electrons') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - 2, py - 0.5, 4, 1);
    }
  }
}

function drawPhetComponent(ctx, c) {
  ctx.save();
  ctx.translate(c.x, c.y);

  if (app.viewMode === 'real') {
    drawPhetReal(ctx, c);
  } else if (app.viewMode === 'xray') {
    drawPhetXRay(ctx, c);
  } else {
    drawPhetSchematic(ctx, c);
  }

  ctx.restore();

  // Black terminal node circles with silver centers
  for (const t of [c.t1, c.t2]) {
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(t.x, t.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 2D Realistic PhET Style Components
function drawPhetReal(ctx, c) {
  const hw = c.width / 2;
  const hh = c.height / 2;

  if (c.type === 'battery') {
    // PhET Battery: Dark body, copper/golden nipple on right, black on left
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.fillRect(-hw + 6, -hh + 5, c.width - 18, c.height - 10);
    ctx.strokeRect(-hw + 6, -hh + 5, c.width - 18, c.height - 10);

    // Copper Positive Terminal Nipple
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#b45309';
    ctx.fillRect(hw - 12, -7, 8, 14);
    ctx.strokeRect(hw - 12, -7, 8, 14);

    // PhET Yellow label band
    ctx.fillStyle = '#f39c12';
    ctx.fillRect(-18, -hh + 5, 24, c.height - 10);

    // Labels '+' and '-'
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('+', hw - 22, 4);
    ctx.fillText('-', -hw + 10, 4);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(`${c.val}V`, -14, 3);

  } else if (c.type === 'resistor') {
    // PhET Beige Ceramic Resistor Body
    ctx.fillStyle = '#e2d4b7';
    ctx.strokeStyle = '#b59d75';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-hw + 14, -hh + 8, c.width - 28, c.height - 16, 6);
    ctx.fill();
    ctx.stroke();

    // Standard 4 Colored Bands
    const bands = phetResistorColors(c.val);
    const bandX = [-14, -4, 6];
    bands.forEach((col, idx) => {
      ctx.fillStyle = col;
      ctx.fillRect(bandX[idx], -hh + 8, 5, c.height - 16);
    });

  } else if (c.type === 'bulb') {
    const power = Math.abs(c.current * c.voltageDrop);

    // Radiating PhET Yellow Ray Spikes
    if (power > 0.05) {
      const rayLen = Math.min(32, 10 + power * 4);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        const rx1 = Math.cos(a) * 18;
        const ry1 = -6 + Math.sin(a) * 18;
        const rx2 = Math.cos(a) * (18 + rayLen);
        const ry2 = -6 + Math.sin(a) * (18 + rayLen);
        ctx.beginPath();
        ctx.moveTo(rx1, ry1); ctx.lineTo(rx2, ry2);
        ctx.stroke();
      }
    }

    // Glass Bulb Dome
    ctx.fillStyle = power > 0.05 ? '#fef08a' : 'rgba(255, 255, 255, 0.4)';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -6, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Tungsten Filament Loop
    ctx.strokeStyle = power > 0.05 ? '#eab308' : '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-6, 2); ctx.lineTo(-3, -10); ctx.lineTo(3, -10); ctx.lineTo(6, 2);
    ctx.stroke();

    // Threaded Socket Collar
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-7, 10, 14, 8);
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(-7, 10, 14, 8);

  } else if (c.type === 'switch') {
    // Knife Switch Base
    ctx.fillStyle = '#334155';
    ctx.fillRect(-hw + 8, -4, c.width - 16, 8);

    // Metal contacts
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-14, -8, 6, 8);
    ctx.fillRect(10, -8, 6, 8);

    // Movable Blade
    ctx.strokeStyle = c.isClosed ? '#f59e0b' : '#ef4444';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-11, -6);
    ctx.lineTo(13, c.isClosed ? -6 : -24);
    ctx.stroke();

  } else if (c.type === 'capacitor') {
    // Two parallel plates
    ctx.fillStyle = '#dc2626'; // + Plate
    ctx.fillRect(-10, -18, 5, 36);
    ctx.fillStyle = '#2563eb'; // - Plate
    ctx.fillRect(5, -18, 5, 36);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-hw + 10, 0); ctx.lineTo(-10, 0);
    ctx.moveTo(10, 0); ctx.lineTo(hw - 10, 0);
    ctx.stroke();
  }
}

function drawPhetXRay(ctx, c) {
  // Clear chamber with Drude physics cutaway
  const hw = c.width / 2;
  const hh = c.height / 2;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-hw + 6, -hh + 6, c.width - 12, c.height - 12, 6);
  ctx.fill();
  ctx.stroke();

  if (c.type === 'resistor') {
    // Drude Lattice Ions (Phonon Scatterers)
    for (let i = -24; i <= 24; i += 12) {
      for (let j = -8; j <= 8; j += 8) {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(i, j, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (c.type === 'battery') {
    // Chemical uphill voltage pump
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-hw + 10, -hh + 8, 8, c.height - 16);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(hw - 18, -hh + 8, 8, c.height - 16);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('CHEMICAL PUMP ⚡', -36, 3);
  } else if (c.type === 'bulb') {
    drawPhetReal(ctx, c);
  } else if (c.type === 'capacitor') {
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(-10, -18, 4, 36);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(6, -18, 4, 36);
    // E-field arrows
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    for (let y = -12; y <= 12; y += 8) {
      ctx.beginPath();
      ctx.moveTo(-6, y); ctx.lineTo(6, y);
      ctx.stroke();
    }
  } else {
    drawPhetReal(ctx, c);
  }
}

function drawPhetSchematic(ctx, c) {
  const hw = c.width / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;

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
    ctx.moveTo(-6, -16); ctx.lineTo(-6, 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6, -9); ctx.lineTo(6, 9);
    ctx.stroke();
  } else if (c.type === 'bulb') {
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-9, -9); ctx.lineTo(9, 9);
    ctx.moveTo(-9, 9); ctx.lineTo(9, -9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-hw + 8, 0); ctx.lineTo(-14, 0);
    ctx.moveTo(14, 0); ctx.lineTo(hw - 8, 0);
    ctx.stroke();
  } else {
    drawPhetReal(ctx, c);
  }
}

function drawFlexibleLead(ctx, x1, y1, x2, y2, col) {
  ctx.strokeStyle = col;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  const midY = (y1 + y2) / 2 + 60;
  ctx.quadraticCurveTo(x1, midY, x2, y2);
  ctx.stroke();
}

// =========================================================================
// 4. 🧲 Faraday's Electromagnetics Lab (PhET 2D Engine)
// =========================================================================
const faraday = {
  apparatus: 'pickup',
  magnet: { x: 250, y: 240, isDragging: false },
  coil: { x: 520, y: 240, turns: 3, radius: 55 },
  showCompass: true,
  flux: 0.0,
  dFluxDt: 0.0,
  emf: 0.0
};

function updateFaraday(dt) {
  const dx = faraday.magnet.x - faraday.coil.x;
  const dy = faraday.magnet.y - faraday.coil.y;
  const dist = Math.hypot(dx, dy);

  const prev = faraday.flux;
  const B = 12000 / Math.max(900, dist ** 2.2);
  faraday.flux = B * (faraday.coil.radius / 55)**2 * (dx < 0 ? 1 : -1);
  faraday.dFluxDt = (faraday.flux - prev) / Math.max(1e-4, dt);
  faraday.emf = -faraday.coil.turns * faraday.dFluxDt * 0.025;

  document.getElementById('hud-stat-1').textContent = `EMF: ${faraday.emf.toFixed(2)} V`;
  document.getElementById('hud-stat-2').textContent = `Flux: ${(faraday.flux * 0.01).toFixed(3)} Wb`;
}

function renderFaradayLab(ctx, w, h) {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, w, h);

  // Compass Field Needles
  if (faraday.showCompass) {
    for (let x = 70; x < w; x += 70) {
      for (let y = 70; y < h; y += 70) {
        const ang = Math.atan2(y - faraday.magnet.y, x - faraday.magnet.x);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(0, -2, 10, 4);
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(-10, -2, 10, 4);
        ctx.restore();
      }
    }
  }

  // Solenoid Coil Loops
  const cx = faraday.coil.x, cy = faraday.coil.y;
  const r = faraday.coil.radius;
  const turns = faraday.coil.turns;

  for (let t = 0; t < turns; t++) {
    const ox = cx + (t - turns / 2) * 22;
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.ellipse(ox, cy, 14, r, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Galvanometer Meter with Deflecting Needle
  const gx = cx + 80, gy = cy - 110;
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(gx, gy, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Dial markings
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 9px sans-serif';
  ctx.fillText('-V', gx - 32, gy - 12);
  ctx.fillText('0', gx - 3, gy - 26);
  ctx.fillText('+V', gx + 22, gy - 12);

  // Pointer Needle
  const defl = Math.max(-1.0, Math.min(1.0, faraday.emf * 1.5)) * (Math.PI / 4);
  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(defl);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 10); ctx.lineTo(0, -34);
  ctx.stroke();
  ctx.restore();

  // Bulb connected to coil
  const bulbPower = Math.abs(faraday.emf);
  const bx = cx, by = cy + r + 45;
  if (bulbPower > 0.05) {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(a)*18, by + Math.sin(a)*18);
      ctx.lineTo(bx + Math.cos(a)*32, by + Math.sin(a)*32);
      ctx.stroke();
    }
  }
  ctx.fillStyle = bulbPower > 0.05 ? '#fef08a' : 'rgba(255,255,255,0.4)';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bx, by, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Draggable PhET Bar Magnet
  const mx = faraday.magnet.x, my = faraday.magnet.y;
  ctx.save();
  ctx.translate(mx, my);
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 8;
  // South (Blue)
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(-60, -22, 60, 44);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('S', -40, 7);
  // North (Red)
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(0, -22, 60, 44);
  ctx.fillStyle = '#fff';
  ctx.fillText('N', 24, 7);
  ctx.restore();
}

// =========================================================================
// 5. ⫛ Capacitor Lab (PhET 2D Engine)
// =========================================================================
const capacitor = {
  dist: 5.0,
  area: 200,
  kappa: 1.0,
  conn: 'battery',
  batteryV: 1.5,
  voltage: 1.5,
  charge: 0,
  energy: 0,
  dischargeI: 0
};

function updateCapacitor(dt) {
  const eps0 = 8.854e-12;
  const A = capacitor.area * 1e-6;
  const d = capacitor.dist * 1e-3;
  const C = (capacitor.kappa * eps0 * A) / d;

  if (capacitor.conn === 'battery') {
    capacitor.voltage = capacitor.batteryV;
    capacitor.charge = C * capacitor.voltage;
    capacitor.dischargeI = 0;
  } else if (capacitor.conn === 'bulb') {
    const R = 80.0;
    const decay = Math.exp(-dt / (R * C));
    capacitor.voltage *= decay;
    capacitor.charge = C * capacitor.voltage;
    capacitor.dischargeI = capacitor.voltage / R;
  }
  capacitor.energy = 0.5 * C * (capacitor.voltage ** 2);

  document.getElementById('hud-stat-1').textContent = `C: ${(C * 1e12).toFixed(2)} pF`;
  document.getElementById('hud-stat-2').textContent = `Energy: ${(capacitor.energy * 1e12).toFixed(2)} pJ`;
}

function renderCapacitorLab(ctx, w, h) {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const plateW = 180 * (capacitor.area / 200);
  const sep = capacitor.dist * 16;

  // Top Plate (+Q Red)
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(cx - plateW/2, cy - sep/2 - 12, plateW, 12);
  // Bottom Plate (-Q Blue)
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(cx - plateW/2, cy + sep/2, plateW, 12);

  // E-Field Arrows
  if (Math.abs(capacitor.voltage) > 0.05) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    for (let x = cx - plateW/2 + 15; x <= cx + plateW/2 - 15; x += 25) {
      ctx.beginPath();
      ctx.moveTo(x, cy - sep/2);
      ctx.lineTo(x, cy + sep/2);
      ctx.stroke();
    }
  }

  // Discharge Bulb
  if (capacitor.conn === 'bulb' && capacitor.dischargeI > 0.001) {
    const bx = cx + plateW/2 + 70, by = cy;
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(a)*16, by + Math.sin(a)*16);
      ctx.lineTo(bx + Math.cos(a)*30, by + Math.sin(a)*30);
      ctx.stroke();
    }
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(bx, by, 15, 0, Math.PI * 2);
    ctx.fill();
  }
}

// =========================================================================
// 6. 📏 Wire Resistance (PhET 2D Engine)
// =========================================================================
const resistivity = {
  rho: 1.0,
  length: 10.0,
  area: 5.0,
  voltage: 4.5,
  r: 2.0,
  i: 2.25
};

function updateResistivity(dt) {
  resistivity.r = (resistivity.rho * resistivity.length) / (resistivity.area * 0.01);
  resistivity.i = resistivity.voltage / Math.max(1e-3, resistivity.r);

  document.getElementById('hud-stat-1').textContent = `R: ${resistivity.r.toFixed(2)} Ω`;
  document.getElementById('hud-stat-2').textContent = `I: ${resistivity.i.toFixed(2)} A`;
}

function renderResistivityLab(ctx, w, h) {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const wireW = 160 + resistivity.length * 14;
  const wireH = 26 + resistivity.area * 7;

  // 2D Wire Segment
  ctx.fillStyle = '#d97706';
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cx - wireW/2, cy - wireH/2, wireW, wireH, 8);
  ctx.fill();
  ctx.stroke();

  // Impurities (Drude scattering centers)
  ctx.fillStyle = '#1e293b';
  const numIons = Math.floor(resistivity.rho * 12);
  for (let i = 0; i < numIons; i++) {
    const ix = cx - wireW/2 + 15 + ((i * 37) % (wireW - 30));
    const iy = cy - wireH/2 + 8 + ((i * 19) % (wireH - 16));
    ctx.beginPath();
    ctx.arc(ix, iy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Drifting Blue Electrons
  ctx.fillStyle = '#38bdf8';
  for (let i = 0; i < 20; i++) {
    const ex = cx - wireW/2 + 10 + ((i * 24 + app.simTime * resistivity.i * 60) % (wireW - 20));
    const ey = cy - wireH/2 + 6 + ((i * 13) % (wireH - 12));
    ctx.beginPath();
    ctx.arc(ex, ey, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// =========================================================================
// 7. 💡 Photoelectric Effect (PhET 2D Engine)
// =========================================================================
const photoelectric = {
  metal: 'sodium',
  wf: 2.28,
  wavelength: 400,
  intensity: 60,
  biasV: 0.0,
  ePhoton: 3.10,
  maxKE: 0.82,
  iPhoto: 4.2
};

function updatePhotoelectric(dt) {
  photoelectric.ePhoton = 1240.0 / Math.max(10, photoelectric.wavelength);
  photoelectric.maxKE = Math.max(0.0, photoelectric.ePhoton - photoelectric.wf);
  const stopV = photoelectric.maxKE;

  if (photoelectric.ePhoton > photoelectric.wf && photoelectric.biasV >= -stopV) {
    const sat = (photoelectric.intensity / 100) * 8.0;
    photoelectric.iPhoto = Math.max(0, sat * Math.min(1.0, (photoelectric.biasV + stopV) / Math.max(0.2, stopV)));
  } else {
    photoelectric.iPhoto = 0;
  }

  document.getElementById('hud-stat-1').textContent = `Photon: ${photoelectric.ePhoton.toFixed(2)} eV`;
  document.getElementById('hud-stat-2').textContent = `Photocurrent: ${photoelectric.iPhoto.toFixed(2)} µA`;
}

function renderPhotoelectricLab(ctx, w, h) {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, w, h);

  // Phototube Glass Envelope
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(260, 160, 300, 180, 20);
  ctx.fill();
  ctx.stroke();

  // Cathode & Anode Plates
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(290, 190, 12, 120);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(520, 190, 10, 120);

  // Light beam
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(200, 220); ctx.lineTo(290, 250);
  ctx.stroke();

  // Ejected photoelectrons flying
  if (photoelectric.iPhoto > 0) {
    ctx.fillStyle = '#38bdf8';
    for (let i = 0; i < 8; i++) {
      const ex = 300 + ((i * 28 + app.simTime * 120) % 220);
      const ey = 210 + (i * 12);
      ctx.beginPath();
      ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// =========================================================================
// 8. 🔬 Semiconductor & Diode Lab (PhET 2D Engine)
// =========================================================================
const semiconductor = {
  material: 'si',
  eg: 1.12,
  vk: 0.7,
  biasV: 0.0,
  current: 0.0,
  depletionW: 40
};

function updateSemiconductor(dt) {
  if (semiconductor.biasV < 0) {
    semiconductor.current = 0;
  } else if (semiconductor.biasV < semiconductor.vk) {
    semiconductor.current = Math.exp(semiconductor.biasV / 0.05) * 1e-4;
  } else {
    semiconductor.current = 1.0 + (semiconductor.biasV - semiconductor.vk) * 35.0;
  }
  const ratio = Math.max(0.1, 1.0 - semiconductor.biasV / (semiconductor.vk + 0.1));
  semiconductor.depletionW = Math.max(4, Math.min(70, 40 * Math.sqrt(ratio)));

  document.getElementById('hud-stat-1').textContent = `State: ${semiconductor.biasV >= semiconductor.vk ? 'Conduction' : 'Barrier'}`;
  document.getElementById('hud-stat-2').textContent = `Current: ${semiconductor.current.toFixed(2)} mA`;
}

function renderSemiconductorLab(ctx, w, h) {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2 - 20;
  // P-type
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(cx - 160, cy - 45, 160, 90);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('P-TYPE (Holes +)', cx - 140, cy + 5);

  // N-type
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(cx, cy - 45, 160, 90);
  ctx.fillStyle = '#fff';
  ctx.fillText('N-TYPE (Electrons -)', cx + 20, cy + 5);

  // Depletion zone
  const dw = semiconductor.depletionW;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(cx - dw, cy - 45, dw * 2, 90);

  // LED Photon Glow
  if (semiconductor.material === 'gaas' && semiconductor.current > 1.0) {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a)*10, cy - 60 + Math.sin(a)*10);
      ctx.lineTo(cx + Math.cos(a)*25, cy - 60 + Math.sin(a)*25);
      ctx.stroke();
    }
  }
}

// =========================================================================
// 9. 📡 Radio Waves Dipole Lab (PhET 2D Engine)
// =========================================================================
const radiowaves = {
  freq: 2.5,
  distance: 150,
  rxSignal: 0.0
};

function updateRadioWaves(dt) {
  const lambda = 300.0 / Math.max(0.1, radiowaves.freq);
  radiowaves.rxSignal = Math.sin(app.simTime * 6.28 * radiowaves.freq) * 1.5;

  document.getElementById('hud-stat-1').textContent = `λ: ${lambda.toFixed(1)} m`;
  document.getElementById('hud-stat-2').textContent = `Rx: ${Math.abs(radiowaves.rxSignal).toFixed(2)} mV`;
}

function renderRadioWavesLab(ctx, w, h) {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, w, h);

  const txX = 140, ty = h / 2;
  const rxX = txX + radiowaves.distance * 2;

  // Radiating Wavefront rings
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
  ctx.lineWidth = 2;
  for (let r = 20; r < 400; r += 50) {
    ctx.beginPath();
    ctx.arc(txX, ty, (r + app.simTime * 80) % 400, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Antenna Rods
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(txX, ty - 50); ctx.lineTo(txX, ty + 50);
  ctx.moveTo(rxX, ty - 50); ctx.lineTo(rxX, ty + 50);
  ctx.stroke();

  // Oscillating Electron
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(txX, ty + Math.sin(app.simTime * 6.28 * radiowaves.freq) * 35, 6, 0, Math.PI * 2);
  ctx.fill();

  // Receiver Electron
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.arc(rxX, ty + radiowaves.rxSignal * 20, 6, 0, Math.PI * 2);
  ctx.fill();
}

// =========================================================================
// 10. ⭐ INStep Micro-Stepping & Live Waveform Monitor
// =========================================================================
function stepINStep(dtOverride) {
  const dt = dtOverride || app.dt;
  app.stepCount++;
  app.simTime += dt;

  switch (app.activeLab) {
    case 'circuit':
      solveCircuit();
      const maxI = Math.max(0, ...circuit.components.map(c => Math.abs(c.current)));
      document.getElementById('instep-metric-1-lbl').textContent = 'Drift Velocity:';
      document.getElementById('instep-metric-1-val').textContent = `${(maxI * 26.4).toFixed(1)} µm/s`;
      document.getElementById('instep-metric-2-lbl').textContent = 'Branch Current:';
      document.getElementById('instep-metric-2-val').textContent = `${maxI.toFixed(2)} A`;
      app.waveformHistory.push({ v: circuit.components.find(c => c.type === 'battery')?.val || 0, i: maxI });
      break;

    case 'faraday':
      updateFaraday(dt);
      document.getElementById('instep-metric-1-lbl').textContent = 'Induced EMF:';
      document.getElementById('instep-metric-1-val').textContent = `${faraday.emf.toFixed(2)} V`;
      document.getElementById('instep-metric-2-lbl').textContent = 'Magnetic Flux:';
      document.getElementById('instep-metric-2-val').textContent = `${(faraday.flux * 0.01).toFixed(3)} Wb`;
      app.waveformHistory.push({ v: faraday.flux * 0.1, i: faraday.emf });
      break;

    case 'capacitor':
      updateCapacitor(dt);
      document.getElementById('instep-metric-1-lbl').textContent = 'Plate Voltage:';
      document.getElementById('instep-metric-1-val').textContent = `${capacitor.voltage.toFixed(2)} V`;
      document.getElementById('instep-metric-2-lbl').textContent = 'Stored Energy:';
      document.getElementById('instep-metric-2-val').textContent = `${(capacitor.energy * 1e12).toFixed(2)} pJ`;
      app.waveformHistory.push({ v: capacitor.voltage, i: capacitor.dischargeI * 10 });
      break;

    case 'resistivity':
      updateResistivity(dt);
      document.getElementById('instep-metric-1-lbl').textContent = 'Resistance (R):';
      document.getElementById('instep-metric-1-val').textContent = `${resistivity.r.toFixed(2)} Ω`;
      document.getElementById('instep-metric-2-lbl').textContent = 'Power (P):';
      document.getElementById('instep-metric-2-val').textContent = `${(resistivity.i**2 * resistivity.r).toFixed(2)} W`;
      app.waveformHistory.push({ v: resistivity.voltage, i: resistivity.i });
      break;

    case 'photoelectric':
      updatePhotoelectric(dt);
      document.getElementById('instep-metric-1-lbl').textContent = 'Photon Energy:';
      document.getElementById('instep-metric-1-val').textContent = `${photoelectric.ePhoton.toFixed(2)} eV`;
      document.getElementById('instep-metric-2-lbl').textContent = 'Photocurrent:';
      document.getElementById('instep-metric-2-val').textContent = `${photoelectric.iPhoto.toFixed(2)} µA`;
      app.waveformHistory.push({ v: photoelectric.ePhoton, i: photoelectric.iPhoto });
      break;

    case 'semiconductor':
      updateSemiconductor(dt);
      document.getElementById('instep-metric-1-lbl').textContent = 'Diode Current:';
      document.getElementById('instep-metric-1-val').textContent = `${semiconductor.current.toFixed(2)} mA`;
      document.getElementById('instep-metric-2-lbl').textContent = 'Depletion Width:';
      document.getElementById('instep-metric-2-val').textContent = `${(semiconductor.depletionW * 0.05).toFixed(2)} µm`;
      app.waveformHistory.push({ v: semiconductor.biasV, i: semiconductor.current });
      break;

    case 'radiowaves':
      updateRadioWaves(dt);
      document.getElementById('instep-metric-1-lbl').textContent = 'Rx Signal:';
      document.getElementById('instep-metric-1-val').textContent = `${Math.abs(radiowaves.rxSignal).toFixed(2)} mV`;
      document.getElementById('instep-metric-2-lbl').textContent = 'Frequency:';
      document.getElementById('instep-metric-2-val').textContent = `${radiowaves.freq.toFixed(1)} MHz`;
      app.waveformHistory.push({ v: Math.sin(app.simTime * 6.28 * radiowaves.freq), i: radiowaves.rxSignal });
      break;
  }

  document.getElementById('instep-step-count').textContent = `#${app.stepCount}`;
  document.getElementById('instep-time-val').textContent = `${(app.simTime * 1000).toFixed(1)} ms`;

  if (app.waveformHistory.length > 40) app.waveformHistory.shift();
  drawWaveform();
}

function drawWaveform() {
  const w = waveCanvas.width, h = waveCanvas.height;
  waveCtx.clearRect(0, 0, w, h);

  waveCtx.strokeStyle = '#334155';
  waveCtx.lineWidth = 1;
  waveCtx.beginPath();
  waveCtx.moveTo(0, h/2); waveCtx.lineTo(w, h/2);
  waveCtx.stroke();

  if (app.waveformHistory.length < 2) return;

  // Signal 1 (Blue)
  waveCtx.strokeStyle = '#38bdf8';
  waveCtx.lineWidth = 2;
  waveCtx.beginPath();
  app.waveformHistory.forEach((pt, i) => {
    const x = (i / (app.waveformHistory.length - 1)) * w;
    const y = Math.max(2, Math.min(h - 2, h/2 - pt.v * 3));
    if (i === 0) waveCtx.moveTo(x, y); else waveCtx.lineTo(x, y);
  });
  waveCtx.stroke();

  // Signal 2 (Orange)
  waveCtx.strokeStyle = '#fb923c';
  waveCtx.lineWidth = 2;
  waveCtx.beginPath();
  app.waveformHistory.forEach((pt, i) => {
    const x = (i / (app.waveformHistory.length - 1)) * w;
    const y = Math.max(2, Math.min(h - 2, h/2 - pt.i * 5));
    if (i === 0) waveCtx.moveTo(x, y); else waveCtx.lineTo(x, y);
  });
  waveCtx.stroke();
}

// =========================================================================
// 11. Laboratory Switcher & UI Event Binding
// =========================================================================
function switchLaboratory(key) {
  app.activeLab = key;

  document.querySelectorAll('.nav-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.lab === key);
  });

  // Toggle Toolbox sections
  const tbCircuit = document.getElementById('toolbox-circuit-items');
  if (tbCircuit) tbCircuit.style.display = key === 'circuit' ? 'block' : 'none';

  // Toggle Right control contents
  const titles = {
    circuit: 'Circuit Controls',
    faraday: 'Faraday Apparatus',
    capacitor: 'Capacitor Settings',
    resistivity: 'Wire Geometry',
    photoelectric: 'Phototube Settings',
    semiconductor: 'P-N Diode Settings',
    radiowaves: 'Antenna Settings'
  };
  document.getElementById('lab-controls-title').textContent = titles[key] || 'Controls';

  ['circuit', 'faraday', 'capacitor', 'resistivity', 'photoelectric', 'semiconductor', 'radiowaves'].forEach(k => {
    const el = document.getElementById(`ctrl-${k}`);
    if (el) el.style.display = k === key ? 'block' : 'none';
  });

  stepINStep(0.0);
}

function resizeCanvas() {
  const container = document.getElementById('phet-stage-container');
  if (!container) return;
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
}

function initListeners() {
  window.addEventListener('resize', resizeCanvas);

  // Tab Buttons
  document.querySelectorAll('.nav-tab').forEach(b => {
    b.addEventListener('click', () => switchLaboratory(b.dataset.lab));
  });

  // Reset All Button
  document.getElementById('btn-reset-all').addEventListener('click', () => {
    circuit.components = [];
    resetCircuitStats();
    loadPreset('simple_series');
  });

  // View Mode buttons
  document.querySelectorAll('#phet-control-panel .pill-btn[data-view]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#phet-control-panel .pill-btn[data-view]').forEach(p => p.classList.remove('active'));
      b.classList.add('active');
      app.viewMode = b.dataset.view;
    });
  });

  // Flow Mode buttons
  document.querySelectorAll('#phet-control-panel .pill-btn[data-flow]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#phet-control-panel .pill-btn[data-flow]').forEach(p => p.classList.remove('active'));
      b.classList.add('active');
      app.flowMode = b.dataset.flow;
    });
  });

  // INStep Run / Micro-Step
  const btnRun = document.getElementById('btn-mode-run');
  const btnInstep = document.getElementById('btn-mode-instep');
  const btnStep = document.getElementById('btn-instep-step');

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

  // Click on Toolbox buttons adds component directly to center of stage!
  document.querySelectorAll('.tool-card[data-comp]').forEach(card => {
    card.addEventListener('click', () => {
      const type = card.dataset.comp;
      const comp = new CircuitComp(type, canvas.width / 2 + (Math.random()-0.5)*80, canvas.height / 2 + (Math.random()-0.5)*80, type === 'battery' ? 9 : 10);
      circuit.components.push(comp);
      solveCircuit();
    });
  });

  // Presets
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.addEventListener('click', () => loadPreset(b.dataset.preset));
  });

  // Meters Toggles
  const vmUnit = document.getElementById('voltmeter-unit');
  const amUnit = document.getElementById('ammeter-unit');
  const pBlack = document.getElementById('probe-black');
  const pRed = document.getElementById('probe-red');

  document.getElementById('btn-toggle-voltmeter').addEventListener('click', () => {
    circuit.voltmeterActive = !circuit.voltmeterActive;
    vmUnit.style.display = circuit.voltmeterActive ? 'block' : 'none';
    pBlack.style.display = circuit.voltmeterActive ? 'flex' : 'none';
    pRed.style.display = circuit.voltmeterActive ? 'flex' : 'none';
    pBlack.style.left = `${circuit.probeBlack.x}px`;
    pBlack.style.top = `${circuit.probeBlack.y}px`;
    pRed.style.left = `${circuit.probeRed.x}px`;
    pRed.style.top = `${circuit.probeRed.y}px`;
  });

  document.getElementById('btn-toggle-ammeter').addEventListener('click', () => {
    circuit.ammeterActive = !circuit.ammeterActive;
    amUnit.style.display = circuit.ammeterActive ? 'block' : 'none';
  });

  document.getElementById('voltmeter-close').addEventListener('click', () => {
    circuit.voltmeterActive = false;
    vmUnit.style.display = 'none';
    pBlack.style.display = 'none';
    pRed.style.display = 'none';
  });

  document.getElementById('ammeter-close').addEventListener('click', () => {
    circuit.ammeterActive = false;
    amUnit.style.display = 'none';
  });

  makeDraggable(pBlack, (x, y) => { circuit.probeBlack.x = x; circuit.probeBlack.y = y; });
  makeDraggable(pRed, (x, y) => { circuit.probeRed.x = x; circuit.probeRed.y = y; });
  makeDraggable(vmUnit);
  makeDraggable(amUnit, (x, y) => {
    circuit.ammeterSensor.x = x + 65;
    circuit.ammeterSensor.y = y + 65;
  });

  setupStageInteractions();
  setupLabParameterListeners();
}

function makeDraggable(el, onMove) {
  let isDragging = false, offX = 0, offY = 0;
  el.addEventListener('mousedown', (e) => {
    isDragging = true;
    offX = e.clientX - el.offsetLeft;
    offY = e.clientY - el.offsetTop;
    e.stopPropagation();
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const nx = e.clientX - offX, ny = e.clientY - offY;
    el.style.left = `${nx}px`; el.style.top = `${ny}px`;
    if (onMove) onMove(nx, ny);
  });
  window.addEventListener('mouseup', () => { isDragging = false; });
}

function setupStageInteractions() {
  let dragComp = null;
  let dragOffset = { x: 0, y: 0 };

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (app.activeLab === 'circuit') {
      // Check terminal wire drafting
      for (const c of circuit.components) {
        if (c instanceof WireConn) continue;
        for (const t of [c.t1, c.t2]) {
          if (Math.hypot(t.x - x, t.y - y) < 14) {
            circuit.wireDraft = { fromT: t, mouseX: x, mouseY: y };
            return;
          }
        }
      }

      // Check component click/drag
      for (let i = circuit.components.length - 1; i >= 0; i--) {
        const c = circuit.components[i];
        if (c instanceof WireConn) continue;
        if (Math.abs(c.x - x) < c.width / 2 && Math.abs(c.y - y) < c.height / 2) {
          if (c.type === 'switch') {
            c.isClosed = !c.isClosed;
            solveCircuit();
            return;
          }
          dragComp = c;
          dragOffset.x = x - c.x;
          dragOffset.y = y - c.y;
          circuit.selectedComp = c;
          showTuner(c);
          return;
        }
      }
      hideTuner();
    } else if (app.activeLab === 'faraday') {
      if (Math.hypot(x - faraday.magnet.x, y - faraday.magnet.y) < 65) {
        faraday.magnet.isDragging = true;
      }
    }
  });

  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (app.activeLab === 'circuit') {
      if (circuit.wireDraft) {
        circuit.wireDraft.mouseX = x;
        circuit.wireDraft.mouseY = y;
      } else if (dragComp) {
        dragComp.moveTo(x - dragOffset.x, y - dragOffset.y);
        solveCircuit();
      }
    } else if (app.activeLab === 'faraday' && faraday.magnet.isDragging) {
      faraday.magnet.x = Math.max(40, Math.min(rect.width - 40, x));
      faraday.magnet.y = Math.max(40, Math.min(rect.height - 40, y));
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (circuit.wireDraft) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const target = findTerminalNear(x, y, 18);
      if (target && target !== circuit.wireDraft.fromT) {
        circuit.components.push(new WireConn(circuit.wireDraft.fromT, target));
        solveCircuit();
      }
      circuit.wireDraft = null;
    }
    dragComp = null;
    faraday.magnet.isDragging = false;
  });
}

function showTuner(c) {
  const p = document.getElementById('property-popup');
  p.style.display = 'block';
  p.style.left = `${Math.min(window.innerWidth - 380, c.x + 50)}px`;
  p.style.top = `${Math.max(60, c.y - 40)}px`;

  document.getElementById('popup-comp-title').textContent = `${c.type.toUpperCase()}`;
  const slider = document.getElementById('popup-slider');
  const readout = document.getElementById('popup-slider-val');

  slider.min = 1;
  slider.max = c.type === 'battery' ? 36 : 100;
  slider.value = c.val;
  readout.textContent = c.type === 'battery' ? `${c.val} V` : `${c.val} Ω`;

  slider.oninput = (e) => {
    c.val = parseFloat(e.target.value);
    readout.textContent = c.type === 'battery' ? `${c.val} V` : `${c.val} Ω`;
    solveCircuit();
  };

  document.getElementById('popup-delete').onclick = () => {
    circuit.components = circuit.components.filter(item => {
      if (item === c) return false;
      if (item instanceof WireConn && (item.t1.comp === c || item.t2.comp === c)) return false;
      return true;
    });
    hideTuner();
    solveCircuit();
  };
}

function hideTuner() {
  document.getElementById('property-popup').style.display = 'none';
}

function setupLabParameterListeners() {
  document.getElementById('popup-close').addEventListener('click', hideTuner);

  // Faraday parameters
  document.querySelectorAll('.pill-btn[data-turns]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill-btn[data-turns]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      faraday.coil.turns = parseInt(btn.dataset.turns);
    });
  });

  document.getElementById('faraday-coil-area').addEventListener('input', (e) => {
    faraday.coil.radius = parseFloat(e.target.value);
    document.getElementById('faraday-coil-area-val').textContent = `${faraday.coil.radius} mm`;
  });

  document.getElementById('faraday-show-compass').addEventListener('change', (e) => {
    faraday.showCompass = e.target.checked;
  });

  // Capacitor parameters
  document.getElementById('cap-plate-dist').addEventListener('input', (e) => {
    capacitor.dist = parseFloat(e.target.value);
    document.getElementById('cap-plate-dist-val').textContent = `${capacitor.dist.toFixed(1)} mm`;
  });

  document.getElementById('cap-plate-area').addEventListener('input', (e) => {
    capacitor.area = parseFloat(e.target.value);
    document.getElementById('cap-plate-area-val').textContent = `${capacitor.area} mm²`;
  });

  document.getElementById('cap-dielectric-select').addEventListener('change', (e) => {
    capacitor.kappa = parseFloat(e.target.value);
  });

  document.getElementById('cap-conn-battery').addEventListener('click', () => { capacitor.conn = 'battery'; setCapPill('cap-conn-battery'); });
  document.getElementById('cap-conn-open').addEventListener('click', () => { capacitor.conn = 'open'; setCapPill('cap-conn-open'); });
  document.getElementById('cap-conn-bulb').addEventListener('click', () => { capacitor.conn = 'bulb'; setCapPill('cap-conn-bulb'); });

  function setCapPill(id) {
    ['cap-conn-battery', 'cap-conn-open', 'cap-conn-bulb'].forEach(bid => {
      document.getElementById(bid).classList.toggle('active', bid === id);
    });
  }

  document.getElementById('cap-battery-v').addEventListener('input', (e) => {
    capacitor.batteryV = parseFloat(e.target.value);
    document.getElementById('cap-battery-v-val').textContent = `${capacitor.batteryV > 0 ? '+' : ''}${capacitor.batteryV.toFixed(1)} V`;
  });

  // Resistivity parameters
  document.getElementById('res-rho').addEventListener('input', (e) => {
    resistivity.rho = parseFloat(e.target.value);
    document.getElementById('res-rho-val').textContent = `${resistivity.rho.toFixed(2)} Ω·cm`;
  });

  document.getElementById('res-length').addEventListener('input', (e) => {
    resistivity.length = parseFloat(e.target.value);
    document.getElementById('res-length-val').textContent = `${resistivity.length.toFixed(1)} cm`;
  });

  document.getElementById('res-area').addEventListener('input', (e) => {
    resistivity.area = parseFloat(e.target.value);
    document.getElementById('res-area-val').textContent = `${resistivity.area.toFixed(1)} mm²`;
  });

  document.getElementById('res-voltage').addEventListener('input', (e) => {
    resistivity.voltage = parseFloat(e.target.value);
    document.getElementById('res-voltage-val').textContent = `${resistivity.voltage.toFixed(1)} V`;
  });

  // Photoelectric parameters
  document.getElementById('pe-target-metal').addEventListener('change', (e) => {
    photoelectric.wf = parseFloat(e.target.selectedOptions[0].dataset.wf);
  });

  document.getElementById('pe-wavelength').addEventListener('input', (e) => {
    photoelectric.wavelength = parseFloat(e.target.value);
    document.getElementById('pe-wavelength-val').textContent = `${photoelectric.wavelength} nm`;
    const marker = document.getElementById('pe-spectrum-cursor');
    if (marker) marker.style.left = `${((photoelectric.wavelength - 200) / 600) * 100}%`;
  });

  document.getElementById('pe-intensity').addEventListener('input', (e) => {
    photoelectric.intensity = parseFloat(e.target.value);
    document.getElementById('pe-intensity-val').textContent = `${photoelectric.intensity} %`;
  });

  document.getElementById('pe-voltage').addEventListener('input', (e) => {
    photoelectric.biasV = parseFloat(e.target.value);
    document.getElementById('pe-voltage-val').textContent = `${photoelectric.biasV.toFixed(2)} V`;
  });

  // Semiconductor parameters
  document.getElementById('semi-material-select').addEventListener('change', (e) => {
    semiconductor.material = e.target.value;
    if (e.target.value === 'si') { semiconductor.eg = 1.12; semiconductor.vk = 0.7; }
    else if (e.target.value === 'ge') { semiconductor.eg = 0.67; semiconductor.vk = 0.3; }
    else if (e.target.value === 'gaas') { semiconductor.eg = 1.42; semiconductor.vk = 1.8; }
  });

  document.getElementById('semi-bias').addEventListener('input', (e) => {
    semiconductor.biasV = parseFloat(e.target.value);
    document.getElementById('semi-bias-val').textContent = `${semiconductor.biasV.toFixed(2)} V`;
  });

  // Radio Waves parameters
  document.getElementById('radio-freq').addEventListener('input', (e) => {
    radiowaves.freq = parseFloat(e.target.value);
    document.getElementById('radio-freq-val').textContent = `${radiowaves.freq.toFixed(1)} MHz`;
  });

  document.getElementById('radio-distance').addEventListener('input', (e) => {
    radiowaves.distance = parseFloat(e.target.value);
    document.getElementById('radio-distance-val').textContent = `${radiowaves.distance} m`;
  });
}

function loadPreset(name) {
  circuit.components = [];
  switchLaboratory('circuit');

  const cx = canvas.width / 2 || 400;
  const cy = canvas.height / 2 || 250;

  if (name === 'simple_series') {
    const b = new CircuitComp('battery', cx - 140, cy, 9);
    const sw = new CircuitComp('switch', cx, cy - 80);
    const bulb = new CircuitComp('bulb', cx + 140, cy, 10);
    circuit.components.push(b, sw, bulb);
    circuit.components.push(new WireConn(b.t1, sw.t1));
    circuit.components.push(new WireConn(sw.t2, bulb.t1));
    circuit.components.push(new WireConn(bulb.t2, b.t2));
  } else if (name === 'parallel_branches') {
    const b = new CircuitComp('battery', cx - 180, cy, 9);
    const l1 = new CircuitComp('bulb', cx + 60, cy - 70, 10);
    const l2 = new CircuitComp('bulb', cx + 60, cy + 70, 10);
    circuit.components.push(b, l1, l2);
    circuit.components.push(new WireConn(b.t1, l1.t1));
    circuit.components.push(new WireConn(b.t1, l2.t1));
    circuit.components.push(new WireConn(l1.t2, b.t2));
    circuit.components.push(new WireConn(l2.t2, b.t2));
  } else if (name === 'rc_transient') {
    const b = new CircuitComp('battery', cx - 140, cy, 12);
    const r = new CircuitComp('resistor', cx, cy - 80, 15);
    const cap = new CircuitComp('capacitor', cx + 140, cy, 0.05);
    circuit.components.push(b, r, cap);
    circuit.components.push(new WireConn(b.t1, r.t1));
    circuit.components.push(new WireConn(r.t2, cap.t1));
    circuit.components.push(new WireConn(cap.t2, b.t2));
  } else if (name === 'short_circuit') {
    const b = new CircuitComp('battery', cx - 80, cy, 9);
    const sw = new CircuitComp('switch', cx + 80, cy);
    circuit.components.push(b, sw);
    circuit.components.push(new WireConn(b.t1, sw.t1));
    circuit.components.push(new WireConn(sw.t2, b.t2));
  }

  solveCircuit();
}

// =========================================================================
// 12. Main 60FPS Animation Loop
// =========================================================================
function mainLoop() {
  if (app.runMode === 'run') {
    stepINStep(0.001);
    circuit.electronOffset = (circuit.electronOffset + 1.2) % 1000;
  }

  const w = canvas.width, h = canvas.height;
  switch (app.activeLab) {
    case 'circuit':
      renderCircuitLab(ctx, w, h);
      break;
    case 'faraday':
      renderFaradayLab(ctx, w, h);
      break;
    case 'capacitor':
      renderCapacitorLab(ctx, w, h);
      break;
    case 'resistivity':
      renderResistivityLab(ctx, w, h);
      break;
    case 'photoelectric':
      renderPhotoelectricLab(ctx, w, h);
      break;
    case 'semiconductor':
      renderSemiconductorLab(ctx, w, h);
      break;
    case 'radiowaves':
      renderRadioWavesLab(ctx, w, h);
      break;
  }

  requestAnimationFrame(mainLoop);
}

window.addEventListener('DOMContentLoaded', () => {
  resizeCanvas();
  initListeners();
  loadPreset('simple_series');
  requestAnimationFrame(mainLoop);
});
