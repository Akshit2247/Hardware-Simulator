# ⚡ Hardware Simulator
> **PhET-Accurate Interactive Circuit Construction Kit & INStep™ Transient Micro-Stepping Engine**

[![Live Demo](https://img.shields.io/badge/Live_Demo-GitHub_Pages-00d2ff.svg)](https://akshit2247.github.io/Hardware-Simulator/)

**Hardware Simulator** is a high-fidelity circuit laboratory modeled directly after the **PhET Circuit Construction Kit**, engineered with a distraction-free, minimal UI and maximal physical functionality. It features microscopic **"See Inside the Circuit"** cutaways and the **⭐ INStep Engine** for cycle-by-cycle transient micro-stepping analysis.

---

## 🚀 Live Interactive Simulator
Experience the live web laboratory right in your browser (no installation required):  
👉 **[https://akshit2247.github.io/Hardware-Simulator/](https://akshit2247.github.io/Hardware-Simulator/)**

---

## 🌟 Key Features

### 1. 👁️ "See Inside the Circuit" (Microscopic X-Ray Cutaways)
Unlike traditional circuit simulators that only display static schematics, Hardware Simulator lets you peer inside components to watch the fundamental physics in real time:
- **🔋 DC Battery (Chemical Pump)**: Visualizes the internal chemical potential mechanism that separates ions and forces electrons to climb "uphill" against electrostatic Coulomb repulsion.
- **💡 Light Bulb (Tungsten Filament)**: Simulates the incandescent coil heating up and radiating photon wave vectors with dynamic luminous intensity governed by $P = V \cdot I$.
- **⚡ Carbon Resistor (Drude Lattice Scattering)**: Displays the atomic lattice ions vibrating violently as drifting electrons collide, dissipating energy as Joule heat.
- **⫛ Parallel Plate Capacitor (Dielectric E-Field)**: Illustrates electric field flux lines $\vec{E}$ bridging the plates as positive $+Q$ and negative $-Q$ surface charges accumulate.

### 2. ⭐ The INStep Engine (Transient Micro-Stepping)
The **INStep (Interactive Numerical Step)** engine provides laboratory-grade transient analysis:
- **Cycle-by-Cycle Stepping**: Freeze simulation time and advance by discrete micro-steps ($\Delta t = 0.1\,\text{ms}$, $1.0\,\text{ms}$, or $10.0\,\text{ms}$).
- **Drude Drift Speed**: Computes actual physical electron drift velocities in copper conductors ($v_d = \frac{I}{n \cdot e \cdot A} \approx 26.437\,\mu\text{m/s}$ per Ampere).
- **Instantaneous Charge Flux**: Tracks charge transport per discrete micro-step ($\Delta Q = I \cdot \Delta t$).
- **Kirchhoff's Current Law (KCL) Verification**: Verifies algebraic nodal current equilibrium $\sum I_k = 0$ at every junction down to machine epsilon ($10^{-12}\,\text{A}$).
- **Transient Waveform Monitor**: Real-time dual-trace oscilloscope visualizing voltage and current transients across switching and charging events.

### 3. 🛠️ Minimal UI with Maximal Functionality
- **Segmented View Toggles**: Instantly switch between **Lifelike** (tactile 3D components), **👁️ See Inside (X-Ray)**, and **📐 Schematic** (standard IEEE symbols).
- **Current Flow Modes**: Toggle between realistic **🔵 Electrons ($\mathbf{e^-}$)** and classical **🟠 Conventional Current ($I$)**.
- **Virtual Laboratory Instruments**:
  - **Voltmeter**: Draggable digital multimeter with floating flexible red $(+)$ and black $(-)$ test leads.
  - **Ammeter**: Non-contact magnetic sensor ring that reads branch current anywhere it hovers.
- **In-Place Property Tuning**: Click any component to reveal an inline tuner to dynamically adjust resistance ($1 - 100\,\Omega$), voltage ($1 - 36\,\text{V}$), or capacitance.
- **Interactive Wire Drafting**: Click and drag from any terminal to easily route connections.
- **Curated Lab Presets**:
  - *Simple Series Circuit* (Battery + Bulb + Knife Switch)
  - *Parallel Circuit* (Multi-branch KCL current divider)
  - *RC Transient Circuit* (Exponential charging and dielectric saturation)
  - *Short Circuit* (Low-resistance loop with battery warning)

---

## 🔬 Mathematical Physics: Modified Nodal Analysis (MNA)
Hardware Simulator solves arbitrary circuits using Modified Nodal Analysis:
$$\begin{bmatrix} \mathbf{G} & \mathbf{B} \\ \mathbf{C} & \mathbf{D} \end{bmatrix} \begin{bmatrix} \mathbf{v} \\ \mathbf{j} \end{bmatrix} = \begin{bmatrix} \mathbf{i} \\ \mathbf{e} \end{bmatrix}$$
- $\mathbf{G}$: Conductance matrix formulated from resistors, lamps, and closed switches.
- $\mathbf{B}, \mathbf{C}$: Incidence matrices representing independent ideal voltage sources.
- **Capacitors**: Solved transiently using companion Norton equivalent conductances $G_{\text{eq}} = \frac{2C}{\Delta t}$ and history current sources $I_{\text{eq}}$.

---

## 🐍 Standalone Python Engine (`simulator.py`)
A self-contained Python solver is included for command-line experiments, testing, and algorithmic verification:

```bash
# Run the Python MNA & INStep engine demo
python simulator.py
```

Sample output:
```text
⚡ Hardware Simulator: MNA Physics & INStep Transient Engine
---------------------------------------------------------------
🔬 Running INStep Micro-Stepping Analysis (10 steps @ dt=1ms)...
  Step #01 | t=1.0ms | I=0.360A | P=3.24W | v_drift=26.437 µm/s | KCL Balanced: True
  Step #02 | t=2.0ms | I=0.360A | P=3.24W | v_drift=26.437 µm/s | KCL Balanced: True
  Step #03 | t=3.0ms | I=0.360A | P=3.24W | v_drift=26.437 µm/s | KCL Balanced: True
...
✅ Circuit Solved Successfully! Ready for Web PhET Interactive Lab.
```

---

## 💻 Local Web Server
To run the interactive web laboratory locally:

```bash
# Start a local HTTP server
python -m http.server 8000 --directory web

# Open in your browser
http://localhost:8000
```

---

## 🏛️ Lineage: Borrowed & Streamlined from mleoking/PhET
This project directly borrows core algorithmic foundations from [mleoking/PhET](https://github.com/mleoking/PhET) (`circuit-construction-kit`), modernizing and optimizing the codebase:

### 📥 What Was Borrowed & Ported:
1. **`FastMNA.java` & `ObjectOrientedMNA.java`**: Matrix Modified Nodal Analysis formulations ($A \cdot x = z$), nodal conductance stamps, and independent voltage source submatrices.
2. **`ResistorColors.java`**: Exact 4-band IEC color code calculation translating resistance $\Omega$ into dynamic color rings.
3. **`BulbNode.java`**: Authentic bulb anatomy (teardrop dome, tungsten coil, 4-ridge threaded screw collar, radiant ray spikes).
4. **`BatteryNode.java`**: Cylindrical cell anatomy, brass button terminal, and polarity indicators.
5. **`FlameNode.java`**: Short-circuit flame particle system triggering dynamic fire when $|I| > 15\,\text{A}$.
6. **`NonContactAmmeterNode.java` & `VoltmeterModel.java`**: Sensor crosshairs and flexible floating probe leads.

### ✂️ What Was Streamlined & Removed:
- **Removed 1.4+ GB of Legacy Bloat**: Replaced Java Swing, Piccolo2D scenegraphs, and heavy external JARs (Jama, Wicket, JDOM) with a single zero-dependency HTML5 Canvas engine.
- **Removed Grab Bag Gimmicks**: Stripped non-circuit novelty objects (dollar bills, hand, dog, eraser) to maintain a pure, professional engineering lab.
- **Removed XML Serialization Overhead**: Replaced complex XML serialization trees with instantaneous reactive state and curated lab presets.
- **Integrated ⭐ INStep Engine**: Added real-time transient micro-stepping ($\Delta t$), Drude electron drift speeds ($v_d = I / neA$), and live dual-trace oscilloscope monitoring.

---

## 📁 Repository Structure
```
Hardware-Simulator/
├── .github/
│   └── workflows/
│       └── deploy-pages.yml     # Automated GitHub Pages CI/CD workflow
├── docs/                        # Mirror build for GitHub Pages hosting
├── web/
│   ├── index.html               # PhET lab canvas & INStep dashboard
│   ├── style.css                # Dark minimalist laboratory styling
│   └── app.js                   # FastMNA solver, electron particle drift & PhET cutaways
├── simulator.py                 # Pure Python MNA & INStep transient engine
└── README.md                    # Documentation & physical theory
```

---

## 📜 License & Acknowledgments
- Based on algorithms and research from the **PhET Interactive Simulations** project at the University of Colorado Boulder and [mleoking/PhET](https://github.com/mleoking/PhET).
- Hardware Simulator modifications and INStep Engine by [@Akshit2247](https://github.com/Akshit2247).
- Released under MIT License.
