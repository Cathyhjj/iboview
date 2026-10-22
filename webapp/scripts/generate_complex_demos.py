#!/usr/bin/env python3
"""Sample occupied IBOs from the bundled metal-complex wavefunctions (NumPy).

The source coefficients, signs, occupations and geometry are retained. This
script performs no SCF, localization, ECP reconstruction or renormalization.
"""

from __future__ import annotations

import argparse
from collections import Counter
import gzip
import hashlib
import json
import math
from pathlib import Path
import tempfile

import numpy as np

from generate_demo import ROOT, evaluate, read_wavefunction, write_cube


DEMOS = {
    "feco3no": {
        "name": "Iron carbonyl nitrosyl",
        "source": "example-data/feco3no_ibos_exp2.xml",
        "input": "example-data/feco3no_ibos_exp2.inp",
        "script": "example-data/feco3no_ibos_exp2.js",
        "charge": -1,
        "method": "BP86 / TZVPP · IBO",
        "description": "A compact transition-metal complex with three carbonyl ligands and a nitrosyl ligand.",
        "indices": (37, 38, 41, 42),
        "selectionNote": "IBOs 37 and 41 are displayed by the bundled native demo script; 38 and 42 add occupied localized orbitals from the same source.",
    },
    "re2me8": {
        "name": "Rhenium methyl dimer",
        "source": "example-data/re2me8-dianion.xml",
        "input": "example-data/Re2Me8_dianion.inp",
        "charge": -2,
        "method": "PBE / def2-TZVP · IBO",
        "description": "Two rhenium centers surrounded by eight methyl groups, with four selected metal-centered IBOs.",
        "indices": (41, 50, 51, 52),
        "selectionNote": "Selected occupied IBOs exhibit sigma-like (41), pi-like (50, 51) and delta-like (52) symmetry near the Re-Re midpoint; these descriptions are inferred from source sampling.",
        "effectiveCorePotentialNote": "The source has 104 explicitly represented electrons, 120 fewer than the full electron count for this dianion. Its ECP-replaced core orbitals are not reconstructed or displayed.",
    },
    "sn2-intermediate": {
        "name": "Iron-assisted SN2 intermediate",
        "source": "example-data/trans_b_sn2_intermediate.xml",
        "input": "example-data/trans_b_SN2_intermediate.inp",
        "script": "example-data/trans_b_sn2_intermediate.js",
        "charge": -1,
        "method": "BP86 / TZVP · IBO",
        "description": "A 32-atom reaction intermediate combining an organic fragment with an iron carbonyl nitrosyl complex.",
        "indices": (75, 79, 81, 83),
        "selectionNote": "These four occupied IBOs are the source indices selected in the bundled native demo script.",
    },
}


def sample_bounded_grid(wavefunction: dict, spacing: float, margin: float,
                        indices: tuple[int, ...]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Sample a lattice enclosing all atoms, in Gaussian Cube axis order."""
    if not math.isfinite(spacing) or not math.isfinite(margin) or spacing <= 0 or margin <= 0:
        raise ValueError("Spacing and margin must be finite and positive")
    lower = np.floor((wavefunction["positions"].min(axis=0) - margin) / spacing).astype(int)
    upper = np.ceil((wavefunction["positions"].max(axis=0) + margin) / spacing).astype(int)
    dimensions = upper - lower + 1
    count = math.prod(dimensions.tolist())
    if count > 2_500_000:
        raise ValueError(f"Grid has {count} values; expected at most 2,500,000")
    values = np.empty((count, len(indices)))
    origin = lower * spacing
    for start in range(0, count, 8192):
        stop = min(start + 8192, count)
        ijk = np.array(np.unravel_index(np.arange(start, stop), dimensions)).T
        values[start:stop] = evaluate(wavefunction, origin + ijk * spacing, indices)
    return values, origin, dimensions


def boundary_maxima(values: np.ndarray, dimensions: np.ndarray) -> np.ndarray:
    volume = values.reshape((*dimensions, values.shape[1]))
    faces = (volume[0], volume[-1], volume[:, 0], volume[:, -1], volume[:, :, 0], volume[:, :, -1])
    return np.max([np.max(np.abs(face), axis=(0, 1)) for face in faces], axis=0)


def molecular_formula(wavefunction: dict, charge: int) -> str:
    counts = Counter(atom["element"] for atom in wavefunction["atoms"])
    order = ([element for element in ("C", "H") if element in counts] +
             sorted(set(counts) - {"C", "H"}))
    formula = "".join(element + (str(counts[element]) if counts[element] > 1 else "") for element in order)
    return formula + ({-1: "−", -2: "²−"}.get(charge, ""))


def write_provenance(output: Path, manifest: dict) -> None:
    """Write human-readable provenance from the completed asset manifest."""
    source = manifest["source"]
    grid = manifest["grid"]
    selected = ", ".join(str(orbital["sourceIndex"]) for orbital in manifest["orbitals"])
    dimensions = " × ".join(str(n) for n in grid["dimensions"])
    lines = [
        f"# {manifest['name']} demo provenance", "",
        f"{manifest['formula']}; {manifest['atomCount']} atoms. Method: {manifest['method']}.", "",
        f"The source explicitly identifies `{manifest['orbitalType']}` orbitals. "
        f"The demo selects occupied, one-based source orbital indices {selected}.", "",
        f"- Wavefunction: `{source['file']}`",
        f"- Wavefunction SHA-256: `{source['sha256']}`",
        f"- Companion calculation input: `{source['input']}`",
        f"- Input SHA-256: `{source['inputSha256']}`", "",
        source["description"], "", source["selectionNote"], "",
    ]
    if "script" in source:
        lines.extend([f"Companion native demonstration script: `{source['script']}`.", ""])
    if "effectiveCorePotentialNote" in source:
        lines.extend([source["effectiveCorePotentialNote"], ""])
    lines.extend([
        source["energyNote"], "",
        "Coordinates, source coefficients, signs and occupations are retained. "
        "No SCF, orbital localization, core reconstruction or amplitude rescaling is performed.", "",
        f"The display grid is {dimensions}, with {grid['spacingBohr']:g} bohr spacing "
        f"and at least {grid['marginBohr']:g} bohr margin around the atoms. "
        "Cube coordinates use bohr and orbital amplitudes use bohr^(-3/2).", "",
        f"- Display-grid maximum overlap error: {grid['maximumOverlapError']:.10g}",
        f"- Display-grid maximum boundary amplitude: {grid['maximumBoundaryAmplitude']:.10g}",
        f"- Minimum supported display isovalue: {manifest['isovalueMin']:g}",
    ])
    validation = manifest.get("validation")
    if validation:
        lines.extend([
            f"- Finer validation grid: {validation['fineGridSpacingBohr']:g} bohr spacing, "
            f"{validation['fineGridMarginBohr']:g} bohr margin",
            f"- Finer-grid maximum overlap error: {validation['maximumOverlapError']:.10g}",
            f"- Finer-grid maximum boundary amplitude: {validation['maximumBoundaryAmplitude']:.10g}",
        ])
    else:
        lines.append("- Finer-grid validation was not requested for this generation.")
    lines.extend([
        "", "Overlap errors are the largest absolute deviations of the sampled overlap matrix "
        "from the identity. These numerical checks support visualization fidelity; "
        "the display cubes are not intended for quantitative integration or population analysis.", "",
        "[manifest.json](manifest.json) records each orbital's compressed gzip SHA-256 "
        "(`compressedSha256`), decompressed Cube SHA-256 (`cubeSha256`), byte counts, "
        "amplitude bounds, grid norm and boundary maximum, plus the XYZ SHA-256. "
        "Gzip compression preserves the Cube text and sampled values.", "",
        "Regenerate the assets and checks from the repository root:", "",
        "```sh",
        f"python3 webapp/scripts/generate_complex_demos.py --demo {manifest['id']} --check",
        "```", "",
        "Refresh this document from the existing manifest without resampling:", "",
        "```sh",
        f"python3 webapp/scripts/generate_complex_demos.py --demo {manifest['id']} --provenance-only",
        "```", "",
    ])
    (output / "PROVENANCE.md").write_text("\n".join(lines))


def generate(demo_id: str, output_root: Path, spacing: float = 0.28, margin: float = 5.0,
             check: bool = False) -> dict:
    config = DEMOS[demo_id]
    source = ROOT / config["source"]
    wavefunction = read_wavefunction(source)
    indices = config["indices"]
    if wavefunction["setAttributes"].get("type") != "LOCAL(IBO)":
        raise ValueError("Demo source must explicitly identify LOCAL(IBO) orbitals")
    for index in indices:
        if not 1 <= index <= len(wavefunction["orbitalAttributes"]):
            raise ValueError(f"Invalid source orbital index {index}")
        if float(wavefunction["orbitalAttributes"][index - 1]["occupation"]) <= 0:
            raise ValueError(f"Selected orbital {index} is not occupied")
    values, origin, dimensions = sample_bounded_grid(wavefunction, spacing, margin, indices)
    if not np.all(np.isfinite(values)):
        raise ValueError("Nonfinite sampled amplitudes")
    overlap = values.T @ values * spacing ** 3
    edges = boundary_maxima(values, dimensions)
    if np.max(edges) >= 0.0015:
        raise ValueError("Grid boundary reaches 10% of the minimum display isovalue; increase margin")
    if np.max(np.abs(overlap - np.eye(len(indices)))) > 0.03:
        raise ValueError("Display-grid overlap error exceeds 0.03; reduce spacing or inspect source")
    output = output_root / demo_id
    output.mkdir(parents=True, exist_ok=True)
    orbitals = []
    for column, index in enumerate(indices):
        attributes = wavefunction["orbitalAttributes"][index - 1]
        filename = f"ibo-{index:02d}.cube.gz"
        with tempfile.TemporaryDirectory(prefix="iboview-cube-") as temp:
            cube_path = Path(temp) / "orbital.cube"
            write_cube(cube_path, wavefunction, values[:, column], origin, dimensions, spacing, index,
                       f"{config['name']} IBO {index}; sampled from {config['source']}")
            raw = cube_path.read_bytes()
        if len(raw) >= 35 * 1024 * 1024:
            raise ValueError(f"Cube {filename} exceeds the browser parser's 35 MiB limit")
        compressed = gzip.compress(raw, compresslevel=9, mtime=0)
        (output / filename).write_bytes(compressed)
        orbitals.append({
            "id": f"ibo-{index:02d}", "label": f"IBO {index}", "sourceIndex": index,
            "type": "localized", "description": f"Occupied localized orbital {index} from the bundled {config['name'].lower()} wavefunction.",
            "occupation": float(attributes["occupation"]), "energyHartree": float(attributes["energy"]),
            "cubeUrl": f"/data/{demo_id}/{filename}", "isovalue": 0.045,
            "gridNorm": float(overlap[column, column]),
            "boundaryMaximumAmplitude": float(edges[column]),
            "minimumAmplitude": float(values[:, column].min()),
            "maximumAmplitude": float(values[:, column].max()),
            "cubeSha256": hashlib.sha256(raw).hexdigest(),
            "compressedSha256": hashlib.sha256(compressed).hexdigest(),
            "uncompressedBytes": len(raw), "compressedBytes": len(compressed),
        })
    xyz = [str(len(wavefunction["atoms"])), f"{config['name']} from {config['source']}; coordinates in angstrom"]
    for atom in wavefunction["atoms"]:
        xyz.append(atom["element"] + " " + " ".join(f"{v:.9f}" for v in atom["positionAngstrom"]))
    xyz_text = "\n".join(xyz) + "\n"
    (output / f"{demo_id}.xyz").write_text(xyz_text)
    source_metadata = {
        "file": config["source"], "input": config["input"],
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "inputSha256": hashlib.sha256((ROOT / config["input"]).read_bytes()).hexdigest(),
        "description": "Bundled Molpro LOCAL(IBO) wavefunction; companion input supplies the method and basis.",
        "selectionNote": config["selectionNote"],
        "energyNote": "Localized-orbital energy values copied from XML, not canonical HOMO/LUMO eigenvalues.",
    }
    for key in ("script", "effectiveCorePotentialNote"):
        if key in config:
            source_metadata[key] = config[key]
    manifest = {
        "id": demo_id, "name": config["name"], "description": config["description"],
        "formula": molecular_formula(wavefunction, config["charge"]), "charge": config["charge"],
        "atomCount": len(wavefunction["atoms"]), "xyzUrl": f"/data/{demo_id}/{demo_id}.xyz",
        "xyzSha256": hashlib.sha256(xyz_text.encode()).hexdigest(), "defaultOrbitalId": orbitals[0]["id"],
        "method": config["method"], "orbitalType": wavefunction["setAttributes"]["type"],
        "basisFunctions": wavefunction["basisFunctions"],
        "occupiedOrbitals": sum(float(o["occupation"]) > 0 for o in wavefunction["orbitalAttributes"]),
        "source": source_metadata, "isovalueMin": 0.015,
        "grid": {
            "dimensions": dimensions.tolist(), "originBohr": origin.tolist(), "spacingBohr": spacing,
            "marginBohr": margin, "coordinateUnit": "bohr", "valueUnit": "bohr^(-3/2)",
            "normalization": "Source coefficients and signs retained; no rescaling.",
            "maximumOverlapError": float(np.max(np.abs(overlap - np.eye(len(indices))))),
            "maximumBoundaryAmplitude": float(edges.max()),
        },
        "orbitals": orbitals,
    }
    if check:
        fine_spacing = 0.20
        fine, _, fine_dimensions = sample_bounded_grid(wavefunction, fine_spacing, margin + 1, indices)
        fine_overlap = fine.T @ fine * fine_spacing ** 3
        error = float(np.max(np.abs(fine_overlap - np.eye(len(indices)))))
        if error > 0.01:
            raise ValueError(f"Fine-grid overlap error {error:.6g} exceeds 0.01")
        manifest["validation"] = {
            "fineGridSpacingBohr": fine_spacing, "fineGridMarginBohr": margin + 1,
            "fineGridDimensions": fine_dimensions.tolist(), "maximumOverlapError": error,
            "fineGridOrbitalNorms": np.diag(fine_overlap).tolist(),
            "maximumBoundaryAmplitude": float(boundary_maxima(fine, fine_dimensions).max()),
        }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    write_provenance(output, manifest)
    print(json.dumps({"id": demo_id, "grid": manifest["grid"], "validation": manifest.get("validation"),
                      "compressedBytes": sum(o["compressedBytes"] for o in orbitals)}, indent=2), flush=True)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo", choices=list(DEMOS) + ["all"], default="all")
    parser.add_argument("--output-root", type=Path, default=ROOT / "webapp/public/data")
    parser.add_argument("--spacing", type=float, default=0.28, help="Display grid step in bohr")
    parser.add_argument("--margin", type=float, default=5.0, help="Margin around all atoms in bohr")
    parser.add_argument("--check", action="store_true", help="Also integrate a finer grid with a larger margin")
    parser.add_argument("--provenance-only", action="store_true", help="Refresh provenance documents from existing manifests without resampling")
    args = parser.parse_args()
    for demo_id in DEMOS if args.demo == "all" else [args.demo]:
        if args.provenance_only:
            output = args.output_root / demo_id
            write_provenance(output, json.loads((output / "manifest.json").read_text()))
        else:
            generate(demo_id, args.output_root, args.spacing, args.margin, args.check)
