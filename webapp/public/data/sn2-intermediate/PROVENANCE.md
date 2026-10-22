# Iron-assisted SN2 intermediate demo provenance

C12H12FeNO6−; 32 atoms. Method: BP86 / TZVP · IBO.

The source explicitly identifies `LOCAL(IBO)` orbitals. The demo selects occupied, one-based source orbital indices 75, 79, 81, 83.

- Wavefunction: `example-data/trans_b_sn2_intermediate.xml`
- Wavefunction SHA-256: `1b69b33abd8993786d513fe6357a1e8fcffc7e79c9363c393a13f4d8a413ba27`
- Companion calculation input: `example-data/trans_b_SN2_intermediate.inp`
- Input SHA-256: `f4128e163d2ca23d875c92941311e449f1250624cb4c7fbcb66bfb0004853589`

Bundled Molpro LOCAL(IBO) wavefunction; companion input supplies the method and basis.

These four occupied IBOs are the source indices selected in the bundled native demo script.

Companion native demonstration script: `example-data/trans_b_sn2_intermediate.js`.

Localized-orbital energy values copied from XML, not canonical HOMO/LUMO eigenvalues.

Coordinates, source coefficients, signs and occupations are retained. No SCF, orbital localization, core reconstruction or amplitude rescaling is performed.

The display grid is 105 × 74 × 83, with 0.28 bohr spacing and at least 5 bohr margin around the atoms. Cube coordinates use bohr and orbital amplitudes use bohr^(-3/2).

- Display-grid maximum overlap error: 0.001866275789
- Display-grid maximum boundary amplitude: 0.0006427090286
- Minimum supported display isovalue: 0.015
- Finer validation grid: 0.2 bohr spacing, 6 bohr margin
- Finer-grid maximum overlap error: 0.0001658416936
- Finer-grid maximum boundary amplitude: 0.000210307945

Overlap errors are the largest absolute deviations of the sampled overlap matrix from the identity. These numerical checks support visualization fidelity; the display cubes are not intended for quantitative integration or population analysis.

[manifest.json](manifest.json) records each orbital's compressed gzip SHA-256 (`compressedSha256`), decompressed Cube SHA-256 (`cubeSha256`), byte counts, amplitude bounds, grid norm and boundary maximum, plus the XYZ SHA-256. Gzip compression preserves the Cube text and sampled values.

Regenerate the assets and checks from the repository root:

```sh
python3 webapp/scripts/generate_complex_demos.py --demo sn2-intermediate --check
```

Refresh this document from the existing manifest without resampling:

```sh
python3 webapp/scripts/generate_complex_demos.py --demo sn2-intermediate --provenance-only
```
