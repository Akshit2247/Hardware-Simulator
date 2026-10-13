/**
 * PhET Hardware Simulator — Clean, 2D Circuit Laboratory & Electrodynamics Suite
 * Core features:
 * - Unified Node-Branch Circuit Graph (Battery, Resistor, Bulb, Switch, Wire)
 * - Proximity-based Junction Snapping (weld nodes within 24px)
 * - Draggable component bodies and junction handles
 * - Bottom PhET Tuner Bar with real-time Voltage/Resistance sliders and polarity flip
 * - Strict MNA Linear Circuit Solver: current flows ONLY on verified closed loops
 * - Dynamic Drude electron drift and radiant bulb ray spikes
 * - 4 additional authentic 2D labs: Faraday, Capacitor, Resistor Wire, Photoelectric
 */

// --- Global Simulator State ---
const state = {
  activeLab: 'circuit',
  viewMode: 'real',
  flowMode: 'electrons',
  isRunning: true,
  simTime: 0,
  dt: 0.001
};

const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');

// --- 1. Circuit Construction Kit: Unified Graph Model ---

let nodeIdSeq = 1;
class Node {
  constructor(x, y) {
    this.id = nodeIdSeq++;
    this.x = Math.round(x);
    this.y = Math.round(y);
  }
}

let elemIdSeq = 1;
class CircuitElement {
  constructor(type, n1, n2, val = 10) {
    this.id = `el_${elemIdSeq++}`;
    this.type = type; // 'battery', 'bulb', 'resistor', 'switch', 'wire'
    this.n1 = n1;     // Node instance
    this.n2 = n2;     // Node instance
    this.val = val;   // Volts for battery (9), Ohms for resistor (10) / bulb (10)
    this.isClosed = true; // Switch state
    this.current = 0; // Branch current from MNA solver
    this.voltageDrop = 0;
  }

  get length() {
    return Math.hypot(this.n2.x - this.n1.x, this.n2.y - this.n1.y);
  }

  get angle() {
    return Math.atan2(this.n2.y - this.n1.y, this.n2.x - this.n1.x);
  }

  get midX() {
    return (this.n1.x + this.n2.x) / 2;
  }

  get midY() {
    return (this.n1.y + this.n2.y) / 2;
  }
}

const circuit = {
  elements: [],
  selected: null,         // CircuitElement or Node
  electronOffset: 0,
  snapTargetNode: null,   // Node being snapped to during drag
  maxCurrent: 0
};

// Resistor IEC color bands
function getResistorColors(resistance) {
  const digits = ["#1e293b", "#78350f", "#dc2626", "#ea580c", "#eab308", "#16a34a", "#2563eb", "#7c3aed", "#64748b", "#ffffff"];
  const val = Math.max(1, Math.round(resistance));
  if (val < 10) {
    return ["#1e293b", digits[val], "#1e293b", "#d97706"];
  } else if (val < 100) {
    const s = String(val);
    return [digits[parseInt(s[0])], digits[parseInt(s[1])], "#1e293b", "#d97706"];
  } else {
    const s = String(val);
    const d1 = parseInt(s[0]);
    const d2 = parseInt(s[1]);
    const factor = Math.min(9, s.length - 2);
    return [digits[d1], digits[d2], digits[factor], "#d97706"];
  }
}

// --- Modified Nodal Analysis (MNA) Circuit Solver ---
function solveCircuit() {
  const elements = circuit.elements;
  if (elements.length === 0) {
    circuit.maxCurrent = 0;
    return;
  }

  // 1. Gather all unique nodes
  const nodeSet = new Set();
  elements.forEach(el => {
    nodeSet.add(el.n1);
    nodeSet.add(el.n2);
  });
  const nodes = Array.from(nodeSet);

  const batteries = elements.filter(el => el.type === 'battery');
  if (batteries.length === 0 || nodes.length < 2) {
    elements.forEach(el => { el.current = 0; el.voltageDrop = 0; });
    circuit.maxCurrent = 0;
    return;
  }

  // Choose negative terminal (n1) of first battery as ground (0V)
  const groundNode = batteries[0].n1;

  const nodeMap = new Map();
  let unknownCount = 0;
  nodes.forEach(n => {
    if (n === groundNode) {
      nodeMap.set(n, -1);
    } else {
      nodeMap.set(n, unknownCount++);
    }
  });

  const numBatteries = batteries.length;
  const totalVars = unknownCount + numBatteries;

  // Initialize Matrix A and Vector z
  const A = Array.from({ length: totalVars }, () => new Float64Array(totalVars));
  const z = new Float64Array(totalVars);

  // Shunt conductance to ground prevents singular matrix for open/floating wires
  const gLeak = 1e-9;
  for (let i = 0; i < unknownCount; i++) {
    A[i][i] += gLeak;
  }

  // Stamp passive branches (resistors, bulbs, switches, wires)
  elements.forEach(el => {
    if (el.type === 'battery') return;

    let r = 0.05; // wire resistance in ohms
    if (el.type === 'resistor' || el.type === 'bulb') {
      r = Math.max(0.1, el.val);
    } else if (el.type === 'switch') {
      r = el.isClosed ? 0.05 : 1e9;
    } else if (el.type === 'wire') {
      r = 0.05;
    }

    const g = 1.0 / r;
    const u = nodeMap.get(el.n1);
    const v = nodeMap.get(el.n2);

    if (u >= 0) A[u][u] += g;
    if (v >= 0) A[v][v] += g;
    if (u >= 0 && v >= 0) {
      A[u][v] -= g;
      A[v][u] -= g;
    }
  });

  // Stamp battery sources: V(n2) - V(n1) = V_bat
  batteries.forEach((bat, k) => {
    const batRow = unknownCount + k;
    const pos = nodeMap.get(bat.n2); // positive terminal
    const neg = nodeMap.get(bat.n1); // negative terminal

    if (pos >= 0) {
      A[pos][batRow] += 1.0;
      A[batRow][pos] += 1.0;
    }
    if (neg >= 0) {
      A[neg][batRow] -= 1.0;
      A[batRow][neg] -= 1.0;
    }
    z[batRow] = bat.val;
  });

  // Solve A * x = z
  const sol = gaussianElimination(A, z);
  if (!sol) {
    elements.forEach(el => { el.current = 0; el.voltageDrop = 0; });
    circuit.maxCurrent = 0;
    return;
  }

  // Map solved node voltages
  const nodeVoltages = new Map();
  nodes.forEach(n => {
    const idx = nodeMap.get(n);
    nodeVoltages.set(n, idx >= 0 ? sol[idx] : 0.0);
  });

  // Calculate branch currents
  let peakCurrent = 0;
  elements.forEach(el => {
    const v1 = nodeVoltages.get(el.n1) || 0;
    const v2 = nodeVoltages.get(el.n2) || 0;
    el.voltageDrop = v2 - v1;

    if (el.type === 'battery') {
      const batIdx = batteries.indexOf(el);
      el.current = sol[unknownCount + batIdx];
    } else if (el.type === 'switch' && !el.isClosed) {
      el.current = 0;
    } else {
      let r = (el.type === 'resistor' || el.type === 'bulb') ? Math.max(0.1, el.val) : 0.05;
      el.current = (v1 - v2) / r;
    }

    if (Math.abs(el.current) < 1e-4) {
      el.current = 0;
    } else {
      peakCurrent = Math.max(peakCurrent, Math.abs(el.current));
    }
  });

  circuit.maxCurrent = peakCurrent;
}

function gaussianElimination(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
        maxRow = k;
      }
    }
    if (Math.abs(A[maxRow][i]) < 1e-12) continue;

    const tempRow = A[i]; A[i] = A[maxRow]; A[maxRow] = tempRow;
    const tempB = b[i]; b[i] = b[maxRow]; b[maxRow] = tempB;

    const pivot = A[i][i];
    for (let j = i; j < n; j++) A[i][j] /= pivot;
    b[i] /= pivot;

    for (let k = 0; k < n; k++) {
      if (k !== i && Math.abs(A[k][i]) > 1e-12) {
        const factor = A[k][i];
        for (let j = i; j < n; j++) {
          A[k][j] -= factor * A[i][j];
        }
        b[k] -= factor * b[i];
      }
    }
  }
  return b;
}

// --- Circuit Drawing Routines ---
function drawCircuit() {
  ctx.fillStyle = '#1c385c'; // PhET slate blue
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const elements = circuit.elements;

  // 1. Draw Wires
  elements.filter(el => el.type === 'wire').forEach(w => {
    drawWireElement(w);
  });

  // 2. Draw Active Components (Battery, Resistor, Bulb, Switch)
  elements.filter(el => el.type !== 'wire').forEach(el => {
    drawComponentElement(el);
  });

  // 3. Draw Junction Nodes & Snap Halos
  drawJunctionNodes();
}

function drawWireElement(w) {
  const isSelected = circuit.selected === w;
  const len = w.length;

  // Selected highlight halo
  if (isSelected) {
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w.n1.x, w.n1.y);
    ctx.lineTo(w.n2.x, w.n2.y);
    ctx.stroke();
  }

  // Main copper conductor
  ctx.strokeStyle = '#e67e22';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w.n1.x, w.n1.y);
  ctx.lineTo(w.n2.x, w.n2.y);
  ctx.stroke();

  // Electron or conventional flow
  drawFlowCarriers(w.n1, w.n2, w.current, len);
}

function drawComponentElement(el) {
  const isSelected = circuit.selected === el;
  const len = el.length;
  const ang = el.angle;
  const midX = el.midX;
  const midY = el.midY;

  // Lead wires from nodes to component body
  ctx.strokeStyle = '#e67e22';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(el.n1.x, el.n1.y);
  ctx.lineTo(el.n2.x, el.n2.y);
  ctx.stroke();

  // Electron drift along the leads
  drawFlowCarriers(el.n1, el.n2, el.current, len);

  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(ang);

  // Selected highlight halo
  if (isSelected) {
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 4;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(-48, -26, 96, 52);
    ctx.setLineDash([]);
  }

  if (state.viewMode === 'schematic') {
    drawSchematicComponent(el);
  } else {
    drawRealComponent(el);
  }

  ctx.restore();
}

function drawRealComponent(el) {
  if (el.type === 'battery') {
    // 2D PhET Battery
    // Main charcoal cylinder
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(-38, -16, 70, 32, 4);
    ctx.fill();

    // Gold positive terminal (+)
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.roundRect(32, -8, 8, 16, 2);
    ctx.fill();

    // Darker bottom label plate
    ctx.fillStyle = '#334155';
    ctx.fillRect(-34, -12, 62, 24);

    // Voltage & Polarity text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${el.val.toFixed(1)}V`, -3, 0);

    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('+', 20, 0);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('-', -26, 0);

  } else if (el.type === 'resistor') {
    // 2D PhET Ceramic Resistor
    ctx.fillStyle = '#e2d4b7';
    ctx.beginPath();
    ctx.roundRect(-32, -14, 64, 28, 8);
    ctx.fill();
    ctx.strokeStyle = '#c5b597';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 4 IEC color bands
    const colors = getResistorColors(el.val);
    const bandPositions = [-18, -6, 6, 18];
    colors.forEach((col, idx) => {
      ctx.fillStyle = col;
      ctx.fillRect(bandPositions[idx] - 3, -14, 6, 28);
    });

  } else if (el.type === 'bulb') {
    // 2D PhET Light Bulb
    const isLit = Math.abs(el.current) > 0.02;
    const power = (el.current ** 2) * el.val;

    // Radiant ray spikes if lit
    if (isLit) {
      const rayLen = Math.min(48, 14 + power * 1.6);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 20, -10 + Math.sin(a) * 20);
        ctx.lineTo(Math.cos(a) * (20 + rayLen), -10 + Math.sin(a) * (20 + rayLen));
        ctx.stroke();
      }
    }

    // Glass globe
    ctx.fillStyle = isLit ? '#fef08a' : 'rgba(255, 255, 255, 0.4)';
    ctx.strokeStyle = isLit ? '#f59e0b' : '#cbd5e1';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, -10, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Tungsten filament loop
    ctx.strokeStyle = isLit ? '#ea580c' : '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, 2);
    ctx.lineTo(-4, -10);
    ctx.lineTo(0, -14);
    ctx.lineTo(4, -10);
    ctx.lineTo(6, 2);
    ctx.stroke();

    // Screw base
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.roundRect(-8, 6, 16, 10, 2);
    ctx.fill();

    // Contact bottom
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(0, 17, 3, 0, Math.PI * 2);
    ctx.fill();

  } else if (el.type === 'switch') {
    // 2D PhET Knife Switch
    ctx.fillStyle = '#334155';
    ctx.fillRect(-30, -4, 60, 8);

    // Terminals
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(-22, 0, 5, 0, Math.PI * 2);
    ctx.arc(22, 0, 5, 0, Math.PI * 2);
    ctx.fill();

    // Movable blade
    ctx.strokeStyle = el.isClosed ? '#f59e0b' : '#ef4444';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-22, 0);
    if (el.isClosed) {
      ctx.lineTo(22, 0);
    } else {
      ctx.lineTo(16, -26); // Knife blade angled up
    }
    ctx.stroke();

    // Insulated handle
    if (!el.isClosed) {
      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.arc(16, -26, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSchematicComponent(el) {
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;

  if (el.type === 'battery') {
    ctx.beginPath();
    ctx.moveTo(-35, 0); ctx.lineTo(-8, 0);
    ctx.moveTo(8, 0); ctx.lineTo(35, 0);
    // Plates
    ctx.moveTo(-8, -16); ctx.lineTo(-8, 16);
    ctx.moveTo(8, -10); ctx.lineTo(8, 10);
    ctx.stroke();
  } else if (el.type === 'resistor') {
    ctx.beginPath();
    ctx.moveTo(-35, 0); ctx.lineTo(-18, 0);
    ctx.lineTo(-12, -9); ctx.lineTo(0, 9); ctx.lineTo(12, -9); ctx.lineTo(18, 0);
    ctx.lineTo(35, 0);
    ctx.stroke();
  } else if (el.type === 'bulb') {
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.moveTo(-11, -11); ctx.lineTo(11, 11);
    ctx.moveTo(-11, 11); ctx.lineTo(11, -11);
    ctx.stroke();
  } else if (el.type === 'switch') {
    ctx.beginPath();
    ctx.arc(-16, 0, 3, 0, Math.PI * 2);
    ctx.arc(16, 0, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(16, el.isClosed ? 0 : -18);
    ctx.stroke();
  }
}

// Flow Carriers (Electrons or Conventional)
function drawFlowCarriers(n1, n2, current, len) {
  if (Math.abs(current) < 1e-4 || len < 15) return;

  const count = Math.max(2, Math.floor(len / 22));
  const isElectron = state.flowMode === 'electrons';
  // Electrons flow opposite to conventional current (+ to -)
  const dir = isElectron ? (current >= 0 ? -1 : 1) : (current >= 0 ? 1 : -1);

  for (let i = 0; i < count; i++) {
    let t = ((i / count) + (dir * (circuit.electronOffset / len))) % 1.0;
    if (t < 0) t += 1.0;

    const px = n1.x + (n2.x - n1.x) * t;
    const py = n1.y + (n2.y - n1.y) * t;

    if (isElectron) {
      // Blue e- dot
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Orange conventional current dot
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Draw Junction Nodes (Solder Grommets)
function drawJunctionNodes() {
  const nodeSet = new Set();
  circuit.elements.forEach(el => {
    nodeSet.add(el.n1);
    nodeSet.add(el.n2);
  });

  nodeSet.forEach(node => {
    const isSelected = circuit.selected === node;

    // If node is being snapped to, draw magnetic snap halo
    if (circuit.snapTargetNode === node) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(node.x, node.y, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (isSelected) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 12, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Outer grommet ring
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(node.x, node.y, 6.5, 0, Math.PI * 2);
    ctx.fill();

    // Inner silver solder dot
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

// --- 2. Interactive Canvas Events & Snapping ---

let dragAction = null; // { type: 'node'|'element', ... }

function setupCanvasInteractions() {
  canvas.addEventListener('mousedown', (e) => {
    if (state.activeLab !== 'circuit') return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 1. Check Node handles first (radius < 14px)
    for (const el of circuit.elements) {
      for (const node of [el.n1, el.n2]) {
        if (Math.hypot(node.x - x, node.y - y) < 14) {
          dragAction = {
            type: 'node',
            node,
            startX: node.x,
            startY: node.y
          };
          selectItem(node);
          return;
        }
      }
    }

    // 2. Check Switch blade click to toggle
    for (const el of circuit.elements) {
      if (el.type === 'switch') {
        const distToMid = Math.hypot(el.midX - x, el.midY - y);
        if (distToMid < 24) {
          el.isClosed = !el.isClosed;
          solveCircuit();
          updateTunerBar();
          return;
        }
      }
    }

    // 3. Check Component bodies (distance to line segment < 18px)
    for (const el of circuit.elements) {
      const dist = distanceToSegment(x, y, el.n1.x, el.n1.y, el.n2.x, el.n2.y);
      if (dist < 18) {
        dragAction = {
          type: 'element',
          el,
          startX: x,
          startY: y,
          n1StartX: el.n1.x,
          n1StartY: el.n1.y,
          n2StartX: el.n2.x,
          n2StartY: el.n2.y
        };
        selectItem(el);
        return;
      }
    }

    // 4. Clicked empty background: deselect
    selectItem(null);
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragAction || state.activeLab !== 'circuit') return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (dragAction.type === 'node') {
      dragAction.node.x = Math.round(x);
      dragAction.node.y = Math.round(y);

      // Check proximity snapping to other nodes (d < 24px)
      circuit.snapTargetNode = null;
      for (const el of circuit.elements) {
        for (const other of [el.n1, el.n2]) {
          if (other !== dragAction.node) {
            const d = Math.hypot(other.x - x, other.y - y);
            if (d < 24) {
              circuit.snapTargetNode = other;
              break;
            }
          }
        }
        if (circuit.snapTargetNode) break;
      }

      solveCircuit();
    } else if (dragAction.type === 'element') {
      const dx = Math.round(x - dragAction.startX);
      const dy = Math.round(y - dragAction.startY);
      dragAction.el.n1.x = dragAction.n1StartX + dx;
      dragAction.el.n1.y = dragAction.n1StartY + dy;
      dragAction.el.n2.x = dragAction.n2StartX + dx;
      dragAction.el.n2.y = dragAction.n2StartY + dy;

      solveCircuit();
    }
  });

  window.addEventListener('mouseup', () => {
    if (!dragAction) return;

    if (dragAction.type === 'node' && circuit.snapTargetNode) {
      // Weld nodes together!
      const target = circuit.snapTargetNode;
      const oldNode = dragAction.node;

      circuit.elements.forEach(el => {
        if (el.n1 === oldNode) el.n1 = target;
        if (el.n2 === oldNode) el.n2 = target;
      });

      circuit.snapTargetNode = null;
      solveCircuit();
      updateTunerBar();
    }

    dragAction = null;
  });

  // Keyboard shortcut: Delete or Backspace to remove selected item
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (circuit.selected instanceof CircuitElement) {
        deleteElement(circuit.selected);
      }
    }
  });
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

// --- 3. Component Spawning & Toolbox Setup ---

function spawnElement(type) {
  const cx = canvas.width / 2 + (Math.random() - 0.5) * 60;
  const cy = canvas.height / 2 + (Math.random() - 0.5) * 60;

  let n1, n2, el;
  if (type === 'battery') {
    n1 = new Node(cx - 45, cy);
    n2 = new Node(cx + 45, cy);
    el = new CircuitElement('battery', n1, n2, 9);
  } else if (type === 'resistor') {
    n1 = new Node(cx - 40, cy);
    n2 = new Node(cx + 40, cy);
    el = new CircuitElement('resistor', n1, n2, 10);
  } else if (type === 'bulb') {
    n1 = new Node(cx - 40, cy);
    n2 = new Node(cx + 40, cy);
    el = new CircuitElement('bulb', n1, n2, 10);
  } else if (type === 'switch') {
    n1 = new Node(cx - 40, cy);
    n2 = new Node(cx + 40, cy);
    el = new CircuitElement('switch', n1, n2, 0.05);
  } else if (type === 'wire') {
    n1 = new Node(cx - 50, cy);
    n2 = new Node(cx + 50, cy);
    el = new CircuitElement('wire', n1, n2, 0.05);
  }

  if (el) {
    circuit.elements.push(el);
    selectItem(el);
    solveCircuit();
  }
}

function loadPreset(name) {
  circuit.elements = [];
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  if (name === 'series') {
    // 4 corners: Battery -> Switch -> Bulb -> Resistor -> Battery
    const nTopLeft = new Node(cx - 120, cy - 80);
    const nTopRight = new Node(cx + 120, cy - 80);
    const nBotRight = new Node(cx + 120, cy + 80);
    const nBotLeft = new Node(cx - 120, cy + 80);

    const b = new CircuitElement('battery', nBotLeft, nTopLeft, 9);
    const sw = new CircuitElement('switch', nTopLeft, nTopRight, 0.05);
    const bulb = new CircuitElement('bulb', nTopRight, nBotRight, 10);
    const w = new CircuitElement('wire', nBotRight, nBotLeft, 0.05);

    circuit.elements.push(b, sw, bulb, w);
  } else if (name === 'parallel') {
    // Battery powering two parallel bulb branches
    const nBatNeg = new Node(cx - 160, cy + 80);
    const nBatPos = new Node(cx - 160, cy - 80);

    const nJuncTop1 = new Node(cx - 20, cy - 80);
    const nJuncBot1 = new Node(cx - 20, cy + 80);

    const nJuncTop2 = new Node(cx + 120, cy - 80);
    const nJuncBot2 = new Node(cx + 120, cy + 80);

    const b = new CircuitElement('battery', nBatNeg, nBatPos, 9);
    const wTop1 = new CircuitElement('wire', nBatPos, nJuncTop1, 0.05);
    const wBot1 = new CircuitElement('wire', nBatNeg, nJuncBot1, 0.05);

    const bulb1 = new CircuitElement('bulb', nJuncTop1, nJuncBot1, 10);

    const wTop2 = new CircuitElement('wire', nJuncTop1, nJuncTop2, 0.05);
    const wBot2 = new CircuitElement('wire', nJuncBot1, nJuncBot2, 0.05);

    const bulb2 = new CircuitElement('bulb', nJuncTop2, nJuncBot2, 10);

    circuit.elements.push(b, wTop1, wBot1, bulb1, wTop2, wBot2, bulb2);
  }

  selectItem(null);
  solveCircuit();
}

function clearCanvas() {
  circuit.elements = [];
  selectItem(null);
  solveCircuit();
}

// --- 4. Selection & PhET Tuner Bar ---

const tunerBar = document.getElementById('tuner-bar');
const tunerIcon = document.getElementById('tuner-icon');
const tunerLabel = document.getElementById('tuner-label');
const tunerValBadge = document.getElementById('tuner-val-badge');
const tunerSlider = document.getElementById('tuner-slider');
const tunerBtnMinus = document.getElementById('tuner-btn-minus');
const tunerBtnPlus = document.getElementById('tuner-btn-plus');
const tunerBtnFlip = document.getElementById('tuner-btn-flip');
const tunerBtnToggle = document.getElementById('tuner-btn-toggle');
const tunerBtnSplit = document.getElementById('tuner-btn-split');
const tunerBtnDel = document.getElementById('tuner-btn-del');

function selectItem(item) {
  circuit.selected = item;
  updateTunerBar();
}

function updateTunerBar() {
  const item = circuit.selected;
  if (!item || state.activeLab !== 'circuit') {
    tunerBar.style.display = 'none';
    return;
  }

  tunerBar.style.display = 'flex';

  // Check if item is a Node (Junction)
  if (item instanceof Node) {
    const connected = circuit.elements.filter(el => el.n1 === item || el.n2 === item);
    tunerIcon.textContent = '🔗';
    tunerLabel.textContent = 'Junction';
    tunerValBadge.textContent = `${connected.length} connected`;

    tunerSlider.style.display = 'none';
    tunerBtnMinus.style.display = 'none';
    tunerBtnPlus.style.display = 'none';
    tunerBtnFlip.style.display = 'none';
    tunerBtnToggle.style.display = 'none';
    tunerBtnDel.style.display = 'none';
    tunerBtnSplit.style.display = connected.length >= 2 ? 'inline-block' : 'none';
    return;
  }

  // Item is a CircuitElement
  const el = item;
  tunerBtnDel.style.display = 'inline-block';
  tunerBtnSplit.style.display = 'none';

  if (el.type === 'battery') {
    tunerIcon.textContent = '🔋';
    tunerLabel.textContent = 'Battery';
    tunerValBadge.textContent = `${el.val.toFixed(1)} V`;

    tunerSlider.style.display = 'inline-block';
    tunerSlider.min = 0;
    tunerSlider.max = 120;
    tunerSlider.step = 0.5;
    tunerSlider.value = el.val;

    tunerBtnMinus.style.display = 'inline-block';
    tunerBtnPlus.style.display = 'inline-block';
    tunerBtnFlip.style.display = 'inline-block';
    tunerBtnToggle.style.display = 'none';

  } else if (el.type === 'resistor') {
    tunerIcon.textContent = '⚡';
    tunerLabel.textContent = 'Resistor';
    tunerValBadge.textContent = `${el.val.toFixed(1)} Ω`;

    tunerSlider.style.display = 'inline-block';
    tunerSlider.min = 1;
    tunerSlider.max = 1000;
    tunerSlider.step = 1;
    tunerSlider.value = el.val;

    tunerBtnMinus.style.display = 'inline-block';
    tunerBtnPlus.style.display = 'inline-block';
    tunerBtnFlip.style.display = 'none';
    tunerBtnToggle.style.display = 'none';

  } else if (el.type === 'bulb') {
    tunerIcon.textContent = '💡';
    tunerLabel.textContent = 'Light Bulb';
    tunerValBadge.textContent = `${el.val.toFixed(1)} Ω`;

    tunerSlider.style.display = 'inline-block';
    tunerSlider.min = 1;
    tunerSlider.max = 100;
    tunerSlider.step = 1;
    tunerSlider.value = el.val;

    tunerBtnMinus.style.display = 'inline-block';
    tunerBtnPlus.style.display = 'inline-block';
    tunerBtnFlip.style.display = 'none';
    tunerBtnToggle.style.display = 'none';

  } else if (el.type === 'switch') {
    tunerIcon.textContent = '🔌';
    tunerLabel.textContent = 'Switch';
    tunerValBadge.textContent = el.isClosed ? 'Closed' : 'Open';

    tunerSlider.style.display = 'none';
    tunerBtnMinus.style.display = 'none';
    tunerBtnPlus.style.display = 'none';
    tunerBtnFlip.style.display = 'none';
    tunerBtnToggle.style.display = 'inline-block';

  } else if (el.type === 'wire') {
    tunerIcon.textContent = '〰️';
    tunerLabel.textContent = 'Wire';
    tunerValBadge.textContent = `${(el.length / 10).toFixed(0)} cm`;

    tunerSlider.style.display = 'none';
    tunerBtnMinus.style.display = 'none';
    tunerBtnPlus.style.display = 'none';
    tunerBtnFlip.style.display = 'none';
    tunerBtnToggle.style.display = 'none';
  }
}

function deleteElement(el) {
  const idx = circuit.elements.indexOf(el);
  if (idx !== -1) {
    circuit.elements.splice(idx, 1);
    selectItem(null);
    solveCircuit();
  }
}

function splitJunction(node) {
  const connected = circuit.elements.filter(el => el.n1 === node || el.n2 === node);
  if (connected.length < 2) return;

  // Detach all except the first connected element
  for (let i = 1; i < connected.length; i++) {
    const el = connected[i];
    const offset = (i) * 22;
    const newNode = new Node(node.x + offset, node.y + offset);
    if (el.n1 === node) el.n1 = newNode;
    if (el.n2 === node) el.n2 = newNode;
  }

  selectItem(null);
  solveCircuit();
}

function setupTunerBarEvents() {
  tunerSlider.addEventListener('input', (e) => {
    if (circuit.selected instanceof CircuitElement) {
      circuit.selected.val = parseFloat(e.target.value);
      updateTunerBar();
      solveCircuit();
    }
  });

  tunerBtnMinus.addEventListener('click', () => {
    if (circuit.selected instanceof CircuitElement) {
      const step = circuit.selected.type === 'battery' ? 1 : 1;
      circuit.selected.val = Math.max(parseFloat(tunerSlider.min), circuit.selected.val - step);
      updateTunerBar();
      solveCircuit();
    }
  });

  tunerBtnPlus.addEventListener('click', () => {
    if (circuit.selected instanceof CircuitElement) {
      const step = circuit.selected.type === 'battery' ? 1 : 1;
      circuit.selected.val = Math.min(parseFloat(tunerSlider.max), circuit.selected.val + step);
      updateTunerBar();
      solveCircuit();
    }
  });

  tunerBtnFlip.addEventListener('click', () => {
    if (circuit.selected instanceof CircuitElement && circuit.selected.type === 'battery') {
      const temp = circuit.selected.n1;
      circuit.selected.n1 = circuit.selected.n2;
      circuit.selected.n2 = temp;
      solveCircuit();
    }
  });

  tunerBtnToggle.addEventListener('click', () => {
    if (circuit.selected instanceof CircuitElement && circuit.selected.type === 'switch') {
      circuit.selected.isClosed = !circuit.selected.isClosed;
      updateTunerBar();
      solveCircuit();
    }
  });

  tunerBtnSplit.addEventListener('click', () => {
    if (circuit.selected instanceof Node) {
      splitJunction(circuit.selected);
    }
  });

  tunerBtnDel.addEventListener('click', () => {
    if (circuit.selected instanceof CircuitElement) {
      deleteElement(circuit.selected);
    }
  });
}

// --- 5. Other 4 Laboratories (Faraday, Capacitor, Resistivity, Photoelectric) ---

// --- Faraday's Lab ---
const faraday = {
  mx: 240, my: 240,
  loops: 3,
  emf: 0,
  isDragging: false
};

function drawFaraday() {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2 + 100, cy = canvas.height / 2;

  // Copper Solenoid Coil
  for (let i = 0; i < faraday.loops; i++) {
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.ellipse(cx + (i - faraday.loops / 2) * 32, cy, 18, 65, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Galvanometer Dial
  const gx = cx + 90, gy = cy - 120;
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(gx, gy, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Scale ticks
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  for (let a = -Math.PI / 4; a <= Math.PI / 4; a += Math.PI / 16) {
    ctx.beginPath();
    ctx.moveTo(gx + Math.sin(a) * 36, gy - Math.cos(a) * 36);
    ctx.lineTo(gx + Math.sin(a) * 44, gy - Math.cos(a) * 44);
    ctx.stroke();
  }

  // Deflecting Needle
  const defl = Math.max(-1, Math.min(1, faraday.emf * 1.8)) * (Math.PI / 4);
  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(defl);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 10); ctx.lineTo(0, -38);
  ctx.stroke();
  ctx.restore();

  // Draggable Bar Magnet
  ctx.save();
  ctx.translate(faraday.mx, faraday.my);
  ctx.fillStyle = '#2563eb'; // S
  ctx.fillRect(-60, -24, 60, 48);
  ctx.fillStyle = '#dc2626'; // N
  ctx.fillRect(0, -24, 60, 48);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', -30, 0);
  ctx.fillText('N', 30, 0);
  ctx.restore();
}

// --- Capacitor Lab ---
const cap = { dist: 5, v: 1.5 };
function drawCapacitor() {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2, cy = canvas.height / 2;
  const pw = 16, ph = 140;
  const gap = cap.dist * 18;

  // Left Plate (+ / Gold)
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(cx - gap / 2 - pw, cy - ph / 2, pw, ph);

  // Right Plate (- / Slate)
  ctx.fillStyle = '#64748b';
  ctx.fillRect(cx + gap / 2, cy - ph / 2, pw, ph);

  // Electric Field Lines
  ctx.strokeStyle = 'rgba(254, 240, 138, 0.45)';
  ctx.lineWidth = 2;
  for (let y = cy - ph / 2 + 15; y < cy + ph / 2; y += 22) {
    ctx.beginPath();
    ctx.moveTo(cx - gap / 2, y);
    ctx.lineTo(cx + gap / 2, y);
    ctx.stroke();
    // Arrow head
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.moveTo(cx + 6, y - 4);
    ctx.lineTo(cx + 14, y);
    ctx.lineTo(cx + 6, y + 4);
    ctx.fill();
  }

  // Battery connecting wires
  ctx.strokeStyle = '#e67e22';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx - gap / 2 - pw / 2, cy + ph / 2);
  ctx.lineTo(cx - gap / 2 - pw / 2, cy + 120);
  ctx.lineTo(cx + gap / 2 + pw / 2, cy + 120);
  ctx.lineTo(cx + gap / 2 + pw / 2, cy + ph / 2);
  ctx.stroke();
}

// --- Resistor Wire Lab ---
const resWire = { len: 10, area: 5 };
function drawResistivity() {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2, cy = canvas.height / 2;
  const w = resWire.len * 24;
  const h = resWire.area * 10;

  // 3D Cylinder Conductor
  ctx.fillStyle = '#b45309';
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);

  // Right face ellipse
  ctx.fillStyle = '#d97706';
  ctx.beginPath();
  ctx.ellipse(cx + w / 2, cy, 12, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Left face ellipse
  ctx.fillStyle = '#92400e';
  ctx.beginPath();
  ctx.ellipse(cx - w / 2, cy, 12, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Drude Lattice Impurity scattering centers
  ctx.fillStyle = '#fde68a';
  for (let i = -w / 2 + 20; i < w / 2; i += 32) {
    ctx.beginPath();
    ctx.arc(cx + i, cy - h / 4, 3, 0, Math.PI * 2);
    ctx.arc(cx + i + 16, cy + h / 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Photoelectric Lab ---
const pe = { wave: 400, int: 60, electrons: [] };
function drawPhotoelectric() {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2, cy = canvas.height / 2;

  // Emitter Target Plate (Sodium/Zinc)
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(cx - 160, cy - 80, 24, 160);

  // Collector Plate
  ctx.fillStyle = '#64748b';
  ctx.fillRect(cx + 140, cy - 80, 24, 160);

  // Incoming Monochromatic Light Beam
  const photonEnergy = 1240 / pe.wave;
  const beamColor = pe.wave < 380 ? '#c084fc' : pe.wave < 500 ? '#38bdf8' : pe.wave < 600 ? '#4ade80' : '#f87171';
  ctx.strokeStyle = beamColor;
  ctx.lineWidth = 4;
  for (let y = cy - 60; y < cy + 60; y += 24) {
    ctx.beginPath();
    ctx.moveTo(cx - 280, y - 60);
    ctx.lineTo(cx - 160, y);
    ctx.stroke();
  }

  // Work function for Sodium: 2.28 eV
  const workFunction = 2.28;
  const canEmit = photonEnergy > workFunction && pe.int > 0;

  if (canEmit && Math.random() < pe.int * 0.005) {
    const kMax = photonEnergy - workFunction;
    pe.electrons.push({
      x: cx - 136,
      y: cy - 60 + Math.random() * 120,
      vx: Math.sqrt(kMax) * 3 + Math.random() * 1.5,
      vy: (Math.random() - 0.5) * 1.5
    });
  }

  // Draw and animate ejected electrons
  ctx.fillStyle = '#38bdf8';
  pe.electrons.forEach((e, idx) => {
    e.x += e.vx;
    e.y += e.vy;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 4, 0, Math.PI * 2);
    ctx.fill();

    if (e.x > cx + 140 || e.y < cy - 100 || e.y > cy + 100) {
      pe.electrons.splice(idx, 1);
    }
  });
}

// --- 6. Step & Animation Loop ---

function step(dt) {
  state.simTime += dt;
  circuit.electronOffset = (circuit.electronOffset + (circuit.maxCurrent * 35 * dt + 0.8)) % 1000;

  if (state.activeLab === 'circuit') {
    solveCircuit();
    hud.textContent = `Peak Current: ${circuit.maxCurrent.toFixed(2)} A | Time: ${(state.simTime * 1000).toFixed(0)} ms`;
  } else if (state.activeLab === 'faraday') {
    faraday.emf *= 0.94; // Damping
    hud.textContent = `Induced EMF: ${faraday.emf.toFixed(2)} V | Loops: ${faraday.loops}`;
  } else if (state.activeLab === 'capacitor') {
    const C = (8.85e-3 / cap.dist).toFixed(2);
    hud.textContent = `Capacitance: ${C} pF | Voltage: ${cap.v.toFixed(1)} V`;
  } else if (state.activeLab === 'resistivity') {
    const R = (resWire.len / (resWire.area * 0.5)).toFixed(2);
    hud.textContent = `Resistance: ${R} Ω | Thickness: ${resWire.area} mm²`;
  } else if (state.activeLab === 'photoelectric') {
    const E = (1240 / pe.wave).toFixed(2);
    hud.textContent = `Photon Energy: ${E} eV | Wavelength: ${pe.wave} nm`;
  }
}

function loop() {
  if (state.isRunning) step(state.dt);

  switch (state.activeLab) {
    case 'circuit': drawCircuit(); break;
    case 'faraday': drawFaraday(); break;
    case 'capacitor': drawCapacitor(); break;
    case 'resistivity': drawResistivity(); break;
    case 'photoelectric': drawPhotoelectric(); break;
  }
  requestAnimationFrame(loop);
}

// --- 7. Initialization & Event Bindings ---

function setupEvents() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeLab = btn.dataset.lab;

      // Toggle sidebars & panels
      document.getElementById('sidebar-left').style.display = state.activeLab === 'circuit' ? 'flex' : 'none';
      ['circuit', 'faraday', 'capacitor', 'resistivity', 'photoelectric'].forEach(lab => {
        const grp = document.getElementById(`group-${lab}`);
        if (grp) grp.style.display = state.activeLab === lab ? 'flex' : 'none';
      });

      // Update Tuner Bar visibility
      updateTunerBar();
    });
  });

  // Toolbox item clicks (Battery, Bulb, Resistor, Switch, Wire)
  document.querySelectorAll('.tool-btn[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      spawnElement(btn.dataset.type);
    });
  });

  // Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      loadPreset(btn.dataset.preset);
    });
  });

  // Clear Canvas
  const btnClear = document.getElementById('btn-clear');
  if (btnClear) btnClear.addEventListener('click', clearCanvas);

  // View / Flow Mode
  document.getElementById('sel-view').onchange = (e) => state.viewMode = e.target.value;
  document.getElementById('sel-flow').onchange = (e) => state.flowMode = e.target.value;

  // Sliders for other labs
  document.getElementById('rng-loops').oninput = (e) => {
    faraday.loops = parseInt(e.target.value);
    document.getElementById('val-loops').textContent = faraday.loops;
  };
  document.getElementById('rng-cap-d').oninput = (e) => {
    cap.dist = parseFloat(e.target.value);
    document.getElementById('val-cap-d').textContent = `${cap.dist} mm`;
  };
  document.getElementById('rng-cap-v').oninput = (e) => {
    cap.v = parseFloat(e.target.value);
    document.getElementById('val-cap-v').textContent = `${cap.v} V`;
  };
  document.getElementById('rng-res-l').oninput = (e) => {
    resWire.len = parseFloat(e.target.value);
    document.getElementById('val-res-l').textContent = `${resWire.len} cm`;
  };
  document.getElementById('rng-res-a').oninput = (e) => {
    resWire.area = parseFloat(e.target.value);
    document.getElementById('val-res-a').textContent = `${resWire.area} mm²`;
  };
  document.getElementById('rng-pe-wave').oninput = (e) => {
    pe.wave = parseFloat(e.target.value);
    document.getElementById('val-pe-wave').textContent = `${pe.wave} nm`;
  };
  document.getElementById('rng-pe-int').oninput = (e) => {
    pe.int = parseFloat(e.target.value);
    document.getElementById('val-pe-int').textContent = `${pe.int}%`;
  };

  // INStep Controls
  const btnRun = document.getElementById('btn-run');
  const btnStep = document.getElementById('btn-step');
  const btnReset = document.getElementById('btn-reset');

  btnRun.onclick = () => {
    state.isRunning = !state.isRunning;
    btnRun.textContent = state.isRunning ? '▶ Run' : '⏸ Pause';
    btnRun.classList.toggle('active', state.isRunning);
  };
  btnStep.onclick = () => step(state.dt);
  btnReset.onclick = () => {
    loadPreset('series');
    faraday.mx = 240; faraday.my = 240;
  };

  // Faraday magnet drag
  canvas.addEventListener('mousedown', (e) => {
    if (state.activeLab !== 'faraday') return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (Math.hypot(x - faraday.mx, y - faraday.my) < 60) faraday.isDragging = true;
  });
  window.addEventListener('mousemove', (e) => {
    if (state.activeLab !== 'faraday' || !faraday.isDragging) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const prevX = faraday.mx;
    faraday.mx = x; faraday.my = y;
    faraday.emf = (x - prevX) * 0.05;
  });
  window.addEventListener('mouseup', () => {
    faraday.isDragging = false;
  });

  // Canvas Interactions & Tuner Bar
  setupCanvasInteractions();
  setupTunerBarEvents();
}

window.addEventListener('resize', () => {
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
});

window.addEventListener('DOMContentLoaded', () => {
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
  setupEvents();
  loadPreset('series');
  requestAnimationFrame(loop);
});
