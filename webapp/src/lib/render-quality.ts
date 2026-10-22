export type RenderQuality = 'fast' | 'balanced' | 'smooth';

export const DEFAULT_RENDER_QUALITY: RenderQuality = 'fast';

export const RENDER_QUALITY_SETTINGS = {
  fast: { orbitalRefinement: 1, sphereSubdivisions: 3, bondSegments: 16 },
  balanced: { orbitalRefinement: 2, sphereSubdivisions: 3, bondSegments: 32 },
  smooth: { orbitalRefinement: 3, sphereSubdivisions: 4, bondSegments: 48 },
} as const satisfies Record<RenderQuality, {
  orbitalRefinement: 1 | 2 | 3;
  sphereSubdivisions: 3 | 4;
  bondSegments: 16 | 32 | 48;
}>;
