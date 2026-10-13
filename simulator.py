"""
Hardware Simulator: Python Modified Nodal Analysis (MNA) & INStep Engine
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
PhET-accurate interactive circuit physics solver with micro-step transient
analysis (INStep), electron drift dynamics, and Kirchhoff's Laws verification.

Author: @Akshit2247
"""

import math
import sys
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional


@dataclass
class Component:
    id: str
    comp_type: str         # 'resistor', 'battery', 'bulb', 'switch', 'capacitor'
    node1: int
    node2: int
    value: float           # Ohms, Volts, Farads
    is_closed: bool = True # For switches
    state: float = 0.0     # Capacitor charge Q or Bulb filament temp
    current: float = 0.0   # Calculated branch current
    voltage_drop: float = 0.0


class CircuitSolver:
    """
    Modified Nodal Analysis (MNA) solver for DC and transient circuits.
    Solves A * x = z where:
      - A is the conductance & voltage constraint matrix
      - x is [node_voltages, voltage_source_currents]
      - z is the independent current/voltage source vector
    """

    def __init__(self):
        self.components: List[Component] = []
        self.num_nodes = 0
        self.ground_node = 0

    def add(self, comp: Component):
        self.components.append(comp)
        self.num_nodes = max(self.num_nodes, comp.node1, comp.node2)

    def solve(self, dt: float = 0.001) -> Dict[str, float]:
        """Solves node potentials and component currents using Gaussian elimination."""
        v_sources = [c for c in self.components if c.comp_type == 'battery' and c.is_closed]
        n = self.num_nodes
        m = len(v_sources)
        size = n + m

        # Initialize matrix A and RHS vector z
        A = [[0.0 for _ in range(size)] for _ in range(size)]
        z = [0.0 for _ in range(size)]

        # 1. Fill conductance contributions (G matrix)
        for c in self.components:
            if not c.is_closed and c.comp_type == 'switch':
                continue

            r = 1e-4  # near zero for ideal switch/wire
            if c.comp_type in ('resistor', 'bulb'):
                r = max(1e-4, c.value)
            elif c.comp_type == 'switch' and c.is_closed:
                r = 1e-4
            elif c.comp_type == 'capacitor':
                # Companion model: Norton equivalent conductance G = 2*C / dt
                g_eq = (2.0 * c.value) / max(1e-6, dt)
                r = 1.0 / g_eq
                # Current source companion history current I_eq = G_eq * V_prev + I_prev
                i_eq = g_eq * c.voltage_drop + c.current
                if c.node1 > 0: z[c.node1 - 1] -= i_eq
                if c.node2 > 0: z[c.node2 - 1] += i_eq

            if c.comp_type != 'battery':
                g = 1.0 / r
                n1, n2 = c.node1, c.node2
                if n1 > 0:
                    A[n1 - 1][n1 - 1] += g
                if n2 > 0:
                    A[n2 - 1][n2 - 1] += g
                if n1 > 0 and n2 > 0:
                    A[n1 - 1][n2 - 1] -= g
                    A[n2 - 1][n1 - 1] -= g

        # 2. Fill voltage source constraints (B and C matrices)
        for idx, src in enumerate(v_sources):
            row = n + idx
            n1, n2 = src.node1, src.node2
            if n1 > 0:
                A[n1 - 1][row] += 1.0
                A[row][n1 - 1] += 1.0
            if n2 > 0:
                A[n2 - 1][row] -= 1.0
                A[row][n2 - 1] -= 1.0
            z[row] = src.value  # V1 - V2 = value

        # Solve system A * x = z via Gaussian elimination with partial pivoting
        x = self._gaussian_solve(A, z, size)

        # Extract node voltages
        voltages = {0: 0.0}
        for i in range(n):
            voltages[i + 1] = x[i] if x else 0.0

        # Calculate branch currents & voltage drops
        for c in self.components:
            v1 = voltages.get(c.node1, 0.0)
            v2 = voltages.get(c.node2, 0.0)
            c.voltage_drop = v1 - v2
            if c.comp_type in ('resistor', 'bulb'):
                c.current = c.voltage_drop / max(1e-4, c.value)
            elif c.comp_type == 'switch':
                c.current = (c.voltage_drop / 1e-4) if c.is_closed else 0.0
            elif c.comp_type == 'battery':
                # Find in voltage sources
                try:
                    s_idx = v_sources.index(c)
                    # Current flowing out of positive terminal (node1) into the circuit
                    c.current = -x[n + s_idx] if x else 0.0
                except ValueError:
                    c.current = 0.0
            elif c.comp_type == 'capacitor':
                g_eq = (2.0 * c.value) / max(1e-6, dt)
                c.current = g_eq * c.voltage_drop - (g_eq * c.voltage_drop + c.current)

        return voltages

    def _gaussian_solve(self, A: List[List[float]], z: List[float], n: int) -> Optional[List[float]]:
        # Augmented matrix
        M = [row[:] + [z[i]] for i, row in enumerate(A)]

        for i in range(n):
            # Pivot
            max_row = max(range(i, n), key=lambda r: abs(M[r][i]))
            if abs(M[max_row][i]) < 1e-12:
                continue
            M[i], M[max_row] = M[max_row], M[i]

            pivot = M[i][i]
            for col in range(i, n + 1):
                M[i][col] /= pivot

            for row in range(n):
                if row != i and abs(M[row][i]) > 1e-12:
                    factor = M[row][i]
                    for col in range(i, n + 1):
                        M[row][col] -= factor * M[i][col]

        return [M[i][n] for i in range(n)]


class INStepEngine:
    """
    ⭐ INStep (Interactive Numerical Step) Transient Micro-Stepper:
    Performs cycle-by-cycle physical time stepping (Delta t),
    calculating instantaneous Drude electron drift velocity,
    charge flux Delta Q, and verifying Kirchhoff's Current Law.
    """

    def __init__(self, solver: CircuitSolver, dt: float = 0.001):
        self.solver = solver
        self.dt = dt
        self.total_time = 0.0
        self.step_count = 0
        self.history: List[Dict[str, float]] = []

    def instep_tick(self) -> Dict[str, float]:
        """Advances simulation by one exact INStep Delta t."""
        self.step_count += 1
        self.total_time += self.dt

        node_v = self.solver.solve(dt=self.dt)

        # Micro-stepping physics metrics
        total_power = sum(abs(c.current * c.voltage_drop) for c in self.solver.components if c.comp_type in ('resistor', 'bulb'))
        e_charge = 1.602e-19  # Coulombs
        electron_density = 8.5e28  # Free electrons/m^3 in copper
        wire_area = 1.0e-6  # 1 mm^2

        main_current = max((abs(c.current) for c in self.solver.components), default=0.0)
        # Drude Model Drift Velocity: v_d = I / (n * e * A)
        drift_velocity = main_current / (electron_density * e_charge * wire_area) if main_current > 1e-6 else 0.0

        # Verify KCL at all active junction nodes
        kcl_residuals = []
        for node in range(1, self.solver.num_nodes + 1):
            node_sum = sum(
                (-c.current if c.comp_type == 'battery' else c.current)
                if c.node1 == node
                else (c.current if c.comp_type == 'battery' else -c.current)
                for c in self.solver.components
                if c.node1 == node or c.node2 == node
            )
            kcl_residuals.append(abs(node_sum))

        max_kcl_error = max(kcl_residuals, default=0.0)

        step_record = {
            "step": self.step_count,
            "time_ms": round(self.total_time * 1000.0, 3),
            "current_amps": round(main_current, 4),
            "total_power_watts": round(total_power, 4),
            "drift_velocity_um_s": round(drift_velocity * 1e6, 3),  # micrometers/s
            "kcl_balance_error": round(max_kcl_error, 6),
            "kcl_verified": max_kcl_error < 1e-4
        }
        self.history.append(step_record)
        return step_record


def build_demo_circuit() -> Tuple[CircuitSolver, INStepEngine]:
    """Builds a classic PhET series circuit: Battery (9V) + Resistor (10 Ohm) + Light Bulb (15 Ohm)."""
    solver = CircuitSolver()
    # Node 1 -> 2: Battery (9.0V)
    solver.add(Component(id="BAT1", comp_type="battery", node1=1, node2=0, value=9.0))
    # Node 1 -> 2: Switch
    solver.add(Component(id="SW1", comp_type="switch", node1=1, node2=2, value=0.0, is_closed=True))
    # Node 2 -> 3: Resistor (10 Ohm)
    solver.add(Component(id="R1", comp_type="resistor", node1=2, node2=3, value=10.0))
    # Node 3 -> 0: Light Bulb (15 Ohm)
    solver.add(Component(id="LAMP1", comp_type="bulb", node1=3, node2=0, value=15.0))

    engine = INStepEngine(solver, dt=0.001)
    return solver, engine


if __name__ == "__main__":
    if sys.platform == "win32":
        try: sys.stdout.reconfigure(encoding="utf-8")
        except: pass

    print("⚡ Hardware Simulator: MNA Physics & INStep Transient Engine")
    print("---------------------------------------------------------------")
    solver, instep = build_demo_circuit()

    print("🔬 Running INStep Micro-Stepping Analysis (10 steps @ dt=1ms)...")
    for _ in range(10):
        res = instep.instep_tick()
        print(f"  Step #{res['step']:02d} | t={res['time_ms']:.1f}ms | I={res['current_amps']:.3f}A | P={res['total_power_watts']:.2f}W | v_drift={res['drift_velocity_um_s']} µm/s | KCL Balanced: {res['kcl_verified']}")

    print("\n✅ Circuit Solved Successfully! Ready for Web PhET Interactive Lab.")
