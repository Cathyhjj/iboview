# Rhenium methyl dimer demo provenance

C8H24Re2²−; 34 atoms. Method: PBE / def2-TZVP · IBO.

The source explicitly identifies `LOCAL(IBO)` orbitals. The demo selects occupied, one-based source orbital indices 41, 50, 51, 52.

- Wavefunction: `example-data/re2me8-dianion.xml`
- Wavefunction SHA-256: `ab95542abec2e1ceedee8894fc9261ce950028fe7e3f9ecae8000752b7eb5c1b`
- Companion calculation input: `example-data/Re2Me8_dianion.inp`
- Input SHA-256: `b2dc0b81a4873c2a3a22855bb12884e47c99b97360dcd639fa55865f06a8c74a`

Bundled Molpro LOCAL(IBO) wavefunction; companion input supplies the method and basis.

Selected occupied IBOs exhibit sigma-like (41), pi-like (50, 51) and delta-like (52) symmetry near the Re-Re midpoint; these descriptions are inferred from source sampling.

The source has 104 explicitly represented electrons, 120 fewer than the full electron count for this dianion. Its ECP-replaced core orbitals are not reconstructed or displayed.

Localized-orbital energy values copied from XML, not canonical HOMO/LUMO eigenvalues.

Coordinates, source coefficients, signs and occupations are retained. No SCF, orbital localization, core reconstruction or amplitude rescaling is performed.

The display grid is 129 × 129 × 131, with 0.16 bohr spacing and at least 5 bohr margin around the atoms. Cube coordinates use bohr and orbital amplitudes use bohr^(-3/2).

- Display-grid maximum overlap error: 1.4617528e-05
- Display-grid maximum boundary amplitude: 0.000596536795
- Minimum supported display isovalue: 0.015
- Finer validation grid: 0.14 bohr spacing, 6 bohr margin
- Finer-grid maximum overlap error: 2.472056677e-06
- Finer-grid maximum boundary amplitude: 0.0002466737414

Overlap errors are the largest absolute deviations of the sampled overlap matrix from the identity. These numerical checks support visualization fidelity; the display cubes are not intended for quantitative integration or population analysis.

[manifest.json](manifest.json) records each orbital's compressed gzip SHA-256 (`compressedSha256`), decompressed Cube SHA-256 (`cubeSha256`), byte counts, amplitude bounds, grid norm and boundary maximum, plus the XYZ SHA-256. Gzip compression preserves the Cube text and sampled values.

Regenerate the assets and checks from the repository root:

```sh
python3 webapp/scripts/generate_complex_demos.py --demo re2me8 --spacing 0.16 --margin 5 --check
```

Refresh this document from the existing manifest without resampling:

```sh
python3 webapp/scripts/generate_complex_demos.py --demo re2me8 --provenance-only
```
