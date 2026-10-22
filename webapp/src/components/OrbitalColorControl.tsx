import { RotateCcw } from 'lucide-react';
import { ColorRampPicker } from './ColorRampPicker';
import { DEFAULT_ORBITAL_COLORS, hasContinuousRange, orbitalPaletteOptions, orbitalPhaseColors, type OrbitalColors } from '../lib/orbital-colors';

export function OrbitalColorControl({ value, onChange, disabled, isDemo }: {
  value: OrbitalColors; onChange: (value: OrbitalColors) => void; disabled: boolean; isDemo: boolean;
}) {
  const colors = orbitalPhaseColors(value);
  const options = orbitalPaletteOptions(value);
  const continuous = hasContinuousRange(value.palette);
  const setCustom = (phase: 'positiveColor' | 'negativeColor', color: string) => {
    onChange({ ...value, positiveColor: colors.positiveColor, negativeColor: colors.negativeColor,
      palette: 'custom', reversed: false, [phase]: color });
  };
  return <div className="orbital-color-control">
    <div className="color-heading"><span>Orbital colors</span>
      <button className="color-reset" title="Reset orbital colors" aria-label="Reset orbital colors" disabled={disabled}
        onClick={() => onChange({ ...DEFAULT_ORBITAL_COLORS })}><RotateCcw size={12} /></button>
    </div>
    <ColorRampPicker label="Orbital colormap" options={options} value={value.palette} disabled={disabled}
      onChange={palette => onChange({ ...value, palette })}
      range={continuous ? { vmin: value.vmin, vmax: value.vmax, minGap: 0.02,
        onChange: (vmin, vmax) => onChange({ ...value, vmin, vmax }) } : undefined} />
    <div className="color-palette-meta"><span title={continuous ? 'A cmap tint extending inward from the tip of each orbital lobe. Display effect only.' : 'One solid color for each phase.'}>
      {continuous ? 'Gradient' : 'Two-color'} · {options.find(option => option.value === value.palette)?.label.split(' · ')[0]}</span>
      <label><input type="checkbox" checked={value.reversed} disabled={disabled || value.palette === 'custom'}
        onChange={event => onChange({ ...value, reversed: event.target.checked })} />Reverse</label>
    </div>
    {continuous && <div className="orbital-gradient-controls">
      <label className="slider-label" htmlFor="gradient-extent"><span>Gradient extent</span><output>{Math.round(value.gradientExtent * 100)}%</output></label>
      <input id="gradient-extent" type="range" min="0" max="100" step="1" value={Math.round(value.gradientExtent * 100)}
        aria-label="Gradient extent" aria-valuetext={`${Math.round(value.gradientExtent * 100)}% of each lobe, from the tip inward`}
        title="How much of each lobe fades from its tip inward. Default: 20%." disabled={disabled}
        onChange={event => onChange({ ...value, gradientExtent: Number(event.target.value) / 100 })} />
      <label className="slider-label" htmlFor="gradient-strength"><span>Gradient strength</span><output>{Math.round(value.gradientStrength * 100)}%</output></label>
      <input id="gradient-strength" type="range" min="0" max="200" step="1" value={Math.round(value.gradientStrength * 100)}
        aria-label="Gradient strength" aria-valuetext={`${Math.round(value.gradientStrength * 100)}%`}
        title="How far the tint moves along the cmap. 100% is the default subtle tint; 0% is solid color." disabled={disabled}
        onChange={event => onChange({ ...value, gradientStrength: Number(event.target.value) / 100 })} />
    </div>}
    <div className="phase-color-inputs">
      <label><input type="color" aria-label={isDemo ? 'Positive phase color' : 'Positive value color'}
        value={colors.positiveColor} disabled={disabled} onInput={event => setCustom('positiveColor', event.currentTarget.value)}
        onChange={event => setCustom('positiveColor', event.target.value)} />
        <span>{isDemo ? '+ψ' : '+ value'}</span></label>
      <label><input type="color" aria-label={isDemo ? 'Negative phase color' : 'Negative value color'}
        value={colors.negativeColor} disabled={disabled} onInput={event => setCustom('negativeColor', event.currentTarget.value)}
        onChange={event => setCustom('negativeColor', event.target.value)} />
        <span>{isDemo ? '−ψ' : '− value'}</span></label>
    </div>
  </div>;
}
