import type { RenderQuality } from '../lib/render-quality';
import './render-quality.css';

const descriptions: Record<RenderQuality, string> = {
  fast: 'Less detail for faster loading and rotation.',
  balanced: 'A balance of surface detail and speed.',
  smooth: 'Smoothest surfaces; takes longer to prepare and render.',
};

export function RenderQualityControl({ value, onChange, disabled }: {
  value: RenderQuality;
  onChange: (value: RenderQuality) => void;
  disabled?: boolean;
}) {
  return <label className="render-quality-control" title={`${descriptions[value]} Saved in this browser. Exports use the selected detail.`}>
    <span>Render quality</span>
    <select aria-label="Render quality" value={value} disabled={disabled}
      onChange={event => onChange(event.target.value as RenderQuality)}>
      <option value="fast">Fast</option>
      <option value="balanced">Balanced</option>
      <option value="smooth">Smooth</option>
    </select>
  </label>;
}
