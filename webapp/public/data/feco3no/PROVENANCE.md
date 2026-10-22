# Iron carbonyl nitrosyl demo provenance

C3FeNO4−; 9 atoms. Method: BP86 / TZVPP · IBO.

The source explicitly identifies `LOCAL(IBO)` orbitals. The demo selects occupied, one-based source orbital indices 37, 38, 41, 42.

- Wavefunction: `example-data/feco3no_ibos_exp2.xml`
- Wavefunction SHA-256: `530348a89f17338d726e4eaf961bb1add487920fdf4e07d30a2f0c4ea8d8c9ef`
- Companion calculation input: `example-data/feco3no_ibos_exp2.inp`
- Input SHA-256: `58e40d11f77e8bdebe968759fb370a511995722af99379f4d8623050e1eaf9b2`

Bundled Molpro LOCAL(IBO) wavefunction; companion input supplies the method and basis.

IBOs 37 and 41 are displayed by the bundled native demo script; 38 and 42 add occupied localized orbitals from the same source.

Companion native demonstration script: `example-data/feco3no_ibos_exp2.js`.

Localized-orbital energy values copied from XML, not canonical HOMO/LUMO eigenvalues.

Coordinates, source coefficients, signs and occupations are retained. No SCF, orbital localization, core reconstruction or amplitude rescaling is performed.

The display grid is 114 × 111 × 119, with 0.16 bohr spacing and at least 5 bohr margin around the atoms. Cube coordinates use bohr and orbital amplitudes use bohr^(-3/2).

- Display-grid maximum overlap error: 0.0003953322717
- Display-grid maximum boundary amplitude: 0.001012399859
- Minimum supported display isovalue: 0.015
- Finer validation grid: 0.14 bohr spacing, 6 bohr margin
- Finer-grid maximum overlap error: 0.0001589298005
- Finer-grid maximum boundary amplitude: 0.0003122196586

Overlap errors are the largest absolute deviations of the sampled overlap matrix from the identity. These numerical checks support visualization fidelity; the display cubes are not intended for quantitative integration or population analysis.

[manifest.json](manifest.json) records each orbital's compressed gzip SHA-256 (`compressedSha256`), decompressed Cube SHA-256 (`cubeSha256`), byte counts, amplitude bounds, grid norm and boundary maximum, plus the XYZ SHA-256. Gzip compression preserves the Cube text and sampled values.

Regenerate the assets and checks from the repository root:

```sh
python3 webapp/scripts/generate_complex_demos.py --demo feco3no --spacing 0.16 --margin 5 --check
```

Refresh this document from the existing manifest without resampling:

```sh
python3 webapp/scripts/generate_complex_demos.py --demo feco3no --provenance-only
```
