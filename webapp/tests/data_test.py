"""Scientific regression checks for the bundled orbital demo (NumPy required)."""

import ctypes
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


class DemoDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.wavefunction = demo.read_wavefunction(ROOT / "example-data/benzene.xml")
        cls.directory = ROOT / "webapp/public/data/benzene"
        cls.manifest = json.loads((cls.directory / "manifest.json").read_text())

    def test_source_provenance_and_dimensions(self):
        self.assertEqual(self.manifest["source"]["sha256"],
                         hashlib.sha256((ROOT / "example-data/benzene.xml").read_bytes()).hexdigest())
        self.assertEqual(self.wavefunction["coefficients"].shape, (270, 21))
        self.assertEqual(self.wavefunction["setAttributes"]["type"], "LOCAL(IBO)")
        self.assertEqual(sum(float(a["occupation"]) for a in self.wavefunction["orbitalAttributes"]), 42)
        self.assertLess(self.manifest["validation"]["maximumOverlapError"], 0.0002)
        self.assertLess(self.manifest["validation"]["fineGridSpacingBohr"],
                        self.manifest["grid"]["spacingBohr"])
        self.assertGreater(self.manifest["validation"]["fineGridMarginBohr"],
                           self.manifest["grid"]["marginBohr"])

    def test_cube_values_geometry_and_axis_order(self):
        rng = np.random.default_rng(6)
        for orbital in self.manifest["orbitals"]:
            lines = (self.directory / Path(orbital["cubeUrl"]).name).read_text().splitlines()
            header = lines[2].split()
            atom_count = int(header[0])
            self.assertEqual(atom_count, 12)
            origin = np.array(header[1:], dtype=float)
            shape = tuple(int(lines[3 + axis].split()[0]) for axis in range(3))
            steps = np.array([lines[3 + axis].split()[1:] for axis in range(3)], dtype=float)
            cube_atoms = np.array([line.split()[2:] for line in lines[6:6 + atom_count]], dtype=float)
            np.testing.assert_allclose(cube_atoms, self.wavefunction["positions"], atol=5e-7)
            values = np.fromstring(" ".join(lines[6 + atom_count:]), sep=" ")
            self.assertEqual(len(values), np.prod(shape))
            self.assertTrue(np.all(np.isfinite(values)))
            indices = rng.integers(0, len(values), 100)
            ijk = np.array(np.unravel_index(indices, shape)).T
            points = origin + ijk @ steps
            expected = demo.evaluate(self.wavefunction, points, (orbital["sourceIndex"],))[:, 0]
            np.testing.assert_allclose(values[indices], expected, atol=5e-8, rtol=1e-6)
            self.assertGreater(np.max(values), orbital["isovalue"])
            if orbital["type"] == "pi":
                self.assertLess(np.min(values), -orbital["isovalue"])

    def test_pi_odd_and_sigma_even_reflection(self):
        points = np.random.default_rng(12).uniform(-4, 4, (200, 3))
        values = demo.evaluate(self.wavefunction, points, demo.SELECTION)
        reflected = demo.evaluate(self.wavefunction, points * [1, 1, -1], demo.SELECTION)
        np.testing.assert_allclose(values[:, :3], -reflected[:, :3], atol=1e-12)
        np.testing.assert_allclose(values[:, 3:], reflected[:, 3:], atol=1e-12)

    @unittest.skipUnless(shutil.which("c++"), "C++ compiler unavailable for independent IrCore check")
    def test_harmonics_against_actual_ircore_cpp(self):
        with tempfile.TemporaryDirectory(prefix="iboview-harmonics-") as directory:
            directory = Path(directory)
            probe = directory / "probe.cpp"
            probe.write_text('''#include <cstdlib>
#include "IrAmrr.h"
void CxAssertFail(char const *, char const *, int) { std::abort(); }
extern "C" void eval_harmonics(double *out, double x, double y, double z) {
    ir::EvalSlcX_Deriv0(out, x, y, z, 3);
}
''')
            library = directory / "harmonics.so"
            subprocess.run([shutil.which("c++"), "-std=c++20", "-O0", "-shared", "-fPIC",
                            "-I" + str(ROOT / "src/Common"), "-I" + str(ROOT / "src/IrCore"),
                            str(probe), str(ROOT / "src/IrCore/IrAmrr.cpp"), "-o", str(library)],
                           check=True, capture_output=True, text=True)
            native = ctypes.CDLL(str(library))
            native.eval_harmonics.argtypes = [ctypes.POINTER(ctypes.c_double)] + [ctypes.c_double] * 3
            points = np.random.default_rng(42).normal(size=(40, 3))
            reference = np.empty((len(points), 16))
            for row, point in zip(reference, points):
                native.eval_harmonics(row.ctypes.data_as(ctypes.POINTER(ctypes.c_double)), *point)
            python_values = np.column_stack([demo.solid_harmonics(points, l) for l in range(4)])
            np.testing.assert_allclose(python_values, reference, atol=1e-14, rtol=1e-14)


if __name__ == "__main__":
    unittest.main()
