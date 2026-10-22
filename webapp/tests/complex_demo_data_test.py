"""Source fidelity and numerical checks for the bundled metal-complex demos."""

import ctypes
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "webapp/scripts"))
import generate_demo as demo
import generate_complex_demos as complex_demo


class ComplexDemoDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.examples = []
        for demo_id, config in complex_demo.DEMOS.items():
            directory = ROOT / "webapp/public/data" / demo_id
            cls.examples.append((config, directory, json.loads((directory / "manifest.json").read_text()),
                                 demo.read_wavefunction(ROOT / config["source"])))

    def test_sources_are_occupied_ibos_with_preserved_provenance(self):
        expected = {"feco3no": (9, 312, 42), "re2me8": (34, 472, 52), "sn2-intermediate": (32, 706, 83)}
        for config, directory, manifest, wavefunction in self.examples:
            with self.subTest(demo=manifest["id"]):
                self.assertEqual((manifest["atomCount"], manifest["basisFunctions"], manifest["occupiedOrbitals"]),
                                 expected[manifest["id"]])
                self.assertEqual(wavefunction["setAttributes"]["type"], "LOCAL(IBO)")
                self.assertEqual(manifest["orbitalType"], "LOCAL(IBO)")
                self.assertEqual(manifest["source"]["sha256"],
                                 hashlib.sha256((ROOT / config["source"]).read_bytes()).hexdigest())
                self.assertEqual(manifest["source"]["inputSha256"],
                                 hashlib.sha256((ROOT / config["input"]).read_bytes()).hexdigest())
                xyz = (directory / Path(manifest["xyzUrl"]).name).read_bytes()
                self.assertEqual(manifest["xyzSha256"], hashlib.sha256(xyz).hexdigest())
                xyz_lines = xyz.decode().splitlines()
                self.assertEqual(int(xyz_lines[0]), len(wavefunction["atoms"]))
                self.assertEqual([line.split()[0] for line in xyz_lines[2:]],
                                 [atom["element"] for atom in wavefunction["atoms"]])
                np.testing.assert_allclose(np.array([line.split()[1:] for line in xyz_lines[2:]], dtype=float),
                                           [atom["positionAngstrom"] for atom in wavefunction["atoms"]], atol=5e-10)
                self.assertEqual([o["sourceIndex"] for o in manifest["orbitals"]], list(config["indices"]))
                for orbital in manifest["orbitals"]:
                    attributes = wavefunction["orbitalAttributes"][orbital["sourceIndex"] - 1]
                    self.assertGreater(orbital["occupation"], 0)
                    self.assertEqual(orbital["occupation"], float(attributes["occupation"]))
                    self.assertEqual(orbital["energyHartree"], float(attributes["energy"]))
                if manifest["id"] == "re2me8":
                    self.assertIn("120", manifest["source"]["effectiveCorePotentialNote"])

    def test_validation_grid_is_finer_and_provenance_reproduces_display_grid(self):
        for _, directory, manifest, _ in self.examples:
            with self.subTest(demo=manifest["id"]):
                grid, validation = manifest["grid"], manifest["validation"]
                self.assertLess(validation["fineGridSpacingBohr"], grid["spacingBohr"])
                self.assertGreater(validation["fineGridMarginBohr"], grid["marginBohr"])
                self.assertLess(np.prod(grid["dimensions"]), 5_000_000)
                provenance = (directory / "PROVENANCE.md").read_text()
                self.assertIn(f"--spacing {grid['spacingBohr']:g} --margin {grid['marginBohr']:g} --check",
                              provenance)

    def test_cubes_match_source_samples_geometry_bounds_and_integrals(self):
        rng = np.random.default_rng(217)
        for config, directory, manifest, wavefunction in self.examples:
            columns = []
            for orbital in manifest["orbitals"]:
                with self.subTest(demo=manifest["id"], orbital=orbital["sourceIndex"]):
                    compressed = (directory / Path(orbital["cubeUrl"]).name).read_bytes()
                    raw = gzip.decompress(compressed)
                    self.assertEqual(len(compressed), orbital["compressedBytes"])
                    self.assertEqual(len(raw), orbital["uncompressedBytes"])
                    self.assertLess(len(raw), 35 * 1024 * 1024)
                    self.assertEqual(hashlib.sha256(compressed).hexdigest(), orbital["compressedSha256"])
                    self.assertEqual(hashlib.sha256(raw).hexdigest(), orbital["cubeSha256"])
                    lines = raw.decode().splitlines()
                    atom_count = int(lines[2].split()[0])
                    self.assertEqual(atom_count, manifest["atomCount"])
                    origin = np.array(lines[2].split()[1:], dtype=float)
                    dimensions = np.array([int(lines[3 + axis].split()[0]) for axis in range(3)])
                    steps = np.array([lines[3 + axis].split()[1:] for axis in range(3)], dtype=float)
                    np.testing.assert_allclose(origin, manifest["grid"]["originBohr"])
                    np.testing.assert_array_equal(dimensions, manifest["grid"]["dimensions"])
                    np.testing.assert_allclose(steps, np.eye(3) * manifest["grid"]["spacingBohr"])
                    positions = np.array([line.split()[2:] for line in lines[6:6 + atom_count]], dtype=float)
                    np.testing.assert_allclose(positions, wavefunction["positions"], atol=5e-7)
                    values = np.fromstring(" ".join(lines[6 + atom_count:]), sep=" ")
                    self.assertEqual(len(values), np.prod(dimensions))
                    self.assertTrue(np.all(np.isfinite(values)))
                    random_indices = rng.integers(0, len(values), 80)
                    # Include high-amplitude locations, not just nearly zero tails.
                    sample_indices = np.concatenate((random_indices, np.argsort(np.abs(values))[-80:]))
                    ijk = np.array(np.unravel_index(sample_indices, dimensions)).T
                    expected = demo.evaluate(wavefunction, origin + ijk @ steps,
                                             (orbital["sourceIndex"],))[:, 0]
                    np.testing.assert_allclose(values[sample_indices], expected, atol=5e-8, rtol=1e-6)
                    self.assertGreater(float(values.max()), orbital["isovalue"])
                    self.assertLess(float(values.min()), -orbital["isovalue"])
                    self.assertAlmostEqual(float(values.max()), orbital["maximumAmplitude"], delta=5e-7)
                    self.assertAlmostEqual(float(values.min()), orbital["minimumAmplitude"], delta=5e-7)
                    edge = float(complex_demo.boundary_maxima(values[:, None], dimensions)[0])
                    self.assertAlmostEqual(edge, orbital["boundaryMaximumAmplitude"], delta=5e-9)
                    self.assertLess(edge, manifest["isovalueMin"] / 10)
                    columns.append(values)
            stacked = np.column_stack(columns)
            overlap = stacked.T @ stacked * manifest["grid"]["spacingBohr"] ** 3
            np.testing.assert_allclose(np.diag(overlap), [o["gridNorm"] for o in manifest["orbitals"]], atol=1e-7)
            self.assertLess(np.max(np.abs(overlap - np.eye(len(columns)))), 0.03)
            self.assertLess(manifest["validation"]["maximumOverlapError"], 0.01)
            self.assertLess(manifest["validation"]["maximumBoundaryAmplitude"], manifest["isovalueMin"] / 10)

    def test_sampler_rejects_invalid_or_unbounded_grid(self):
        wavefunction = self.examples[0][3]
        for spacing, margin in ((0, 5), (float("nan"), 5), (0.2, float("inf")), (0.2, -1), (0.001, 5)):
            with self.subTest(spacing=spacing, margin=margin):
                with self.assertRaises(ValueError):
                    complex_demo.sample_bounded_grid(wavefunction, spacing, margin, (37,))

    @unittest.skipUnless(shutil.which("c++"), "C++ compiler unavailable for independent IrCore check")
    def test_spdfg_harmonics_against_actual_ircore_cpp(self):
        with tempfile.TemporaryDirectory(prefix="iboview-g-harmonics-") as directory:
            directory = Path(directory)
            probe = directory / "probe.cpp"
            probe.write_text('''#include <cstdlib>
#include "IrAmrr.h"
void CxAssertFail(char const *, char const *, int) { std::abort(); }
extern "C" void eval_harmonics(double *out, double x, double y, double z) {
    ir::EvalSlcX_Deriv0(out, x, y, z, 4);
}
''')
            library = directory / "harmonics.so"
            subprocess.run([shutil.which("c++"), "-std=c++20", "-O0", "-shared", "-fPIC",
                            "-I" + str(ROOT / "src/Common"), "-I" + str(ROOT / "src/IrCore"),
                            str(probe), str(ROOT / "src/IrCore/IrAmrr.cpp"), "-o", str(library)],
                           check=True, capture_output=True, text=True)
            native = ctypes.CDLL(str(library))
            native.eval_harmonics.argtypes = [ctypes.POINTER(ctypes.c_double)] + [ctypes.c_double] * 3
            points = np.random.default_rng(43).normal(size=(100, 3))
            reference = np.empty((len(points), 25))
            for row, point in zip(reference, points):
                native.eval_harmonics(row.ctypes.data_as(ctypes.POINTER(ctypes.c_double)), *point)
            actual = np.column_stack([demo.solid_harmonics(points, l) for l in range(5)])
            np.testing.assert_allclose(actual, reference, atol=1e-13, rtol=1e-13)


if __name__ == "__main__":
    unittest.main()
