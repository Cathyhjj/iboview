# IboView Web

A first browser version of IboView's structure and orbital viewer. The interface
uses Dr.XAS's Figtree typography, warm white surfaces and violet accents.
Night mode follows Dr.XAS's charcoal surfaces and lighter violet accents, including
the 3D background, depth fade, atom labels and PNG export. The header toggle remembers
your choice locally; the first visit follows the system appearance.

## Run

From this directory, with Node.js 20.19+ or 22.12+:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The server binds only to the local machine. For a
production build, run `npm run build`, then `npm run preview`. The `dist/`
directory can be served by an ordinary static web server, including under a
subdirectory. No API server, external fonts, CDN scripts or Python runtime is
needed by the browser.

## Included

- Benzene from `example-data/benzene.xml`: three occupied π IBOs and two σ IBOs.
- Three metal-complex demos, with four occupied IBOs each: iron carbonyl nitrosyl
  (9 atoms), a rhenium methyl dimer (34 atoms), and an iron-assisted SN2
  intermediate (32 atoms). Switch molecules with the **Demo example** menu.
- Interactive rotation, zoom, pan, top/side views and optional continuous rotation.
  The last view is remembered per molecular geometry, including after refresh;
  Reset view replaces it with the default view. The last demo reopens automatically;
  each demo remembers its own selected orbital when switching examples, refreshing,
  or reopening the page. Reopen an imported file to recover its view; browser preferences
  do not retain file contents. Save a project to keep the data and settings together.
- Shiny chic, Extra shiny and Soft studio lighting; opacity and isovalue controls.
  Isovalue and orbital-surface visibility are remembered separately for each
  molecular geometry, including across reloads and orbital changes. Reopening a
  Cube file restores these settings; XYZ-only imports do not replace them.
  Explicit settings in an opened project take precedence over browser preferences.
- Orbital color ramps from Dr.XAS, with palette reversal, adjustable color range,
  and individual positive/negative color pickers. Color changes preserve the
  isosurface geometry and camera; PNG exports use the selected colors.
  The picker groups solid phase pairs under Two-color and continuous maps under
  Gradient. Gradient maps add a gentle neighboring-color tint at lobe tips.
- Separate Molecule and Orbital appearance tabs, with six illustrated molecular
  presets: Original, Studio, Porcelain, Skeleton, Jewel and Silver.
- Ball-and-stick, sticks, wireframe, space filling and separate spheres. Adjust
  atom size, hydrogen size, bond thickness, sculpted/cylindrical bonds and visibility.
- Native, Studio, Pastel, Vivid and single-color atom palettes, editable element
  colors, element-colored or single-color bonds, and independent atom finishes.
  Each molecular geometry remembers its own palettes, gradient extent/strength,
  opacity, orbital and atom materials, representation, sizes, bonds and labels.
  Switching molecules, refreshing, or reopening a file restores that geometry's
  appearance. New geometries start from the previously saved global preferences;
  applying a config or opening a project updates only the current geometry's
  appearance. Reset molecular appearance with the Molecule panel's reset button.
  Sizes change display geometry, not coordinates or distance-inferred connectivity.
- Local single-frame XYZ and single-field Gaussian Cube import, including Bohr/Å
  grids, skew grids and Fortran D exponents. Files are read in the browser.
- PNG export of the current rendered view, including labels when enabled.
  **Resolution** below **Export PNG** selects 1×, 2× or 4× the current view's
  pixel width and height, with a fresh render at the selected size. It defaults
  to 4× and remembers your last selection in this browser across reloads.
  **Transparent background** below **Export PNG** is enabled by default and
  remembers your choice in this browser across reloads. Uncheck it to use the
  current light/night background.
  **Crop transparent margins** trims fully transparent space around the rendered
  molecule, orbitals and labels. It is off by default and remembers your last
  choice across reloads. It is available when **Transparent background** is on;
  turning transparency off keeps your crop preference for the next transparent export.
- **Export HTML** downloads a single offline `.html` viewer of the current molecule
  and visible orbital. It embeds the exact rendered meshes, vertex colors, original
  shaders, materials, opacity, labels, font, theme and camera. No server, CDN,
  external files or browser storage is required; WebGL 2 is required. Drag to rotate,
  scroll or use +/− to zoom, and use Auto rotate / Pause rotation. Reset view restores
  the exported camera. The initial automatic-rotation state follows the workspace.
  The export dialog also provides an iframe snippet: upload the HTML alongside your
  webpage, or change its `src` to the hosted URL. The host must permit script-enabled
  iframes. Exported views are limited to 25 MB for Figure Editor import compatibility.
  Use **Import HTML chart** in Figure Editor, then double-click the placed view to
  interact. Save snapshot retains a static preview; Figure Editor's existing static
  exports, including HTML report, still use that snapshot. Reopening interaction
  restores the exported view. HTML includes only the selected, already-computed
  surface; use the editable project below to change orbitals or isovalue.
- **Save Project** stores the current project in this browser; later saves update
  the same project. **Save As** creates an independent named copy. **Projects**
  opens a searchable list with names, molecular formulas, sizes and saved times.
  Open a listed project after a reload without importing its file again. Removing
  a saved project requires confirmation and leaves the current workspace open.
  Projects use IndexedDB, with metadata listed separately from the larger data.
  Storage failures are reported without replacing the previous saved copy.
  Projects are local to this site and browser profile; clearing site data removes
  them. Use **Export project file** or **Save file as…** for a portable backup.
  A saved project includes molecular coordinates, scalar grids, the selected orbital, molecular and
  orbital appearance, isovalue, visibility, theme, and camera rotation/zoom/pan.
  Demo projects include every orbital in their list, so reopening and switching
  those orbitals does not require fetching demo data. **Open file** restores a
  `.iboview.json` project and adds it to the browser list; repeated imports of
  the same named file contents reuse its entry. Project files support up to 200 MB;
  molecular imports retain the 35 MB limit below.
  In browsers supporting native file access, **Save file** writes back to the file
  chosen or opened in this page session; **Save file as…** chooses another destination.
  Other browsers download a copy. File access is not retained across page reloads.
  Cmd/Ctrl+S saves to the browser; Cmd/Ctrl+Shift+S opens Save As.
- **Save Config** stores named presets in this browser. Use **Saved configs**
  to switch appearances in any project, including after a page reload. Saving
  the same name updates that preset; the menu shows Custom appearance after edits.
  **Load Config** imports a reusable `.iboview-config.json` file and adds it to the
  menu; a conflicting imported name gets a numbered suffix. **Download file** in
  the save dialog exports the current config for another browser or a backup.
  The trash button removes a saved preset after confirmation, keeping the current
  appearance. Browser presets are local to this site and browser profile; clearing
  site data removes them. Configs include molecular and
  orbital palettes, custom element/phase/bond colors, gradient ranges and effects,
  representation, sizes, materials, opacity, atom/bond visibility, labels and theme.
  Loading a config keeps the target project's molecular data, selected orbital,
  isovalue, orbital-surface visibility, rotation state and camera. Config files
  contain no molecular data and are limited to 64 KB. Up to 100 named configs can
  be saved in the browser; current settings also use the existing browser preferences.

The parser rejects malformed input, multiple fields/frames, ghost atoms, files
over 35 MB, structures with 2,000 or more atoms and grids with 5,000,000 or more
points. Bonds are inferred from distances with IboView's native covalent radii
and cutoff; explicit bond orders and multiple-bond decorations are not imported.

## Rendering provenance

`src/render/NativeIboRenderer.ts` is a WebGL2 port of the rendering subset of
`src/IboView/IvView3D.cpp`. It imports these original files directly at build time:

- `shader/vertex5.glsl` and `shader/vertex5_pass.glsl`
- `shader/pixel_common.glsl` and `shader/pixel5.glsl`
- `shader/pixel5_orb_dp.glsl` and `shader/pixel5_combine_dp.glsl`
- `shader/pixel5_fakeAA2.glsl` for the final antialiasing pass

A GLSL ES 3.00 version/precision prelude is added to the original shader bodies;
the FXAA shader also has C-style float literal suffixes removed for GLSL ES. The
browser adapter makes the depth-fade target a background-color uniform for night
mode. This preserves the three-light shading, 16/64-power specular highlights,
view-dependent rim opacity, depth fade and back-to-front depth peeling. The web
renderer uses 32-bit float depth textures and 12 layers, with native back-face
culling and blending. Material registers come from the bundled `resources/`
presets. It requires WebGL2 and renders at device pixel ratio, capped at 2× and
4096 pixels per axis. The original FXAA postpass smooths the final image.

`src/render/geometry.ts` ports the original cube-edge links, contour tracing and
triangle fans from `IvIsoSurface.cpp`. Atom icospheres, tapered bond cylinders,
element colors and radii follow `IvMesh.cpp`, `IvView3D.cpp` and the native atom
tables. Atom spheres use subdivision level 4 for up to 256 visible atoms and
native level 3 for larger imports; bonds use 48 radial segments for smoother
close-up silhouettes without changing radii or connectivity.
Orbital surfaces use a tensor Catmull–Rom interpolant with three subdivisions
per source-grid axis and analytic interpolant gradients transformed by the
inverse-transpose grid matrix. Shared fine-grid edges keep neighboring cells
connected. A local-sampling workload limit uniformly lowers subdivision to
two or one for large fields; it is not an exact triangle-count limit.
`buildOrbital(parsed, isovalue, 1)` retains the native grid mesher and its
interpolated finite-difference normals for comparisons.

Interpolation preserves every source sample and estimates values between them;
it does not add wavefunction data. It can introduce between-sample extrema and
additional contours, especially for coarse or noisy imported fields. Surface
phases remain gated by the original sampled minimum and maximum. The desktop
can evaluate analytic orbital gradients directly. Consequently the sampling,
antialiasing and exact pixel output are not identical to every desktop preset.
The Qt widget and SCF/IAO/localization engines have not been compiled to WebAssembly.

The web app has no third-party molecular renderer. It uses React for the
interface and Vite for bundling; the original C++ application is unchanged.

## Scientific data

The demos evaluate the original bundled Molpro wavefunctions without changing
orbital coefficients or signs. These are localized occupied
IBOs, not canonical HOMO/LUMO orbitals. The two surface colors encode the sign of ψ, not
charge. Demo isovalues are amplitudes in bohr^(-3/2); imported Cube fields keep
their original scalar units and are labeled as unspecified fields.

The benzene visual grid is 111 × 117 × 59 with 0.16-bohr spacing. Its lower isovalue
limit of 0.015 keeps the surfaces inside the sampled box. A larger, finer grid
gives a maximum selected-orbital overlap error of 1.19e-4. These grids are for
visualization, not quantitative integration.

See [`public/data/benzene/PROVENANCE.md`](public/data/benzene/PROVENANCE.md) and
the accompanying JSON manifest for the source hash and numerical checks.

The iron carbonyl nitrosyl and rhenium demos also use 0.16-bohr display grids,
about 11.8 points/Å, close to native IboView's default 12 points/Å. The larger
SN2 example uses 0.18 bohr to keep each Cube below the 35 MiB limit. These are
direct evaluations of the source wavefunctions; the stored Cube samples use
no interpolation or amplitude rescaling. Larger, finer grids check the overlaps at 0.14 bohr
(iron/rhenium) and 0.1575 bohr (SN2). Each folder under `public/data/` includes
its original-source hashes, occupations, grid bounds, normalization checks and
selection notes in `manifest.json` and `PROVENANCE.md`. Rhenium uses the source's
ECP valence wavefunction; replaced core orbitals are not reconstructed.
New Cube files are gzip compressed and decoded on demand with the browser's
`DecompressionStream` API. An up-to-date browser supporting WebGL2 and gzip
decompression is required. Only four recently viewed grids are retained in the
demo cache; color choices persist across examples and the camera refits when
switching molecules.

## Verify

```sh
npm test
npm run build
```

Importer and geometry tests cover invalid inputs, units, field signs, mesh
winding, normal directions, skew and reflected grids, and the bundled demo
orbitals. Demo-loader tests cover gzip assets, retries and equal orbital IDs
across different molecules. To regenerate the data or check the original basis evaluator, install
NumPy in a Python environment and run from the repository root:

```sh
python3 webapp/scripts/generate_demo.py --check
python3 webapp/scripts/generate_complex_demos.py --check
python3 -m unittest discover -s webapp/tests -p '*_test.py' -v
```

The scientific checks compile the actual IrCore harmonic function when a C++
compiler is available, independently compare it with the converter, and verify
Cube axis ordering, source coordinates, s–g harmonics and π/σ reflection symmetry.

Browser acceptance checks: initial π IBO render; switching between all four
examples and their orbitals; switching to σ IBO; changing
material/isovalue/opacity; rotation/zoom and top/side views; hydrogen/label toggles;
XYZ/Cube import; invalid-file recovery; PNG export; narrow-screen layout;
light/night switching and persistence after reload.
Rendering still requires a browser with working WebGL2; a successful build
alone is not a rendering check.

The color-ramp picker and palette definitions are adapted from Dr.XAS's
`frontend/components/xraylarch-web/artefact-viewers/athena-ramp-picker.tsx` and
`frontend/lib/xraylarch-web/athena-{colormaps,plot-colors}.ts` (vendored there
from xraylarch-web). The palette modules in `src/lib/palettes/` retain the
original color stops and interpolation, including Classic and Okabe–Ito.
The ramp's left selected color maps to +ψ and its right selected color to −ψ;
categorical palettes use their first two colors. These are phase colors, not
a continuous scalar scale over the surface. Gradient mode applies a cosmetic
transition over the outer 20% of each connected lobe's length along its outward
axis, from the molecular atom centroid toward the lobe centroid. Centered or
flat lobes without a defined outward extent stay uniform. The tail moves at most
8% along the cmap toward the other phase's selected color (limited to a quarter
of the selected color range). It does not encode amplitude, charge or density.
The spatial weights are cached with the geometry and are independent of the
camera. Palette selection is retained while switching orbitals and is remembered
separately for each molecular geometry across page sessions.

## License

The native-derived viewer and data follow the repository's GPL-3.0 license and
Gerald Knizia's IboView attribution. Self-hosted Figtree is licensed under SIL
OFL 1.1; its full license is in `public/fonts/OFL-Figtree.txt`. React, Lucide,
TypeScript, Vite and Vitest retain their respective package licenses. The FXAA
shader retains its original NVIDIA license notice and contributor credits.
