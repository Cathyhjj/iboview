# Benzene orbital demo

The five Cube files sample the actual molecular orbitals in the repository's
`example-data/benzene.xml`; they are not analytic illustrations. The source XML
identifies the orbitals as `RKS`, `LOCAL(IBO)`, closed shell, with 42 electrons.
The companion `example-data/benzene.inp` specifies `basis=tzvpp`, `df-rks,pbe`,
and `ibba, bonds=1`. The wavefunction contains 270 spherical basis functions and
21 occupied orbitals. The JSON manifest records the XML SHA-256.

The selections use one-based source XML indices. IBOs 19, 20, and 21 are the
three occupied π orbitals: they are odd under reflection through the molecular
plane. IBOs 7 and 13 are in-plane σ orbitals, even under that reflection. These
are localized orbitals; the energy attributes copied from XML must not be
presented as canonical HOMO or LUMO eigenvalues. Colors encode amplitude sign
(phase), not positive/negative charge. An overall orbital sign is arbitrary.

`webapp/scripts/generate_demo.py` expands the source basis associations and
evaluates the original orbital coefficients without truncating basis functions,
rotating orbitals, renormalizing, or changing signs. Primitive normalization
matches `src/MicroScf/CtBasisShell.cpp` and `src/IrCore/IrCore.cpp`. Real solid
harmonics through f match the component order of
`src/IrCore/IrAmrr.cpp:EvalSlcX_Deriv0`. A regression test compiles that actual
C++ function and compares it against the Python evaluator at random points.

Geometry in the XML and XYZ is in ångström; basis evaluation and Cube coordinates
are in bohr, using IboView's `0.52917721092` conversion. The Cube field is orbital
amplitude in bohr^(-3/2), not electron density. Grid order is x outermost and z
innermost. The visual grid is 111 × 117 × 59 at 0.16 bohr spacing (about 11.8
points/ångström), with a 4.5-bohr margin; its finite box omits about 0.20% of the
π orbital norm. The sampled π norms are 0.998029–0.998030 and the two σ norms
are 1.000098 and 0.999959. These are finite-grid quadrature results; the orbitals
are not rescaled. A larger, finer integration grid (0.14 bohr, 6 bohr margin)
gives a maximum error of 1.19e-4 in the selected-orbital overlap matrix compared
with the identity.
The three π orbitals have reflection errors below 4e-15. Precise results are
stored in the manifest. The grid is intended for visualization, not quantitative
integration or electronic-structure calculations.

Regenerate from the repository root with Python 3 and NumPy:

```sh
python3 webapp/scripts/generate_demo.py --spacing 0.16 --margin 4.5 --check
python3 -m unittest discover -s webapp/tests -p 'data*.py' -v
```

The browser only consumes the bundled files and requires no Python runtime.
The script deliberately accepts only the spherical s/p/d/f shell subset needed
by this demo; it is not a general Molpro, Molden, or wavefunction importer.
Data and evaluator are distributed under the repository's GPL-3.0 license.
