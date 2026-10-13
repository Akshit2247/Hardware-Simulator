# ⚡ Hardware Simulator
> **PhET-Accurate Unified Hardware Physics Suite

[![Live Demo](https://img.shields.io/badge/Live_Demo-GitHub_Pages-00d2ff.svg)](https://akshit2247.github.io/Hardware-Simulator/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Engineered from the ground up for extreme speed and visual clarity, Hardware Simulator replaces gigabytes of legacy Java/Swing/Piccolo bloat with a streamlined, ultra-fast HTML5 Canvas and mathematical physics engine. It features microscopic **"See Inside the Circuit"** X-ray cutaways and the **⭐ INStep Engine** for cycle-by-cycle transient micro-stepping analysis across all 7 hardware laboratories.

---

## 🚀 Live Interactive Laboratory
Experience the live laboratory directly in your browser (no plugins or installation required):  
👉 **[https://akshit2247.github.io/Hardware-Simulator/](https://akshit2247.github.io/Hardware-Simulator/)** *(or [Direct /web mirror](https://akshit2247.github.io/Hardware-Simulator/web))*

---

## 🏛️ The 7-in-1 PhET Hardware Suite

Hardware Simulator unifies all electrical, magnetic, solid-state, and quantum hardware simulations into one cohesive workbench:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                          ⚡ HARDWARE SIMULATOR SUITE                           │
├─────────────┬─────────────┬─────────────┬─────────────┬───────────┬───────────┤
│  ⚡ CIRCUIT  │  🧲 FARADAY │ ⫛ CAPACITOR │ 📏 RESIST.  │  💡 PHOTO │ 🔬 SEMI.  │
│  MNA Solver │  Induction  │  Dielectric │ Drude Model │  Phototub.│ P-N Diode │
└─────────────┴─────────────┴─────────────┴─────────────┴───────────┴───────────┘
```

### 1. ⚡ Circuit Construction Kit (`circuit-construction-kit`)
- **MNA Physics**: Solves linear circuit networks ($A \cdot x = z$) with batteries, resistors, incandescent lamps, capacitors, switches, and zero-resistance wires.
- **Microscopic Drude Drift**: Visualizes blue drift electrons moving at $v_d = \frac{I}{n \cdot e \cdot A} \approx 26.437\,\mu\text{m/s}$ per Ampere.
- **Segmented Views**: Instant toggle between **Lifelike** (tactile 3D components), **👁️ See Inside (X-Ray)**, and **📐 Schematic** (IEEE symbols).
- **Virtual Instruments**: Floating dual-probe digital multimeter and non-contact magnetic ammeter.

### 2. 🧲 Faraday's Electromagnetics Lab (`faraday`)
- **Faraday & Lenz Induction**: Computes magnetic flux $\Phi_B = \vec{B} \cdot \vec{A}$ and induced electromotive force:
  $$\mathcal{E} = -N \frac{d\Phi_B}{dt}$$
- **4 Apparatus Modes**:
  1. *Bar Magnet & Pickup Coil*: Move permanent dipole through $N = 1, 2, 3, 4$ coil turns to deflect galvanometer.
  2. *Electromagnet (DC/AC)*: Solenoid with variable DC or sinusoidal AC excitation ($\sin(\omega t)$).
  3. *Transformer*: Inductive coupling and mutual inductance between primary and secondary windings.
  4. *Water Turbine Generator*: Hydro-powered rotor spinning magnetic dipole to generate clean AC sine wave.

### 3. ⫛ Capacitor Lab (`capacitor-lab`)
- **Adjustable Parallel Plates**: Variable plate area $A$ ($100 - 400\,\text{mm}^2$) and separation $d$ ($2 - 10\,\text{mm}$).
- **Insertable Dielectrics**: Vacuum ($\kappa=1.0$), Teflon ($\kappa=2.1$), Paper ($\kappa=3.5$), Pyrex Glass ($\kappa=5.0$), and Strontium Titanate ($\kappa=10.0$).
- **Electrostatic Field & Energy**:
  $$C = \kappa \frac{\epsilon_0 A}{d}, \quad Q = C \cdot V, \quad U = \frac{1}{2} C V^2, \quad E = \frac{V}{d}$$
- **Discharge Circuit**: Switch between DC charging battery and light bulb for exponential RC decay $V(t) = V_0 e^{-t/RC}$.

### 4. 📏 Wire Resistivity & Drude Model (`resistance-in-a-wire`)
- **Conductor Geometry**: Dynamically scales wire length $L$ ($1 - 20\,\text{cm}$) and cross-sectional area $A$ ($1 - 15\,\text{mm}^2$):
  $$R = \rho \frac{L}{A}$$
- **Drude Lattice Scattering**: Real-time atomic impurity scatterers with collision frequency $f_{\text{coll}} = 1/\tau$, mean free path $\lambda$, and Joule dissipation waves ($P = I^2 R$).

### 5. 💡 Photoelectric Phototube Lab (`photoelectric`)
- **Quantum Mechanics & Work Function**: Monochromatic laser ($\lambda = 200 - 800\,\text{nm}$) illuminating target cathodes: Sodium ($\Phi = 2.28\,\text{eV}$), Calcium, Zinc, Copper, and Platinum.
- **Einstein Photoelectric Equation**:
  $$E_{\text{photon}} = \frac{hc}{\lambda}, \quad K_{\text{max}} = \max(0, E_{\text{photon}} - \Phi)$$
- **Stopping Potential ($V_{\text{stop}}$)**: Reverse battery bias decelerating photoelectrons until photocurrent drops to zero.

### 6. 🔬 Semiconductor & Diode Lab (`semiconductor`)
- **P-N Junction Physics**: P-zone (Acceptors + holes) and N-zone (Donors + free electrons).
- **Shockley Diode Equation**:
  $$I = I_s \left( e^{\frac{q V}{n k_B T}} - 1 \right)$$
- **Depletion Region & Bandgap**: Dynamic space-charge layer narrowing under forward bias and expanding under reverse bias; energy band bending ($E_c, E_v, E_F$) and photon radiation in Gallium Arsenide (LED) mode!

### 7. 📡 Radio Waves & Dipole Lab (`radio-waves`)
- **Oscillating Dipole Transmitter**: Driven electron oscillator emitting concentric electromagnetic waves traveling through space at $c = 3 \times 10^8\,\text{m/s}$.
- **Receiver Antenna**: Pick-up electron experiencing forced oscillation with spatial phase lag $\tau = r / c$, feeding a real-time RF oscilloscope.

---

## ⭐ The INStep Engine (Transient Micro-Stepping)
The **INStep (Interactive Numerical Step)** engine operates across all 7 laboratories:
- **Freeze & Step**: Freeze real-time execution and step cycle-by-cycle ($\Delta t = 0.1\,\text{ms}$, $1.0\,\text{ms}$, $10.0\,\text{ms}$).
- **Live Oscilloscope**: Dual-trace transient monitor logging voltage, current, flux, and wave phase in real time.
- **Physical Verification**: Verifies Kirchhoff's Current Law ($\sum I_k = 0$), Lenz's Law polarity, and capacitor charge conservation.
---

## 💻 Local Execution
To run the web application locally:

```bash
# Start a local web server
python -m http.server 8000 --directory web

# Open in your browser
http://localhost:8000
```

---

## 📁 Repository Structure
```
Hardware-Simulator/
├── .github/
│   └── workflows/
│       └── deploy-pages.yml     # Automated GitHub Pages CI/CD workflow
├── docs/                        # Synchronized GitHub Pages build
│   ├── index.html
│   ├── style.css
│   └── app.js
├── web/                         # Core web laboratory application
│   ├── index.html               # 7-in-1 PhET suite layout & INStep dashboard
│   ├── style.css                # Polished dark theme laboratory styling
│   └── app.js                   # Unified physics engines, stages & INStep solver
├── simulator.py                 # Pure Python 7-in-1 mathematical verification suite
└── README.md                    # Comprehensive documentation & physical lineage
```

---

## 📜 License & Acknowledgments
- Hardware Simulator suite & INStep Engine by [@Akshit2247](https://github.com/Akshit2247).
- Released under the MIT License.
