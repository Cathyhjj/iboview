#!/usr/bin/env python3
"""Sample the repository's benzene Molpro IBO wavefunction (requires NumPy).

This deliberately supports only spherical s/p/d/f/g shells and one orbital set.
Its normalization and solid-harmonic order follow the existing IboView reader
and IrCore evaluator; it does not perform SCF or orbital localization.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BOHR_ANGSTROM = 0.52917721092  # CxPhysicalUnits.h: Molpro/CODATA 2010 convention.
NS = {"m": "http://www.molpro.net/schema/molpro-output", "c": "http://www.xml-cml.org/schema"}
XLINK = "{http://www.w3.org/1999/xlink}href"
SELECTION = (19, 20, 21, 7, 13)  # One-based indices in the source XML.


@dataclass
class Shell:
    atom_index: int
    l: int
    exponents: np.ndarray
    contractions: np.ndarray


def primitive_normalization(exponents: np.ndarray, l: int) -> np.ndarray:
    """Inverse of ir::RawGaussNorm, including the Slm radial normalization."""
    double_factorial = math.prod(range(1, 2 * l, 2))
    return (2 * exponents / np.pi) ** 0.75 * np.sqrt((4 * exponents) ** l / double_factorial)


def solid_harmonics(points: np.ndarray, l: int) -> np.ndarray:
    """Real solid harmonics in IrAmrr.cpp EvalSlcX_Deriv0 component order."""
    x, y, z = points.T
    if l == 0:
        return np.ones((len(points), 1))
    if l == 1:
        return points.copy()
    xx, yy, zz = x * x, y * y, z * z
    rr = xx + yy + zz
    if l == 2:
        return np.column_stack(((3 * zz - rr) / 2, np.sqrt(3) * x * y,
                                np.sqrt(3) * x * z, np.sqrt(3) / 2 * (xx - yy),
                                np.sqrt(3) * y * z))
    if l == 3:
        return np.column_stack((np.sqrt(3 / 8) * x * (5 * zz - rr),
                                np.sqrt(3 / 8) * y * (5 * zz - rr),
                                z * (5 * zz - 3 * rr) / 2,
                                np.sqrt(5 / 8) * x * (xx - 3 * yy),
                                np.sqrt(15) * x * y * z,
                                np.sqrt(5 / 8) * y * (3 * xx - yy),
                                np.sqrt(15) / 2 * z * (xx - yy)))
    if l == 4:
        d = solid_harmonics(points, 2)
        f = solid_harmonics(points, 3)
        return np.column_stack((
            1.75 * f[:, 2] * z - 0.75 * d[:, 0] * rr,
            np.sqrt(5) / 2 * x * y * (7 * zz - rr),
            z * (7 * np.sqrt(15) / 15 * f[:, 0] - 2 * np.sqrt(10) / 5 * rr * x),
            np.sqrt(14) / 4 * (f[:, 3] * x - f[:, 5] * y),
            z * (7 * np.sqrt(15) / 15 * f[:, 1] - 2 * np.sqrt(10) / 5 * rr * y),
            7 * np.sqrt(3) / 6 * f[:, 6] * z - np.sqrt(15) / 6 * d[:, 3] * rr,
            np.sqrt(14) / 4 * (f[:, 3] * y + f[:, 5] * x),
            np.sqrt(7) * f[:, 3] * z,
            np.sqrt(7) * f[:, 5] * z))
    raise ValueError(f"Only s/p/d/f/g shells are supported, got l={l}")


def association_ids(node: ET.Element, kind: str) -> list[str]:
    href = node.attrib[XLINK]
    selector = href.split(f"//{kind}[", 1)[1]
    return re.findall(r"@id=['\"]([^'\"]+)['\"]", selector)


def read_wavefunction(path: Path) -> dict:
    molecule = ET.parse(path).getroot().find("m:molecule", NS)
    atoms_xml = molecule.findall("c:molecule/c:atomArray/c:atom", NS)
    if not atoms_xml:
        atoms_xml = molecule.findall("c:atomArray/c:atom", NS)
    if not atoms_xml:
        raise ValueError("Molpro wavefunction has no atom coordinates")
    atoms = [{"id": atom.attrib["id"], "element": atom.attrib["elementType"],
              "positionAngstrom": [float(atom.attrib[k]) for k in ("x3", "y3", "z3")]}
             for atom in atoms_xml]
    basis = molecule.find("m:basisSet[@id='ORBITAL']", NS)
    if basis.attrib["angular"] != "spherical":
        raise ValueError("Expected a spherical Molpro basis")
    groups = {}
    for group in basis.findall("m:basisGroup", NS):
        l = int(group.attrib["minL"])
        if l != int(group.attrib["maxL"]) or not 0 <= l <= 4:
            raise ValueError("Only unmixed spherical s/p/d/f/g shells are supported")
        exponents = np.fromstring(group.find("m:basisExponents", NS).text, sep=" ")
        contractions = np.array([np.fromstring(c.text, sep=" ")
                                 for c in group.findall("m:basisContraction", NS)])
        if contractions.shape != (int(group.attrib["contractions"]), int(group.attrib["primitives"])):
            raise ValueError("Contraction coefficient count does not match basis metadata")
        groups[group.attrib["id"]] = (l, exponents, contractions)
    assignments = {atom["id"]: [] for atom in atoms}
    for association in basis.findall("m:association", NS):
        group_ids = association_ids(association.find("m:bases", NS), "basisGroup")
        for atom_id in association_ids(association.find("m:atoms", NS), "atom"):
            assignments[atom_id].extend(group_ids)
    shells = []
    for atom_index, atom in enumerate(atoms):
        for group_id in assignments[atom["id"]]:
            l, exponents, contractions = groups[group_id]
            shells.append(Shell(atom_index, l, exponents,
                                contractions * primitive_normalization(exponents, l)))
    orbital_sets = molecule.findall("m:orbitals", NS)
    if len(orbital_sets) != 1 or orbital_sets[0].attrib["angular"] != "spherical":
        raise ValueError("Expected one spherical orbital set")
    orbitals_xml = orbital_sets[0].findall("m:orbital", NS)
    coefficients = np.column_stack([np.fromstring(o.text, sep=" ") for o in orbitals_xml])
    n_functions = sum((2 * s.l + 1) * len(s.contractions) for s in shells)
    if coefficients.shape[0] != n_functions or n_functions != int(basis.attrib["length"]):
        raise ValueError("AO coefficient count does not match the expanded basis")
    positions = np.array([atom["positionAngstrom"] for atom in atoms]) / BOHR_ANGSTROM
    return {"atoms": atoms, "positions": positions, "shells": shells,
            "coefficients": coefficients, "orbitalAttributes": [dict(o.attrib) for o in orbitals_xml],
            "setAttributes": dict(orbital_sets[0].attrib), "basisFunctions": n_functions}


def evaluate(wavefunction: dict, points: np.ndarray, orbital_indices: tuple[int, ...]) -> np.ndarray:
    """Evaluate unmodified source orbitals; input points are in bohr."""
    coefficients = wavefunction["coefficients"][:, np.array(orbital_indices) - 1]
    values = np.zeros((len(points), len(orbital_indices)))
    offset = 0
    for shell in wavefunction["shells"]:
        displacement = points - wavefunction["positions"][shell.atom_index]
        radius_squared = np.einsum("ij,ij->i", displacement, displacement)
        radial = np.exp(-radius_squared[:, None] * shell.exponents) @ shell.contractions.T
        angular = solid_harmonics(displacement, shell.l)
        basis_values = (radial[:, :, None] * angular[:, None, :]).reshape(len(points), -1)
        values += basis_values @ coefficients[offset:offset + basis_values.shape[1]]
        offset += basis_values.shape[1]
    return values


def sample_grid(wavefunction: dict, spacing: float, margin: float,
                indices: tuple[int, ...] = SELECTION) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    half_steps = np.ceil((np.max(np.abs(wavefunction["positions"]), axis=0) + margin) / spacing).astype(int)
    axes = [np.arange(-n, n + 1) * spacing for n in half_steps]
    shape = tuple(len(axis) for axis in axes)
    values = np.empty((math.prod(shape), len(indices)))
    # Gaussian Cube ordering: x outermost, z innermost.
    for start in range(0, len(values), 8192):
        stop = min(start + 8192, len(values))
        ijk = np.unravel_index(np.arange(start, stop), shape)
        points = np.column_stack([axis[index] for axis, index in zip(axes, ijk)])
        values[start:stop] = evaluate(wavefunction, points, indices)
    return values, -half_steps * spacing, np.array(shape)


def write_cube(path: Path, wavefunction: dict, values: np.ndarray, origin: np.ndarray,
               dimensions: np.ndarray, spacing: float, orbital_index: int,
               title: str | None = None) -> None:
    atomic_numbers = {"H": 1, "B": 5, "C": 6, "N": 7, "O": 8, "S": 16, "Fe": 26, "Re": 75}
    with path.open("w") as cube:
        cube.write((title or f"Benzene IBO {orbital_index}; sampled from example-data/benzene.xml") + "\n")
        cube.write("Orbital amplitude in bohr^(-3/2); all coordinates and grid steps in bohr\n")
        cube.write(f"{len(wavefunction['atoms']):5d}" + "".join(f"{x:13.6f}" for x in origin) + "\n")
        for axis in range(3):
            step = np.eye(3)[axis] * spacing
            cube.write(f"{dimensions[axis]:5d}" + "".join(f"{x:13.6f}" for x in step) + "\n")
        for atom, position in zip(wavefunction["atoms"], wavefunction["positions"]):
            number = atomic_numbers[atom["element"]]
            cube.write(f"{number:5d}{float(number):13.6f}" + "".join(f"{x:13.6f}" for x in position) + "\n")
        for start in range(0, len(values), 6):
            cube.write(" ".join(f"{value:.6e}" for value in values[start:start + 6]) + "\n")


def generate(output: Path, spacing: float, margin: float, check: bool) -> None:
    source = ROOT / "example-data/benzene.xml"
    wavefunction = read_wavefunction(source)
    values, origin, dimensions = sample_grid(wavefunction, spacing, margin)
    overlap = values.T @ values * spacing ** 3
    output.mkdir(parents=True, exist_ok=True)
    labels = ("π IBO 19", "π IBO 20", "π IBO 21", "σ IBO 07", "σ IBO 13")
    orbitals = []
    for column, (index, label) in enumerate(zip(SELECTION, labels)):
        attributes = wavefunction["orbitalAttributes"][index - 1]
        filename = f"ibo-{index:02d}.cube"
        write_cube(output / filename, wavefunction, values[:, column], origin, dimensions, spacing, index)
        orbitals.append({"id": f"ibo-{index:02d}", "label": label, "sourceIndex": index,
                         "type": "pi" if index >= 19 else "sigma",
                         "description": ("Localized π orbital with opposite phases above and below the ring."
                                         if index >= 19 else "Localized in-plane σ bonding orbital."),
                         "occupation": float(attributes["occupation"]),
                         "energyHartree": float(attributes["energy"]),
                         "cubeUrl": f"/data/benzene/{filename}", "isovalue": 0.045,
                         "gridNorm": float(overlap[column, column])})
    xyz = [str(len(wavefunction["atoms"])), "Benzene from example-data/benzene.xml; coordinates in angstrom"]
    for atom in wavefunction["atoms"]:
        xyz.append(atom["element"] + " " + " ".join(f"{v:.9f}" for v in atom["positionAngstrom"]))
    (output / "benzene.xyz").write_text("\n".join(xyz) + "\n")
    manifest = {"id": "benzene", "name": "Benzene", "formula": "C6H6", "atomCount": 12,
                "xyzUrl": "/data/benzene/benzene.xyz", "defaultOrbitalId": "ibo-19",
                "method": "PBE / TZVPP · IBO", "orbitalType": "LOCAL(IBO)",
                "basisFunctions": wavefunction["basisFunctions"], "occupiedOrbitals": 21,
                "source": {"file": "example-data/benzene.xml", "input": "example-data/benzene.inp",
                           "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                           "description": "Bundled Molpro RKS LOCAL(IBO) wavefunction; companion input specifies PBE and TZVPP.",
                           "energyNote": "Localized-orbital energy values copied from XML, not canonical HOMO/LUMO eigenvalues."},
                "grid": {"dimensions": dimensions.tolist(), "originBohr": origin.tolist(),
                         "spacingBohr": spacing, "coordinateUnit": "bohr", "valueUnit": "bohr^(-3/2)",
                         "normalization": "Source coefficients and signs retained; no rescaling.",
                         "maximumOverlapError": float(np.max(np.abs(overlap - np.eye(len(SELECTION)))))},
                "orbitals": orbitals}
    if check:
        fine_spacing = 0.15
        fine, _, _ = sample_grid(wavefunction, fine_spacing, 6.0)
        fine_overlap = fine.T @ fine * fine_spacing ** 3
        error = float(np.max(np.abs(fine_overlap - np.eye(len(SELECTION)))))
        if error > 0.005:
            raise ValueError(f"Fine-grid orthonormality error {error:.6g} exceeds 0.005")
        # Planar π orbitals must be odd under reflection across the molecular plane.
        points = np.random.default_rng(21).uniform(-4, 4, (100, 3))
        mirrored = points * [1, 1, -1]
        reflection_error = float(np.max(np.abs(evaluate(wavefunction, points, SELECTION[:3]) +
                                               evaluate(wavefunction, mirrored, SELECTION[:3]))))
        if reflection_error > 1e-10:
            raise ValueError(f"Pi-plane reflection check failed: {reflection_error}")
        manifest["validation"] = {"fineGridSpacingBohr": fine_spacing,
                                  "fineGridMarginBohr": 6.0,
                                  "maximumOverlapError": error,
                                  "piReflectionError": reflection_error,
                                  "fineGridOrbitalNorms": np.diag(fine_overlap).tolist()}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"dimensions": dimensions.tolist(), "gridOverlap": overlap.tolist(),
                      "validation": manifest.get("validation"), "output": str(output)}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "webapp/public/data/benzene")
    parser.add_argument("--spacing", type=float, default=0.20, help="Grid step in bohr")
    parser.add_argument("--margin", type=float, default=4.5, help="Margin around atoms in bohr")
    parser.add_argument("--check", action="store_true", help="Also integrate a finer grid and check π parity")
    args = parser.parse_args()
    if args.spacing <= 0 or args.margin <= 0:
        parser.error("Spacing and margin must be positive")
    generate(args.output, args.spacing, args.margin, args.check)
