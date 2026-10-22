import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createDemoLoader } from '../src/lib/demos';

const cube = (element: number) => [
  'Demo orbital', '', '1 0 0 0', '2 1 0 0', '2 0 1 0', '2 0 0 1',
  `${element} ${element} 0 0 0`, '-0.2 -0.1 0 0.1 0.2 0.3 0.4 0.5',
].join('\n');
const manifest = (id: string, compressed = false) => ({
  id, defaultOrbitalId: 'ibo-02', xyzUrl: `/data/${id}/molecule.xyz`,
  orbitals: ['ibo-01', 'ibo-02'].map(orbital => ({
    id: orbital, cubeUrl: `/data/${id}/${orbital}.cube${compressed ? '.gz' : ''}`,
  })),
});

afterEach(() => vi.unstubAllGlobals());

describe('Demo loading', () => {
  it('honors the default orbital and isolates equal orbital IDs across molecules', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const oxygen = url.includes('/oxygen/');
      if (url.endsWith('manifest.json')) return Response.json(manifest(oxygen ? 'oxygen' : 'carbon'));
      if (url.endsWith('.xyz')) return new Response(`1\n\n${oxygen ? 'O' : 'C'} 0 0 0\n`);
      return new Response(cube(oxygen ? 8 : 6));
    });
    vi.stubGlobal('fetch', fetcher);
    const load = createDemoLoader();
    const first = await load('carbon');
    const second = await load('oxygen');
    expect(first.orbital.id).toBe('ibo-02');
    expect(first.volume.atoms[0].element).toBe('C');
    expect(second.volume.atoms[0].element).toBe('O');
    expect((await load('carbon')).volume).toBe(first.volume);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it.each([false, true])('loads gzip assets with server decompression = %s', async decompressed => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('manifest.json')) return Response.json(manifest('compressed', true));
      if (url.endsWith('.xyz')) return new Response('1\n\nC 0 0 0\n');
      return new Response(decompressed ? cube(6) : gzipSync(cube(6)));
    }));
    const result = await createDemoLoader()('compressed');
    expect(result.volume.range).toEqual([-0.2, 0.5]);
    expect(result.volume.atoms[0].element).toBe('C');
  });

  it('allows retry after a failed asset request and rejects unknown orbitals', async () => {
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('manifest.json')) return Response.json(manifest('carbon'));
      if (url.endsWith('.xyz')) return new Response('1\n\nC 0 0 0\n');
      return fail ? new Response('', { status: 503 }) : new Response(cube(6));
    }));
    const load = createDemoLoader();
    await expect(load('carbon')).rejects.toThrow('503');
    fail = false;
    expect((await load('carbon')).volume.atoms[0].element).toBe('C');
    await expect(load('carbon', 'missing')).rejects.toThrow('requested orbital');
  });
});
