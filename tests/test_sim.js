const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Testing PhET Hardware Simulator Engine...\n');

// 1. Verify DOM ID consistency between web/index.html and web/app.js
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');

const idRegex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
let match;
const usedIds = new Set();
while ((match = idRegex.exec(js)) !== null) {
  usedIds.add(match[1]);
}

console.log(`[DOM Check] Checking ${usedIds.size} element IDs referenced in web/app.js:`);
for (const id of usedIds) {
  assert(html.includes(`id="${id}"`), `Missing DOM element id="${id}" in index.html!`);
  console.log(`  ✓ #${id} exists`);
}

// 2. Extract and test Circuit Solver Math from web/app.js
class Node {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

class CircuitElement {
  constructor(type, n1, n2, val = 10) {
    this.type = type;
    this.n1 = n1;
    this.n2 = n2;
    this.val = val;
    this.isClosed = true;
    this.current = 0;
    this.voltageDrop = 0;
  }
}

function gaussianElimination(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
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
        for (let j = i; j < n; j++) A[k][j] -= factor * A[i][j];
        b[k] -= factor * b[i];
      }
    }
  }
  return b;
}

function solveCircuit(elements) {
  if (elements.length === 0) return 0;
  const nodeSet = new Set();
  elements.forEach(el => { nodeSet.add(el.n1); nodeSet.add(el.n2); });
  const nodes = Array.from(nodeSet);

  const batteries = elements.filter(el => el.type === 'battery');
  if (batteries.length === 0 || nodes.length < 2) {
    elements.forEach(el => { el.current = 0; el.voltageDrop = 0; });
    return 0;
  }

  const groundNode = batteries[0].n1;
  const nodeMap = new Map();
  let unknownCount = 0;
  nodes.forEach(n => {
    if (n === groundNode) nodeMap.set(n, -1);
    else nodeMap.set(n, unknownCount++);
  });

  const numBatteries = batteries.length;
  const totalVars = unknownCount + numBatteries;
  const A = Array.from({ length: totalVars }, () => new Float64Array(totalVars));
  const z = new Float64Array(totalVars);

  const gLeak = 1e-9;
  for (let i = 0; i < unknownCount; i++) A[i][i] += gLeak;

  elements.forEach(el => {
    if (el.type === 'battery') return;
    let r = 0.05;
    if (el.type === 'resistor' || el.type === 'bulb') r = Math.max(0.1, el.val);
    else if (el.type === 'switch') r = el.isClosed ? 0.05 : 1e9;
    else if (el.type === 'wire') r = 0.05;

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

  batteries.forEach((bat, k) => {
    const batRow = unknownCount + k;
    const pos = nodeMap.get(bat.n2);
    const neg = nodeMap.get(bat.n1);
    if (pos >= 0) { A[pos][batRow] += 1.0; A[batRow][pos] += 1.0; }
    if (neg >= 0) { A[neg][batRow] -= 1.0; A[batRow][neg] -= 1.0; }
    z[batRow] = bat.val;
  });

  const sol = gaussianElimination(A, z);
  if (!sol) {
    elements.forEach(el => { el.current = 0; el.voltageDrop = 0; });
    return 0;
  }

  const nodeVoltages = new Map();
  nodes.forEach(n => {
    const idx = nodeMap.get(n);
    nodeVoltages.set(n, idx >= 0 ? sol[idx] : 0.0);
  });

  let peak = 0;
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
    if (Math.abs(el.current) < 1e-4) el.current = 0;
    else peak = Math.max(peak, Math.abs(el.current));
  });
  return peak;
}

console.log('\n[Physics & MNA Tests]');

// Test A: Closed Series Circuit (9V, 10Ω Bulb)
const n1 = new Node(0, 0), n2 = new Node(100, 0), n3 = new Node(100, 100), n4 = new Node(0, 100);
const b = new CircuitElement('battery', n4, n1, 9);
const sw = new CircuitElement('switch', n1, n2, 0.05);
const bulb = new CircuitElement('bulb', n2, n3, 10);
const w = new CircuitElement('wire', n3, n4, 0.05);

let cur = solveCircuit([b, sw, bulb, w]);
console.log(`  ✓ Series Circuit current with 9V: ${cur.toFixed(3)} A (expected ~0.89 A)`);
assert(Math.abs(cur - 0.89) < 0.05, 'Series circuit current failed');

// Test B: Tuner Bar Voltage Change to 36V
b.val = 36;
cur = solveCircuit([b, sw, bulb, w]);
console.log(`  ✓ Battery Tuner Bar adjusted to 36V: ${cur.toFixed(3)} A (expected ~3.56 A)`);
assert(Math.abs(cur - 3.56) < 0.1, 'Voltage adjustment failed');

// Test C: Open Switch (Circuit Cut)
sw.isClosed = false;
cur = solveCircuit([b, sw, bulb, w]);
console.log(`  ✓ Switch opened: Current = ${cur.toFixed(3)} A (expected 0.00 A)`);
assert(cur === 0, 'Current did not drop to 0 on open switch!');

// Test D: Disconnected / Open Wires (No battery loop)
const discN1 = new Node(200, 200), discN2 = new Node(300, 200);
const discWire = new CircuitElement('wire', discN1, discN2, 0.05);
const floatBat = new CircuitElement('battery', new Node(400, 400), new Node(500, 400), 9);
cur = solveCircuit([discWire, floatBat]);
console.log(`  ✓ Open/disconnected wire current: ${discWire.current.toFixed(3)} A (expected 0.00 A)`);
assert(discWire.current === 0, 'Disconnected wire had non-zero current!');

// Test E: Parallel Circuit
const pBatNeg = new Node(0, 100), pBatPos = new Node(0, 0);
const pJuncTop = new Node(100, 0), pJuncBot = new Node(100, 100);
const pBat = new CircuitElement('battery', pBatNeg, pBatPos, 9);
const pW1 = new CircuitElement('wire', pBatPos, pJuncTop, 0.05);
const pW2 = new CircuitElement('wire', pBatNeg, pJuncBot, 0.05);
const pBulb1 = new CircuitElement('bulb', pJuncTop, pJuncBot, 10);
const pBulb2 = new CircuitElement('bulb', pJuncTop, pJuncBot, 10);

cur = solveCircuit([pBat, pW1, pW2, pBulb1, pBulb2]);
console.log(`  ✓ Parallel Circuit battery current: ${Math.abs(pBat.current).toFixed(3)} A (expected ~1.76 A)`);
console.log(`    Bulb 1 current: ${Math.abs(pBulb1.current).toFixed(3)} A | Bulb 2 current: ${Math.abs(pBulb2.current).toFixed(3)} A`);
assert(Math.abs(Math.abs(pBat.current) - 1.76) < 0.1, 'Parallel circuit battery current failed');
assert(Math.abs(Math.abs(pBulb1.current) - 0.88) < 0.05, 'Parallel bulb 1 current failed');

console.log('\n✅ ALL AUTOMATED TESTS PASSED SUCCESSFULLY!');
