import { describe, expect, it } from 'vitest';
import { createInteractiveHTML, iframeEmbedCode, interactiveFileName } from '../src/lib/interactive-html';
import { packMesh, unpackMesh, type InteractiveView } from '../src/lib/interactive-scene';

const mesh = { positions: new Float32Array([1.25, -2.5, 3e-8]), normals: new Float32Array([0, 1, 0]),
  colors: new Float32Array([.2, .5, .9, .34]), indices: new Uint32Array([0, 65537, 4294967295]) };
const empty = { positions: new Float32Array(), normals: new Float32Array(), colors: new Float32Array(), indices: new Uint32Array() };
const view: InteractiveView = { title: 'Benzene π orbital', source: 'benzene.xml', orbital: 'IBO 20', isovalue: .045,
  molecule: mesh, orbitalMesh: empty, camera: { rotation: [0,0,0,1], center: [0,0,0], pan: [1,-1], halfHeight: 5, fittedHalfHeight: 6, cameraDistance: 52.9 },
  aspect: 1.6, theme: 'dark', settings: { material: 'extra', atomMaterial: 'soft', opacity: .55, spinning: true }, labels: [{text:'C1',x:1,y:2,z:3}] };

describe('interactive molecular export', () => {
  it('roundtrips exact float32 colors, coordinates and full uint32 indices including typed-array subviews', () => {
    const result = unpackMesh(packMesh({ ...mesh, positions: new Float32Array([99, ...mesh.positions, 99]).subarray(1,4) }));
    expect(result).toEqual(mesh);
    expect(unpackMesh(packMesh(empty))).toEqual(empty);
  });
  it('rejects invalid floating-point geometry instead of silently exporting a broken view', () => {
    expect(() => packMesh({...mesh, positions: new Float32Array([NaN,0,0])})).toThrow(/invalid/);
  });
  it('preserves camera, materials, labels, metadata and animation while safely embedding hostile names', () => {
    const hostile = { ...view, title: '</script><script>alert(1)</script> & "π"', source: '<img src=x onerror=alert(1)>' };
    const html = createInteractiveHTML(hostile, 'document.body.dataset.loaded="yes";', 'data:font/woff2;base64,AA==', '</script>OFL');
    const raw = html.match(/<script id="iboview-scene" type="application\/json">([\s\S]*?)<\/script>/)![1];
    const packed = JSON.parse(raw);
    expect(raw).not.toContain('<');
    expect(packed.title).toBe(hostile.title);
    expect(packed.camera).toEqual(view.camera);
    expect(packed.settings).toEqual(view.settings);
    expect(packed.labels).toEqual(view.labels);
    expect(unpackMesh(packed.molecule)).toEqual(mesh);
    expect(html).not.toContain('<script>alert(1)');
    expect(html.match(/<script[ >]/g)).toHaveLength(3);
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|https?:\/\//);
    expect(html).toContain("connect-src 'none'");
  });
  it('quotes the iframe title and uses a script-only sandbox with a local relative filename', () => {
    const name = interactiveFileName('A / molecule <script>');
    expect(name).toBe('A-molecule-script-interactive.html');
    const code = iframeEmbedCode(name, '" onload="bad');
    expect(code).toContain('sandbox="allow-scripts"');
    expect(code).not.toContain('allow-same-origin');
    expect(code).toContain('title="&quot; onload=&quot;bad"');
  });
  it('rejects a broken bundle that would terminate the executable script', () => {
    expect(() => createInteractiveHTML(view, '</script>', '', '')).toThrow(/terminator/);
  });
});
