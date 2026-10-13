/**
 * PhET Hardware Simulator — Clean, Minimal 2D Physics Laboratories
 * Core algorithms: Linear circuit solver, Faraday induction, Capacitor, Resistivity, Photoelectric.
 */

// --- Global State ---
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

let idSeq = 1;

// --- 1. Circuit Construction Engine ---
class Component {
  constructor(type, x, y, val = 10) {
    this.id = `c_${idSeq++}`;
    this.type = type;
    this.x = x;
    this.y = y;
    this.val = val;
    this.isClosed = true;
    this.current = 0;
    this.width = 90;
    this.updateTerminals();
  }

  updateTerminals() {
    const hw = this.width / 2;
    this.t1 = { comp: this, x: this.x - hw, y: this.y };
    this.t2 = { comp: this, x: this.x + hw, y: this.y };
  }

  moveTo(x, y) {
    this.x = Math.round(x / 10) * 10;
    this.y = Math.round(y / 10) * 10;
    this.updateTerminals();
  }
}

class Wire {
  constructor(t1, t2) {
    this.t1 = t1;
    this.t2 = t2;
    this.current = 0;
  }
}

const circuit = {
  comps: [],
  wireDraft: null,
  electronOffset: 0
};

function solveCircuit() {
  const batteries = circuit.comps.filter(c => c.type === 'battery');
  const resistors = circuit.comps.filter(c => c.type === 'resistor' || c.type === 'bulb');
  const switches = circuit.comps.filter(c => c.type === 'switch');

  const allClosed = switches.every(s => s.isClosed);
  if (batteries.length === 0 || !allClosed || circuit.comps.length < 2) {
    circuit.comps.forEach(c => c.current = 0);
    return;
  }

  // Calculate equivalent series resistance
  const totalV = batteries.reduce((sum, b) => sum + b.val, 0);
  const totalR = Math.max(0.1, resistors.reduce((sum, r) => sum + r.val, 0));
  const I = totalV / totalR;

  circuit.comps.forEach(c => {
    c.current = I;
  });
}

// 2D Component Drawings
function drawCircuit() {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Wires
  circuit.comps.filter(c => c instanceof Wire).forEach(w => {
    ctx.strokeStyle = '#e67e22';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(w.t1.x, w.t1.y); ctx.lineTo(w.t2.x, w.t2.y);
    ctx.stroke();

    // Drifting blue electrons
    if (Math.abs(w.current) > 0.01) {
      const len = Math.hypot(w.t2.x - w.t1.x, w.t2.y - w.t1.y);
      const count = Math.max(2, Math.floor(len / 22));
      for (let i = 0; i < count; i++) {
        let t = (i / count + circuit.electronOffset / len) % 1.0;
        const px = w.t1.x + (w.t2.x - w.t1.x) * t;
        const py = w.t1.y + (w.t2.y - w.t1.y) * t;
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  // Draft wire
  if (circuit.wireDraft) {
    ctx.strokeStyle = '#f39c12';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(circuit.wireDraft.fromT.x, circuit.wireDraft.fromT.y);
    ctx.lineTo(circuit.wireDraft.x, circuit.wireDraft.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Components
  circuit.comps.filter(c => !(c instanceof Wire)).forEach(c => {
    ctx.save();
    ctx.translate(c.x, c.y);

    if (state.viewMode === 'schematic') {
      drawSchematic(c);
    } else {
      drawReal(c);
    }

    ctx.restore();

    // Terminal dots
    [c.t1, c.t2].forEach(t => {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.arc(t.x, t.y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function drawReal(c) {
  const hw = c.width / 2;
  if (c.type === 'battery') {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-hw + 6, -14, c.width - 16, 28);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(hw - 10, -6, 6, 12);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`${c.val}V`, -10, 4);
    ctx.fillText('+', hw - 20, 4);
    ctx.fillText('-', -hw + 10, 4);
  } else if (c.type === 'resistor') {
    ctx.fillStyle = '#e2d4b7';
    ctx.beginPath();
    ctx.roundRect(-hw + 14, -12, c.width - 28, 24, 6);
    ctx.fill();
    const colors = ["#78350f", "#1e293b", "#dc2626"];
    [-10, 0, 10].forEach((bx, idx) => {
      ctx.fillStyle = colors[idx];
      ctx.fillRect(bx, -12, 5, 24);
    });
  } else if (c.type === 'bulb') {
    const isLit = c.current > 0.05;
    if (isLit) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 3;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*18, -6 + Math.sin(a)*18);
        ctx.lineTo(Math.cos(a)*30, -6 + Math.sin(a)*30);
        ctx.stroke();
      }
    }
    ctx.fillStyle = isLit ? '#fef08a' : 'rgba(255, 255, 255, 0.4)';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -6, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-6, 10, 12, 8);
  } else if (c.type === 'switch') {
    ctx.fillStyle = '#334155';
    ctx.fillRect(-hw + 8, -3, c.width - 16, 6);
    ctx.strokeStyle = c.isClosed ? '#f59e0b' : '#ef4444';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(12, c.isClosed ? -4 : -22);
    ctx.stroke();
  }
}

function drawSchematic(c) {
  const hw = c.width / 2;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  if (c.type === 'battery') {
    ctx.beginPath();
    ctx.moveTo(-hw, 0); ctx.lineTo(-6, 0);
    ctx.moveTo(6, 0); ctx.lineTo(hw, 0);
    ctx.moveTo(-6, -16); ctx.lineTo(-6, 16);
    ctx.moveTo(6, -9); ctx.lineTo(6, 9);
    ctx.stroke();
  } else if (c.type === 'resistor') {
    ctx.beginPath();
    ctx.moveTo(-hw, 0); ctx.lineTo(-15, 0);
    ctx.lineTo(-10, -8); ctx.lineTo(0, 8); ctx.lineTo(10, -8); ctx.lineTo(15, 0);
    ctx.lineTo(hw, 0);
    ctx.stroke();
  } else if (c.type === 'bulb') {
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.moveTo(-10, -10); ctx.lineTo(10, 10);
    ctx.moveTo(-10, 10); ctx.lineTo(10, -10);
    ctx.stroke();
  } else {
    drawReal(c);
  }
}

// --- 2. Faraday's Lab ---
const faraday = {
  mx: 240, my: 240,
  loops: 3,
  emf: 0,
  isDragging: false
};

function drawFaraday() {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = 500, cy = 240;

  // Coil
  for (let i = 0; i < faraday.loops; i++) {
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.ellipse(cx + (i - faraday.loops/2)*24, cy, 14, 55, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Galvanometer
  const gx = cx + 80, gy = cy - 110;
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(gx, gy, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Deflecting Needle
  const defl = Math.max(-1, Math.min(1, faraday.emf * 1.5)) * (Math.PI / 4);
  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(defl);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 8); ctx.lineTo(0, -32);
  ctx.stroke();
  ctx.restore();

  // Bar Magnet
  ctx.save();
  ctx.translate(faraday.mx, faraday.my);
  ctx.fillStyle = '#2563eb'; // S
  ctx.fillRect(-50, -20, 50, 40);
  ctx.fillStyle = '#dc2626'; // N
  ctx.fillRect(0, -20, 50, 40);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('S', -32, 6);
  ctx.fillText('N', 20, 6);
  ctx.restore();
}

// --- 3. Capacitor Lab ---
const cap = { dist: 5, v: 1.5 };
function drawCapacitor() {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2, cy = canvas.height / 2;
  const sep = cap.dist * 18;

  ctx.fillStyle = '#dc2626'; // Top +
  ctx.fillRect(cx - 100, cy - sep/2 - 12, 200, 12);
  ctx.fillStyle = '#2563eb'; // Bottom -
  ctx.fillRect(cx - 100, cy + sep/2, 200, 12);

  // E-field
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  for (let x = cx - 80; x <= cx + 80; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, cy - sep/2); ctx.lineTo(x, cy + sep/2);
    ctx.stroke();
  }
}

// --- 4. Resistor Wire Lab ---
const resWire = { len: 10, area: 5 };
function drawResistivity() {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2, cy = canvas.height / 2;
  const w = 150 + resWire.len * 12;
  const h = 24 + resWire.area * 6;

  ctx.fillStyle = '#d97706';
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cx - w/2, cy - h/2, w, h, 6);
  ctx.fill();
  ctx.stroke();

  // Electrons
  ctx.fillStyle = '#38bdf8';
  for (let i = 0; i < 15; i++) {
    const ex = cx - w/2 + 10 + ((i * 25 + state.simTime * 60) % (w - 20));
    ctx.beginPath();
    ctx.arc(ex, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- 5. Photoelectric Lab ---
const pe = { wave: 400, int: 60 };
function drawPhotoelectric() {
  ctx.fillStyle = '#1c385c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Phototube chamber
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(260, 160, 280, 160, 16);
  ctx.fill();
  ctx.stroke();

  // Cathode / Anode
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(290, 180, 10, 120);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(510, 180, 8, 120);

  // Photons & ejected electrons
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(220, 200); ctx.lineTo(290, 240);
  ctx.stroke();

  ctx.fillStyle = '#38bdf8';
  for (let i = 0; i < 6; i++) {
    const ex = 300 + ((i * 30 + state.simTime * 100) % 200);
    ctx.beginPath();
    ctx.arc(ex, 240, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Interaction Handling ---
function setupEvents() {
  window.addEventListener('resize', () => {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  });

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeLab = btn.dataset.lab;

      ['circuit', 'faraday', 'capacitor', 'resistivity', 'photoelectric'].forEach(k => {
        const grp = document.getElementById(`group-${k}`);
        if (grp) grp.style.display = k === state.activeLab ? 'block' : 'none';
      });
      document.getElementById('sidebar-left').style.display = state.activeLab === 'circuit' ? 'flex' : 'none';
    });
  });

  // Circuit Palette click adds component
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      const comp = new Component(type, canvas.width/2 + (Math.random()-0.5)*80, canvas.height/2 + (Math.random()-0.5)*80, type === 'battery' ? 9 : 10);
      circuit.comps.push(comp);
      solveCircuit();
    });
  });

  // Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      circuit.comps = [];
      const cx = canvas.width / 2, cy = canvas.height / 2;
      if (btn.dataset.preset === 'series') {
        const b = new Component('battery', cx - 120, cy, 9);
        const sw = new Component('switch', cx, cy - 60);
        const bulb = new Component('bulb', cx + 120, cy, 10);
        circuit.comps.push(b, sw, bulb);
        circuit.comps.push(new Wire(b.t1, sw.t1));
        circuit.comps.push(new Wire(sw.t2, bulb.t1));
        circuit.comps.push(new Wire(bulb.t2, b.t2));
      } else {
        const b = new Component('battery', cx - 140, cy, 9);
        const l1 = new Component('bulb', cx + 50, cy - 50, 10);
        const l2 = new Component('bulb', cx + 50, cy + 50, 10);
        circuit.comps.push(b, l1, l2);
        circuit.comps.push(new Wire(b.t1, l1.t1));
        circuit.comps.push(new Wire(b.t1, l2.t1));
        circuit.comps.push(new Wire(l1.t2, b.t2));
        circuit.comps.push(new Wire(l2.t2, b.t2));
      }
      solveCircuit();
    });
  });

  // Inputs
  document.getElementById('sel-view').onchange = (e) => state.viewMode = e.target.value;
  document.getElementById('sel-flow').onchange = (e) => state.flowMode = e.target.value;
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

  // INStep buttons
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
    circuit.comps = [];
    faraday.mx = 240; faraday.my = 240;
    solveCircuit();
  };

  // Canvas Mouse
  let dragComp = null, offX = 0, offY = 0;

  canvas.onmousedown = (e) => {
    const x = e.offsetX, y = e.offsetY;
    if (state.activeLab === 'circuit') {
      // Wire drafting
      for (const c of circuit.comps) {
        if (c instanceof Wire) continue;
        for (const t of [c.t1, c.t2]) {
          if (Math.hypot(t.x - x, t.y - y) < 14) {
            circuit.wireDraft = { fromT: t, x, y };
            return;
          }
        }
      }
      // Drag component or toggle switch
      for (const c of circuit.comps) {
        if (c instanceof Wire) continue;
        if (Math.abs(c.x - x) < c.width/2 && Math.abs(c.y - y) < 20) {
          if (c.type === 'switch') {
            c.isClosed = !c.isClosed;
            solveCircuit();
            return;
          }
          dragComp = c;
          offX = x - c.x; offY = y - c.y;
          return;
        }
      }
    } else if (state.activeLab === 'faraday') {
      if (Math.hypot(x - faraday.mx, y - faraday.my) < 60) faraday.isDragging = true;
    }
  };

  canvas.onmousemove = (e) => {
    const x = e.offsetX, y = e.offsetY;
    if (circuit.wireDraft) {
      circuit.wireDraft.x = x; circuit.wireDraft.y = y;
    } else if (dragComp) {
      dragComp.moveTo(x - offX, y - offY);
      solveCircuit();
    } else if (faraday.isDragging) {
      const prevX = faraday.mx;
      faraday.mx = x; faraday.my = y;
      faraday.emf = (x - prevX) * 0.05; // Induced EMF from motion
    }
  };

  window.onmouseup = (e) => {
    if (circuit.wireDraft) {
      const x = e.clientX - canvas.getBoundingClientRect().left;
      const y = e.clientY - canvas.getBoundingClientRect().top;
      for (const c of circuit.comps) {
        if (c instanceof Wire) continue;
        for (const t of [c.t1, c.t2]) {
          if (Math.hypot(t.x - x, t.y - y) < 18 && t !== circuit.wireDraft.fromT) {
            circuit.comps.push(new Wire(circuit.wireDraft.fromT, t));
            solveCircuit();
            break;
          }
        }
      }
      circuit.wireDraft = null;
    }
    dragComp = null;
    faraday.isDragging = false;
  };
}

function step(dt) {
  state.simTime += dt;
  circuit.electronOffset = (circuit.electronOffset + 1.2) % 1000;

  if (state.activeLab === 'circuit') {
    solveCircuit();
    const cur = circuit.comps.find(c => c.type === 'battery')?.current || 0;
    hud.textContent = `Current: ${cur.toFixed(2)} A | Time: ${(state.simTime*1000).toFixed(0)} ms`;
  } else if (state.activeLab === 'faraday') {
    faraday.emf *= 0.95; // Damping
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

window.addEventListener('DOMContentLoaded', () => {
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
  setupEvents();

  // Load basic series circuit initially
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const b = new Component('battery', cx - 120, cy, 9);
  const sw = new Component('switch', cx, cy - 60);
  const bulb = new Component('bulb', cx + 120, cy, 10);
  circuit.comps.push(b, sw, bulb);
  circuit.comps.push(new Wire(b.t1, sw.t1));
  circuit.comps.push(new Wire(sw.t2, bulb.t1));
  circuit.comps.push(new Wire(bulb.t2, b.t2));
  solveCircuit();

  requestAnimationFrame(loop);
});
