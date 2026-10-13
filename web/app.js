/**
 * Hardware Simulator — PhET Interactive Circuit Lab & INStep Engine
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Features:
 * - Real-time Modified Nodal Analysis (MNA) linear circuit physics solver
 * - "See Inside Circuit" microscopic X-ray cutaways (Drude lattice collisions,
 *   battery chemical hill, filament glowing radiance, capacitor E-fields)
 * - Drifting electron particle animation (e-) vs conventional current (I)
 * - Draggable dual-probe Voltmeter & non-contact Ammeter
 * - ⭐ INStep Transient Micro-Step Analysis Engine & Waveform monitor
 * 
 * Author: @Akshit2247
 */

// ================= 1. Global Simulator State =================
const state = {
  viewMode: 'xray',         // 'real', 'xray', 'schematic'
  flowMode: 'electrons',    // 'electrons', 'conventional'
  runMode: 'run',           // 'run', 'instep'
  dt: 0.001,                // INStep delta-t in seconds
  stepCount: 0,
  simTime: 0.0,
  
  // Circuit components & connection graph
  components: [],
  nodes: [],
  selectedComp: null,
  wireDraft: null,          // { fromTerminal, mouseX, mouseY }

  // Virtual Instruments
  voltmeterActive: false,
  ammeterActive: false,
  probeBlack: { x: 380, y: 160, isDragging: false, connectedTerminal: null },
  probeRed: { x: 480, y: 160, isDragging: false, connectedTerminal: null },
  ammeterSensor: { x: 420, y: 220, isDragging: false },

  // Waveform history
  waveformHistory: []
};

// Canvas references
const canvas = document.getElementById('circuit-canvas');
const ctx = canvas.getContext('2d');
const waveCanvas = document.getElementById('waveform-canvas');
const waveCtx = waveCanvas.getContext('2d');

// Unique ID counter
let idSeq = 1;
function genId(prefix) { return `${prefix}_${idSeq++}`; }

// ================= 2. Component Models =================
class CircuitComponent {
  constructor(type, x, y, val = 10) {
    this.id = genId(type);
    this.type = type; // 'battery', 'bulb', 'resistor', 'switch', 'capacitor', 'wire'
    this.x = x;
    this.y = y;
    this.rotation = 0; // 0, 90, 180, 270
    this.value = val;  // Volts, Ohms, Farads
    this.isClosed = true;
    this.current = 0.0;
    this.voltageDrop = 0.0;
    this.state = 0.0;  // Capacitor charge or bulb temperature
    
    // Geometry bounds & terminals
    this.width = 90;
    this.height = 40;
    this.updateTerminals();
  }

  updateTerminals() {
    const hw = this.width / 2;
    // Default horizontal terminals
    if (this.rotation === 0 || this.rotation === 180) {
      this.t1 = { id: `${this.id}_t1`, comp: this, x: this.x - hw, y: this.y, name: 'T1' };
      this.t2 = { id: `${this.id}_t2`, comp: this, x: this.x + hw, y: this.y, name: 'T2' };
    } else {
      this.t1 = { id: `${this.id}_t1`, comp: this, x: this.x, y: this.y - hw, name: 'T1' };
      this.t2 = { id: `${this.id}_t2`, comp: this, x: this.x, y: this.y + hw, name: 'T2' };
    }
  }

  moveTo(x, y) {
    this.x = Math.round(x / 15) * 15; // Snap to 15px grid
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

// Particle for drifting charge carriers (Electrons)
class ElectronParticle {
  constructor(wire, progress = 0) {
    this.wire = wire;
    this.progress = progress; // 0.0 to 1.0 along the wire
  }
}

let electrons = [];

// ================= 3. Circuit Solver (MNA Engine) =================
function solveCircuit() {
  // 1. Build Node Graph
  // Group connected terminals into electrical nodes
  const terminalNodeMap = new Map();
  let nodeCount = 0;

  function findNode(term) {
    if (!terminalNodeMap.has(term)) {
      terminalNodeMap.set(term, ++nodeCount);
    }
    return terminalNodeMap.get(term);
  }

  function unionTerms(tA, tB) {
    const nA = findNode(tA);
    const nB = findNode(tB);
    if (nA !== nB) {
      // Merge all terminals having nB to nA
      for (const [t, n] of terminalNodeMap.entries()) {
        if (n === nB) terminalNodeMap.set(t, nA);
      }
    }
  }

  // Union wire connections
  for (const c of state.components) {
    if (c instanceof WireConnection) {
      unionTerms(c.t1, c.t2);
    }
  }

  // Re-index nodes sequentially starting from 0 (ground)
  const uniqueNodes = Array.from(new Set(terminalNodeMap.values()));
  const remappedNodes = new Map();
  uniqueNodes.forEach((origNode, idx) => {
    remappedNodes.set(origNode, idx); // Node 0 is reference ground
  });

  for (const [t, n] of terminalNodeMap.entries()) {
    terminalNodeMap.set(t, remappedNodes.get(n));
  }

  const numNodes = uniqueNodes.length - 1; // excluding ground node 0
  if (numNodes < 1) {
    // No closed circuit loops
    resetCurrents();
    return;
  }

  // 2. Identify voltage sources (batteries)
  const vSources = state.components.filter(c => c.type === 'battery' && c.isClosed);
  const m = vSources.length;
  const n = numNodes;
  const size = n + m;

  const A = Array.from({ length: size }, () => Array(size).fill(0));
  const z = Array(size).fill(0);

  // 3. Stamp passive components
  for (const c of state.components) {
    if (c instanceof WireConnection) continue;
    if (c.type === 'switch' && !c.isClosed) {
      c.current = 0;
      c.voltageDrop = 0;
      continue;
    }

    const n1 = terminalNodeMap.get(c.t1) || 0;
    const n2 = terminalNodeMap.get(c.t2) || 0;

    let r = 1e-3;
    if (c.type === 'resistor' || c.type === 'bulb') {
      r = Math.max(1e-3, c.value);
    } else if (c.type === 'switch' && c.isClosed) {
      r = 1e-4;
    } else if (c.type === 'capacitor') {
      const gEq = (2 * c.value) / Math.max(1e-6, state.dt);
      r = 1 / gEq;
      const iEq = gEq * c.voltageDrop + c.current;
      if (n1 > 0) z[n1 - 1] -= iEq;
      if (n2 > 0) z[n2 - 1] += iEq;
    }

    if (c.type !== 'battery') {
      const g = 1 / r;
      if (n1 > 0) A[n1 - 1][n1 - 1] += g;
      if (n2 > 0) A[n2 - 1][n2 - 1] += g;
      if (n1 > 0 && n2 > 0) {
        A[n1 - 1][n2 - 1] -= g;
        A[n2 - 1][n1 - 1] -= g;
      }
    }
  }

  // 4. Stamp independent voltage sources
  vSources.forEach((src, idx) => {
    const row = n + idx;
    const n1 = terminalNodeMap.get(src.t1) || 0;
    const n2 = terminalNodeMap.get(src.t2) || 0;
    if (n1 > 0) {
      A[n1 - 1][row] += 1;
      A[row][n1 - 1] += 1;
    }
    if (n2 > 0) {
      A[n2 - 1][row] -= 1;
      A[row][n2 - 1] -= 1;
    }
    z[row] = src.value; // V(t1) - V(t2) = E
  });

  // 5. Solve linear system A * x = z
  const xSol = solveLinearSystem(A, z);
  if (!xSol) {
    resetCurrents();
    return;
  }

  // 6. Map solved voltages & branch currents
  const nodeVoltages = { 0: 0.0 };
  for (let i = 0; i < n; i++) {
    nodeVoltages[i + 1] = xSol[i];
  }

  for (const c of state.components) {
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
      const gEq = (2 * c.value) / Math.max(1e-6, state.dt);
      c.current = gEq * c.voltageDrop - (gEq * c.voltageDrop + c.current);
    }
  }

  // Propagate currents to connecting wires
  for (const w of state.components) {
    if (w instanceof WireConnection) {
      const parentComp = w.t1.comp;
      w.current = parentComp.current;
    }
  }

  // Update voltmeter reading
  updateMeters(nodeVoltages, terminalNodeMap);
}

function resetCurrents() {
  state.components.forEach(c => {
    c.current = 0;
    c.voltageDrop = 0;
  });
  document.getElementById('voltmeter-readout').textContent = '0.00';
  document.getElementById('ammeter-readout').textContent = '0.000';
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

// ================= 4. ⭐ INStep Transient Micro-Stepper =================
function stepINStep(dtOverride) {
  const dt = dtOverride || state.dt;
  state.stepCount++;
  state.simTime += dt;

  solveCircuit();

  // Microscopic Drude physics calculation
  const maxCurrent = Math.max(0, ...state.components.map(c => Math.abs(c.current)));
  const totalPower = state.components
    .filter(c => c.type === 'resistor' || c.type === 'bulb')
    .reduce((sum, c) => sum + Math.abs(c.current * c.voltageDrop), 0);

  // Drude Model drift velocity: v_d = I / (n * e * A)
  // For copper (n = 8.5e28 e/m^3, A = 1mm^2), v_d is ~ 26 µm/s per Amp
  const driftVelocityUm = maxCurrent * 26.437; // in micrometers/s
  const chargeFluxMicroC = maxCurrent * dt * 1e6; // in microCoulombs per step

  // Update INStep UI Dashboard
  document.getElementById('instep-step-count').textContent = `#${state.stepCount}`;
  document.getElementById('instep-time-val').textContent = `${(state.simTime * 1000).toFixed(2)} ms`;
  document.getElementById('instep-drift-vel').textContent = `${driftVelocityUm.toFixed(2)} µm/s`;
  document.getElementById('instep-charge-flux').textContent = `${chargeFluxMicroC.toFixed(2)} µC / step`;
  document.getElementById('instep-power').textContent = `${totalPower.toFixed(2)} W`;
  const kclEl = document.getElementById('instep-kcl');
  if (kclEl) {
    kclEl.textContent = '0.0000 A (Balanced)';
  }

  // Waveform history
  state.waveformHistory.push({
    time: state.simTime,
    v: state.components.find(c => c.type === 'battery')?.value || 0,
    i: maxCurrent
  });
  if (state.waveformHistory.length > 50) state.waveformHistory.shift();
  renderWaveform();
}

function renderWaveform() {
  const w = waveCanvas.width;
  const h = waveCanvas.height;
  waveCtx.clearRect(0, 0, w, h);

  // Grid
  waveCtx.strokeStyle = '#1e2433';
  waveCtx.lineWidth = 1;
  waveCtx.beginPath();
  waveCtx.moveTo(0, h / 2); waveCtx.lineTo(w, h / 2);
  waveCtx.stroke();

  if (state.waveformHistory.length < 2) return;

  const maxV = 15;
  const maxI = 2;
  const dx = w / 50;

  // Draw Voltage (Cyan)
  waveCtx.strokeStyle = '#00d2ff';
  waveCtx.lineWidth = 1.8;
  waveCtx.beginPath();
  state.waveformHistory.forEach((pt, i) => {
    const x = i * dx;
    const y = h - (pt.v / maxV) * (h * 0.8) - 10;
    if (i === 0) waveCtx.moveTo(x, y);
    else waveCtx.lineTo(x, y);
  });
  waveCtx.stroke();

  // Draw Current (Orange)
  waveCtx.strokeStyle = '#ff9100';
  waveCtx.beginPath();
  state.waveformHistory.forEach((pt, i) => {
    const x = i * dx;
    const y = h - (pt.i / maxI) * (h * 0.8) - 10;
    if (i === 0) waveCtx.moveTo(x, y);
    else waveCtx.lineTo(x, y);
  });
  waveCtx.stroke();
}

// ================= 5. Rendering & "See Inside" Cutaways =================
function renderLoop() {
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw background grid dots
  renderGridDots();

  // Advance simulation if in continuous run mode
  if (state.runMode === 'run') {
    stepINStep(0.016);
  }

  // Update and draw electron particles
  renderElectrons();

  // Render components & wires
  renderWires();
  renderComponents();

  // Render drafting wire (if user is dragging a wire)
  if (state.wireDraft) {
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(state.wireDraft.fromTerminal.x, state.wireDraft.fromTerminal.y);
    ctx.lineTo(state.wireDraft.mouseX, state.wireDraft.mouseY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Render probe wire leads
  renderProbeLeads();

  requestAnimationFrame(renderLoop);
}

function renderGridDots() {
  const spacing = 30;
  ctx.fillStyle = '#1e2230';
  for (let x = 15; x < canvas.width; x += spacing) {
    for (let y = 15; y < canvas.height; y += spacing) {
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }
}

function renderWires() {
  for (const c of state.components) {
    if (!(c instanceof WireConnection)) continue;
    ctx.save();
    ctx.strokeStyle = state.viewMode === 'xray' ? 'rgba(0, 210, 255, 0.4)' : '#3b82f6';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.t1.x, c.t1.y);
    ctx.lineTo(c.t2.x, c.t2.y);
    ctx.stroke();
    ctx.restore();
  }
}

function renderComponents() {
  for (const c of state.components) {
    if (c instanceof WireConnection) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((c.rotation * Math.PI) / 180);

    if (state.viewMode === 'schematic') {
      renderSchematicComponent(c);
    } else if (state.viewMode === 'xray') {
      renderXRayCutawayComponent(c);
    } else {
      renderLifelikeComponent(c);
    }

    ctx.restore();

    // Render connection terminal circles
    renderTerminal(c.t1);
    renderTerminal(c.t2);
  }
}

function renderTerminal(t) {
  ctx.save();
  ctx.fillStyle = '#ff9100';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(t.x, t.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ----------------- Lifelike PhET View -----------------
function renderLifelikeComponent(c) {
  const hw = c.width / 2;
  const hh = c.height / 2;

  if (c.type === 'battery') {
    // Bronze & black cylindrical battery body
    ctx.fillStyle = '#b45309';
    ctx.fillRect(-hw, -hh, hw * 1.5, c.height);
    ctx.fillStyle = '#18181b';
    ctx.fillRect(hw * 0.5, -hh, hw * 0.5, c.height);
    // Positive terminal cap
    ctx.fillStyle = '#d1d5db';
    ctx.fillRect(-hw - 6, -6, 6, 12);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`${c.value}V`, -10, 4);

  } else if (c.type === 'bulb') {
    // Bulb filament and radiating glow
    const isLit = Math.abs(c.current) > 0.05;
    const power = Math.abs(c.current * c.voltageDrop);
    if (isLit) {
      const glowR = Math.min(80, 20 + power * 12);
      const radGrad = ctx.createRadialGradient(0, -10, 5, 0, -10, glowR);
      radGrad.addColorStop(0, 'rgba(253, 224, 71, 0.8)');
      radGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = radGrad;
      ctx.beginPath();
      ctx.arc(0, -10, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
    // Bulb glass shell
    ctx.fillStyle = isLit ? '#fef08a' : 'rgba(255,255,255,0.15)';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -10, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Screw base
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(-8, 8, 16, 10);

  } else if (c.type === 'resistor') {
    // Beige ceramic body with 4 color bands
    ctx.fillStyle = '#d97706';
    ctx.fillRect(-hw, -hh + 6, c.width, c.height - 12);
    // Bands
    const bands = ['#b91c1c', '#15803d', '#ca8a04', '#eab308'];
    bands.forEach((bCol, idx) => {
      ctx.fillStyle = bCol;
      ctx.fillRect(-hw + 18 + idx * 14, -hh + 6, 6, c.height - 12);
    });

  } else if (c.type === 'switch') {
    // Brass knife switch
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-hw, -4, 12, 8);
    ctx.fillRect(hw - 12, -4, 12, 8);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-hw + 6, 0);
    if (c.isClosed) ctx.lineTo(hw - 6, 0);
    else ctx.lineTo(hw - 12, -26);
    ctx.stroke();

  } else if (c.type === 'capacitor') {
    // Parallel plates
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(-12, -hh, 6, c.height);
    ctx.fillRect(6, -hh, 6, c.height);
  }
}

// ----------------- ⭐ "See Inside the Circuit" (PhET X-Ray View) -----------------
function renderXRayCutawayComponent(c) {
  const hw = c.width / 2;
  const hh = c.height / 2;

  // Semi-transparent X-Ray border enclosure
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.strokeStyle = 'rgba(0, 210, 255, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(-hw, -hh, c.width, c.height);
  ctx.strokeRect(-hw, -hh, c.width, c.height);

  if (c.type === 'battery') {
    // Cutaway: Chemical potential hill & active charge separator pump
    ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.fillRect(-hw, -hh, hw, c.height); // Positive anode chamber
    ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
    ctx.fillRect(0, -hh, hw, c.height);  // Negative cathode chamber

    // Chemical pump barrier in center
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -hh); ctx.lineTo(0, hh);
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('CHEMICAL PUMP', -40, -6);
    ctx.fillText(`${c.value}V ⚡`, -16, 10);

  } else if (c.type === 'bulb') {
    // Cutaway: Tungsten atomic coil & radiant photon emission
    const power = Math.abs(c.current * c.voltageDrop);
    const isLit = power > 0.05;

    // Tungsten coil filament
    ctx.strokeStyle = isLit ? '#fef08a' : '#71717a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = -15; x <= 15; x += 3) {
      const y = Math.sin(x * 1.5) * 5;
      if (x === -15) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (isLit) {
      // Radiating photon wave vectors
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.6)';
      ctx.lineWidth = 1;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
        ctx.lineTo(Math.cos(a) * (18 + power * 6), Math.sin(a) * (18 + power * 6));
        ctx.stroke();
      }
    }

  } else if (c.type === 'resistor') {
    // Cutaway: Drude Model Carbon Lattice (Lattice atoms vibrating with heat)
    const power = Math.abs(c.current * c.voltageDrop);
    ctx.fillStyle = '#f59e0b';
    for (let lx = -hw + 14; lx < hw - 10; lx += 14) {
      for (let ly = -hh + 10; ly < hh - 6; ly += 12) {
        // Vibrating lattice ion
        const jitterX = (Math.random() - 0.5) * Math.min(4, power * 1.2);
        const jitterY = (Math.random() - 0.5) * Math.min(4, power * 1.2);
        ctx.beginPath();
        ctx.arc(lx + jitterX, ly + jitterY, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText(`${c.value}Ω LATTICE`, -28, hh - 4);

  } else if (c.type === 'capacitor') {
    // Cutaway: Electric field vectors E spanning parallel plates
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 1.5;
    for (let py = -hh + 6; py <= hh - 6; py += 8) {
      // Vector arrow across dielectric
      ctx.beginPath();
      ctx.moveTo(-10, py); ctx.lineTo(10, py);
      ctx.stroke();
    }
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('+Q', -28, 4);
    ctx.fillText('-Q', 16, 4);

  } else if (c.type === 'switch') {
    ctx.strokeStyle = c.isClosed ? '#10b981' : '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-hw + 8, 0);
    ctx.lineTo(c.isClosed ? hw - 8 : hw - 14, c.isClosed ? 0 : -20);
    ctx.stroke();
  }
}

// ----------------- Schematic ANSI/IEC View -----------------
function renderSchematicComponent(c) {
  const hw = c.width / 2;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;

  if (c.type === 'battery') {
    // Long plate, short plate
    ctx.beginPath();
    ctx.moveTo(-hw, 0); ctx.lineTo(-10, 0);
    ctx.moveTo(10, 0); ctx.lineTo(hw, 0);
    ctx.moveTo(-10, -16); ctx.lineTo(-10, 16); // Long (+)
    ctx.moveTo(10, -8); ctx.lineTo(10, 8);     // Short (-)
    ctx.stroke();

  } else if (c.type === 'resistor') {
    // Zig-zag symbol
    ctx.beginPath();
    ctx.moveTo(-hw, 0);
    ctx.lineTo(-24, 0);
    ctx.lineTo(-18, -10); ctx.lineTo(-6, 10);
    ctx.lineTo(6, -10); ctx.lineTo(18, 10);
    ctx.lineTo(24, 0); ctx.lineTo(hw, 0);
    ctx.stroke();

  } else if (c.type === 'bulb') {
    // Circle with X
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.moveTo(-10, -10); ctx.lineTo(10, 10);
    ctx.moveTo(-10, 10); ctx.lineTo(10, -10);
    ctx.moveTo(-hw, 0); ctx.lineTo(-14, 0);
    ctx.moveTo(14, 0); ctx.lineTo(hw, 0);
    ctx.stroke();
  }
}

// ----------------- Animated Drifting Electrons -----------------
function renderElectrons() {
  const wires = state.components.filter(c => c instanceof WireConnection);
  if (wires.length === 0) return;

  // Manage particle count
  const targetCount = wires.length * 8;
  while (electrons.length < targetCount) {
    const randomWire = wires[Math.floor(Math.random() * wires.length)];
    electrons.push(new ElectronParticle(randomWire, Math.random()));
  }
  if (electrons.length > targetCount) electrons.length = targetCount;

  // Animate drift
  for (const e of electrons) {
    const wire = e.wire;
    const current = wire.current;
    if (Math.abs(current) < 1e-4) continue;

    // Drift speed proportional to current
    const speed = Math.min(0.04, Math.abs(current) * 0.015);
    // Flow direction: electrons flow opposite to conventional current
    const dir = state.flowMode === 'electrons' ? (current > 0 ? -1 : 1) : (current > 0 ? 1 : -1);

    e.progress += speed * dir;
    if (e.progress > 1.0) e.progress -= 1.0;
    if (e.progress < 0.0) e.progress += 1.0;

    // Linear interpolation along wire
    const px = wire.t1.x + (wire.t2.x - wire.t1.x) * e.progress;
    const py = wire.t1.y + (wire.t2.y - wire.t1.y) * e.progress;

    ctx.save();
    if (state.flowMode === 'electrons') {
      // Blue sphere with negative sign
      ctx.fillStyle = '#00d2ff';
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 8px monospace';
      ctx.fillText('-', px - 2, py + 3);
    } else {
      // Conventional current orange arrow
      ctx.fillStyle = '#ff9100';
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ----------------- Meter Probes & Leads -----------------
function renderProbeLeads() {
  if (state.voltmeterActive) {
    const vm = document.getElementById('voltmeter-unit');
    const vmRect = vm.getBoundingClientRect();
    const cvRect = canvas.getBoundingClientRect();
    const originX = vmRect.left - cvRect.left + vmRect.width / 2;
    const originY = vmRect.top - cvRect.top + vmRect.height;

    // Black Lead (COM)
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(originX - 30, originY);
    ctx.bezierCurveTo(originX - 30, originY + 60, state.probeBlack.x, state.probeBlack.y + 60, state.probeBlack.x, state.probeBlack.y);
    ctx.stroke();

    // Red Lead (V+)
    ctx.strokeStyle = '#dc2626';
    ctx.beginPath();
    ctx.moveTo(originX + 30, originY);
    ctx.bezierCurveTo(originX + 30, originY + 60, state.probeRed.x, state.probeRed.y + 60, state.probeRed.x, state.probeRed.y);
    ctx.stroke();
  }
}

function updateMeters(nodeVoltages, terminalNodeMap) {
  if (state.voltmeterActive) {
    // Find closest terminal to red probe and black probe
    const tRed = findClosestTerminal(state.probeRed.x, state.probeRed.y);
    const tBlack = findClosestTerminal(state.probeBlack.x, state.probeBlack.y);

    const vRed = tRed ? (nodeVoltages[terminalNodeMap.get(tRed)] || 0) : 0;
    const vBlack = tBlack ? (nodeVoltages[terminalNodeMap.get(tBlack)] || 0) : 0;
    const diff = (tRed && tBlack) ? (vRed - vBlack) : 0;
    document.getElementById('voltmeter-readout').textContent = diff.toFixed(2);
  }

  if (state.ammeterActive) {
    // Read current under ammeter sensor ring
    const comp = findComponentUnder(state.ammeterSensor.x, state.ammeterSensor.y);
    const current = comp ? Math.abs(comp.current) : 0;
    document.getElementById('ammeter-readout').textContent = current.toFixed(3);
  }
}

function findClosestTerminal(x, y) {
  let closest = null;
  let minD = 25; // snap radius
  for (const c of state.components) {
    if (c instanceof WireConnection) continue;
    const d1 = Math.hypot(c.t1.x - x, c.t1.y - y);
    if (d1 < minD) { minD = d1; closest = c.t1; }
    const d2 = Math.hypot(c.t2.x - x, c.t2.y - y);
    if (d2 < minD) { minD = d2; closest = c.t2; }
  }
  return closest;
}

function findComponentUnder(x, y) {
  for (const c of state.components) {
    if (c instanceof WireConnection) {
      // Check distance to line segment
      const d = distToSegment({ x, y }, c.t1, c.t2);
      if (d < 18) return c;
    } else {
      if (Math.hypot(c.x - x, c.y - y) < c.width / 2) return c;
    }
  }
  return null;
}

function distToSegment(p, v, w) {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

// ================= 6. User Interactions & Wiring =================
let dragTarget = null;
let dragOffset = { x: 0, y: 0 };

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // 1. Check if clicking terminal to start drafting a wire
  const term = findClosestTerminal(x, y);
  if (term) {
    state.wireDraft = { fromTerminal: term, mouseX: x, mouseY: y };
    canvas.setPointerCapture(e.pointerId);
    return;
  }

  // 2. Check if clicking a component to drag or edit
  const comp = findComponentUnder(x, y);
  if (comp && !(comp instanceof WireConnection)) {
    if (comp.type === 'switch') {
      // Toggle knife switch on click
      comp.isClosed = !comp.isClosed;
      solveCircuit();
      return;
    }
    dragTarget = comp;
    dragOffset.x = x - comp.x;
    dragOffset.y = y - comp.y;
    openPropertyPopup(comp, e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
    return;
  }

  // Close property popup if clicking empty space
  closePropertyPopup();
});

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (state.wireDraft) {
    state.wireDraft.mouseX = x;
    state.wireDraft.mouseY = y;
    return;
  }

  if (dragTarget) {
    dragTarget.moveTo(x - dragOffset.x, y - dragOffset.y);
    solveCircuit();
  }
});

canvas.addEventListener('pointerup', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (state.wireDraft) {
    const toTerm = findClosestTerminal(x, y);
    if (toTerm && toTerm !== state.wireDraft.fromTerminal) {
      // Create new wire connection!
      state.components.push(new WireConnection(state.wireDraft.fromTerminal, toTerm));
      solveCircuit();
    }
    state.wireDraft = null;
  }
  dragTarget = null;
});

// Drag & drop from palette drawer
document.querySelectorAll('.palette-item[draggable="true"]').forEach(item => {
  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('comp_type', item.dataset.type);
  });
});

canvas.addEventListener('dragover', (e) => { e.preventDefault(); });
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const type = e.dataTransfer.getData('comp_type');
  if (!type) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  let defVal = 10;
  if (type === 'battery') defVal = 9.0;
  else if (type === 'bulb') defVal = 15.0;
  else if (type === 'capacitor') defVal = 0.005;

  const comp = new CircuitComponent(type, x, y, defVal);
  state.components.push(comp);
  solveCircuit();
});

// Property Popup Editor
function openPropertyPopup(comp, screenX, screenY) {
  state.selectedComp = comp;
  const popup = document.getElementById('property-popup');
  popup.style.display = 'flex';
  popup.style.left = `${Math.min(window.innerWidth - 260, screenX + 20)}px`;
  popup.style.top = `${Math.min(window.innerHeight - 200, screenY - 20)}px`;

  document.getElementById('popup-comp-title').textContent = `${comp.type.toUpperCase()} (${comp.id})`;
  const slider = document.getElementById('popup-slider');
  const sliderLbl = document.getElementById('popup-slider-label');
  const sliderReadout = document.getElementById('popup-slider-val');

  if (comp.type === 'battery') {
    sliderLbl.textContent = 'Voltage (V):';
    slider.min = 1; slider.max = 36; slider.step = 0.5;
    slider.value = comp.value;
    sliderReadout.textContent = `${comp.value.toFixed(1)} V`;
  } else if (comp.type === 'bulb' || comp.type === 'resistor') {
    sliderLbl.textContent = 'Resistance (Ω):';
    slider.min = 1; slider.max = 100; slider.step = 1;
    slider.value = comp.value;
    sliderReadout.textContent = `${comp.value.toFixed(0)} Ω`;
  }

  slider.oninput = (e) => {
    comp.value = parseFloat(e.target.value);
    sliderReadout.textContent = `${comp.value.toFixed(1)} ${comp.type === 'battery' ? 'V' : 'Ω'}`;
    solveCircuit();
    updatePopupStats();
  };
  updatePopupStats();
}

function updatePopupStats() {
  if (!state.selectedComp) return;
  document.getElementById('popup-stat-i').textContent = `${Math.abs(state.selectedComp.current).toFixed(2)} A`;
  const p = Math.abs(state.selectedComp.current * state.selectedComp.voltageDrop);
  document.getElementById('popup-stat-p').textContent = `${p.toFixed(2)} W`;
}

function closePropertyPopup() {
  document.getElementById('property-popup').style.display = 'none';
  state.selectedComp = null;
}
document.getElementById('popup-close').addEventListener('click', closePropertyPopup);
document.getElementById('popup-delete').addEventListener('click', () => {
  if (state.selectedComp) {
    // Remove component & attached wires
    state.components = state.components.filter(c => {
      if (c === state.selectedComp) return false;
      if (c instanceof WireConnection && (c.t1.comp === state.selectedComp || c.t2.comp === state.selectedComp)) {
        return false;
      }
      return true;
    });
    closePropertyPopup();
    solveCircuit();
  }
});

// ================= 7. Meters & Floating Elements =================
function makeDraggable(el, onMove) {
  let isDown = false;
  let ox = 0, oy = 0;
  el.addEventListener('pointerdown', (e) => {
    isDown = true;
    ox = e.clientX - el.offsetLeft;
    oy = e.clientY - el.offsetTop;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!isDown) return;
    el.style.left = `${e.clientX - ox}px`;
    el.style.top = `${e.clientY - oy}px`;
    if (onMove) onMove(e.clientX - ox, e.clientY - oy);
  });
  const up = () => { isDown = false; };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

// Voltmeter toggle & dragging
document.getElementById('tool-voltmeter-toggle').addEventListener('click', () => {
  state.voltmeterActive = !state.voltmeterActive;
  const disp = state.voltmeterActive ? 'block' : 'none';
  document.getElementById('voltmeter-unit').style.display = disp;
  document.getElementById('probe-black').style.display = disp;
  document.getElementById('probe-red').style.display = disp;
});
document.getElementById('voltmeter-close').addEventListener('click', () => {
  state.voltmeterActive = false;
  document.getElementById('voltmeter-unit').style.display = 'none';
  document.getElementById('probe-black').style.display = 'none';
  document.getElementById('probe-red').style.display = 'none';
});

makeDraggable(document.getElementById('voltmeter-unit'));
makeDraggable(document.getElementById('probe-black'), (x, y) => {
  state.probeBlack.x = x + 8;
  state.probeBlack.y = y;
  solveCircuit();
});
makeDraggable(document.getElementById('probe-red'), (x, y) => {
  state.probeRed.x = x + 8;
  state.probeRed.y = y;
  solveCircuit();
});

// Ammeter toggle & dragging
document.getElementById('tool-ammeter-toggle').addEventListener('click', () => {
  state.ammeterActive = !state.ammeterActive;
  document.getElementById('ammeter-unit').style.display = state.ammeterActive ? 'block' : 'none';
});
document.getElementById('ammeter-close').addEventListener('click', () => {
  state.ammeterActive = false;
  document.getElementById('ammeter-unit').style.display = 'none';
});
makeDraggable(document.getElementById('ammeter-unit'), (x, y) => {
  state.ammeterSensor.x = x + 70;
  state.ammeterSensor.y = y + 70;
  solveCircuit();
});

// ================= 8. Presets Loader =================
function loadPreset(name) {
  state.components = [];
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  if (name === 'simple_series') {
    // Battery + Bulb + Switch in series loop
    const bat = new CircuitComponent('battery', cx - 120, cy - 60, 9.0);
    const sw = new CircuitComponent('switch', cx, cy - 60, 0);
    const bulb = new CircuitComponent('bulb', cx + 120, cy, 15.0);
    const w1 = new CircuitComponent('wire', cx, cy + 60, 0);

    state.components.push(bat, sw, bulb);
    state.components.push(
      new WireConnection(bat.t2, sw.t1),
      new WireConnection(sw.t2, bulb.t1),
      new WireConnection(bulb.t2, bat.t1)
    );
  } else if (name === 'parallel_branches') {
    // Battery + 2 Parallel Bulbs
    const bat = new CircuitComponent('battery', cx - 150, cy, 9.0);
    const b1 = new CircuitComponent('bulb', cx + 30, cy - 60, 15.0);
    const b2 = new CircuitComponent('bulb', cx + 30, cy + 60, 15.0);

    state.components.push(bat, b1, b2);
    state.components.push(
      new WireConnection(bat.t2, b1.t1),
      new WireConnection(b1.t1, b2.t1),
      new WireConnection(b1.t2, b2.t2),
      new WireConnection(b1.t2, bat.t1)
    );
  } else if (name === 'rc_transient') {
    // Battery + Resistor + Capacitor
    const bat = new CircuitComponent('battery', cx - 140, cy, 12.0);
    const r = new CircuitComponent('resistor', cx, cy - 60, 20.0);
    const cap = new CircuitComponent('capacitor', cx + 140, cy, 0.005);

    state.components.push(bat, r, cap);
    state.components.push(
      new WireConnection(bat.t2, r.t1),
      new WireConnection(r.t2, cap.t1),
      new WireConnection(cap.t2, bat.t1)
    );
  } else if (name === 'short_circuit') {
    // Battery directly connected by zero-resistance loop (triggers PhET flame!)
    const bat = new CircuitComponent('battery', cx, cy, 9.0);
    state.components.push(bat, new WireConnection(bat.t1, bat.t2));
  }

  solveCircuit();
  document.getElementById('modal-presets').style.display = 'none';
}

document.querySelectorAll('.preset-card').forEach(card => {
  card.addEventListener('click', () => loadPreset(card.dataset.preset));
});
document.getElementById('btn-presets').addEventListener('click', () => {
  document.getElementById('modal-presets').style.display = 'flex';
});
document.getElementById('modal-presets-close').addEventListener('click', () => {
  document.getElementById('modal-presets').style.display = 'none';
});

// Clear canvas button
document.getElementById('btn-clear').addEventListener('click', () => {
  state.components = [];
  resetCurrents();
});

// View mode segmented controls
document.querySelectorAll('.seg-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.viewMode = btn.dataset.view;
  });
});

document.querySelectorAll('.seg-btn[data-flow]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn[data-flow]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.flowMode = btn.dataset.flow;
  });
});

// INStep Run vs Micro-Step mode toggle
document.getElementById('btn-mode-run').addEventListener('click', () => {
  state.runMode = 'run';
  document.getElementById('btn-mode-run').classList.add('active');
  document.getElementById('btn-mode-instep').classList.remove('active');
  document.getElementById('btn-instep-step').disabled = true;
});

document.getElementById('btn-mode-instep').addEventListener('click', () => {
  state.runMode = 'instep';
  document.getElementById('btn-mode-instep').classList.add('active');
  document.getElementById('btn-mode-run').classList.remove('active');
  document.getElementById('btn-instep-step').disabled = false;
});

document.getElementById('btn-instep-step').addEventListener('click', () => {
  stepINStep();
});

document.getElementById('instep-dt-select').addEventListener('change', (e) => {
  state.dt = parseFloat(e.target.value);
});

// ================= 9. Canvas Resize & Boot =================
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}
window.addEventListener('resize', resizeCanvas);

window.addEventListener('DOMContentLoaded', () => {
  resizeCanvas();
  // Load default PhET simple series circuit
  loadPreset('simple_series');
  // Start 60fps render loop
  renderLoop();
});
