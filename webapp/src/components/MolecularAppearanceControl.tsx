import { useId } from 'react';
import { Check, ChevronDown, RotateCcw } from 'lucide-react';
import {
  ATOM_PALETTES, DEFAULT_MOLECULE_APPEARANCE, MOLECULE_PRESETS, REPRESENTATIONS,
  elementDisplayColor, type MoleculeAppearance,
} from '../lib/molecule-appearance';
import './molecular-appearance.css';

function MoleculePreview({ value }: { value: MoleculeAppearance }) {
  const id = useId().replace(/:/g, '');
  const nodes = [
    { x: 26, y: 35, element: 'C' }, { x: 46, y: 24, element: 'C' },
    { x: 67, y: 35, element: 'O' }, { x: 46, y: 47, element: 'N' },
    { x: 11, y: 25, element: 'H' }, { x: 46, y: 8, element: 'H' },
    { x: 83, y: 26, element: 'H' },
  ];
  const connections = [[0, 1], [1, 2], [1, 3], [0, 4], [1, 5], [2, 6]];
  const wire = value.style === 'wireframe';
  const space = value.style === 'space-fill';
  const sticks = value.style === 'stick';
  const bondWidth = (wire ? 1.8 : sticks ? 5.5 : 3.8) * value.bondScale;
  return <svg className="mol-preset-preview" viewBox="0 0 94 60" aria-hidden="true">
    <defs>{nodes.map((node, index) => <radialGradient key={index} id={`${id}-atom-${index}`} cx="33%" cy="26%" r="75%">
      <stop offset="0" stopColor="#fff" stopOpacity={value.atomMaterial === 'soft' ? '.25' : '.85'} />
      <stop offset=".32" stopColor={elementDisplayColor(node.element, value)} />
      <stop offset="1" stopColor={elementDisplayColor(node.element, value)} />
    </radialGradient>)}</defs>
    <ellipse cx="47" cy="54" rx="30" ry="3" fill="currentColor" opacity=".045" />
    {value.bonds && !space && value.style !== 'spheres' && connections.map(([a, b]) => {
      const first = nodes[a], second = nodes[b];
      if (!value.hydrogens && (first.element === 'H' || second.element === 'H')) return null;
      const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      return <g key={`${a}-${b}`} strokeWidth={bondWidth} strokeLinecap="round">
        <line x1={first.x} y1={first.y} x2={middle.x} y2={middle.y}
          stroke={value.bondColorMode === 'uniform' ? value.bondColor : elementDisplayColor(first.element, value)} />
        <line x1={middle.x} y1={middle.y} x2={second.x} y2={second.y}
          stroke={value.bondColorMode === 'uniform' ? value.bondColor : elementDisplayColor(second.element, value)} />
      </g>;
    })}
    {nodes.map((node, index) => {
      if (!value.hydrogens && node.element === 'H') return null;
      const radius = (space ? 13 : wire ? 1.6 : sticks ? 3.3 : 7.7)
        * (node.element === 'H' ? .65 * value.hydrogenScale : 1) * value.atomScale;
      return <circle key={index} cx={node.x} cy={node.y} r={radius}
        fill={`url(#${id}-atom-${index})`} stroke={elementDisplayColor(node.element, value)} strokeWidth=".4" />;
    })}
  </svg>;
}

function SizeSlider({ id, label, value, min, max, onChange, disabled = false }: {
  id: string; label: string; value: number; min: number; max: number;
  onChange: (value: number) => void; disabled?: boolean;
}) {
  return <div className={`mol-size-control${disabled ? ' is-disabled' : ''}`}>
    <label htmlFor={id}><span>{label}</span><output htmlFor={id}>{value.toFixed(2)}×</output></label>
    <input id={id} type="range" min={min} max={max} step=".05" value={value} disabled={disabled}
      aria-valuetext={`${value.toFixed(2)} times`} onChange={event => onChange(Number(event.target.value))} />
  </div>;
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" className="mol-toggle" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
    <span>{label}</span><span className={`switch${checked ? ' on' : ''}`} aria-hidden="true"><span /></span>
  </button>;
}

function matchesPreset(value: MoleculeAppearance, preset: MoleculeAppearance) {
  return Object.keys(preset).every(key => {
    if (key === 'elementColors') return Object.keys(value.elementColors).length === Object.keys(preset.elementColors).length
      && Object.entries(value.elementColors).every(([element, color]) => preset.elementColors[element] === color);
    return value[key as keyof MoleculeAppearance] === preset[key as keyof MoleculeAppearance];
  });
}

export function MolecularAppearanceControl({ value, elements, onChange }: {
  value: MoleculeAppearance; elements: string[]; onChange: (value: MoleculeAppearance) => void;
}) {
  const id = useId();
  const update = (patch: Partial<MoleculeAppearance>) => onChange({ ...value, ...patch });
  const activePreset = MOLECULE_PRESETS.find(preset => matchesPreset(value, preset.settings));
  const visibleElements = [...new Set(elements)].filter(element => value.hydrogens || element !== 'H');
  const bondsVisible = value.bonds && value.style !== 'space-fill' && value.style !== 'spheres';
  return <section className="molecular-appearance" aria-labelledby={`${id}-heading`}>
    <div className="mol-heading">
      <div><h3 id={`${id}-heading`}>Molecule</h3><p>Shape, color & finish</p></div>
      <button type="button" className="mol-reset" title="Reset molecular appearance" aria-label="Reset molecular appearance"
        onClick={() => onChange({ ...DEFAULT_MOLECULE_APPEARANCE, elementColors: {} })}><RotateCcw size={13} /></button>
    </div>

    <div className="mol-label-row"><span>Quick looks</span><span className="mol-current-look">{activePreset?.name ?? 'Custom'}</span></div>
    <div className="mol-preset-grid" role="group" aria-label="Molecular appearance presets">
      {MOLECULE_PRESETS.map(preset => <button type="button" key={preset.id} className="mol-preset"
        aria-pressed={activePreset?.id === preset.id} title={preset.description}
        onClick={() => onChange({ ...preset.settings, elementColors: { ...preset.settings.elementColors } })}>
        <MoleculePreview value={preset.settings} />
        <span className="mol-preset-name">{preset.name}</span>
        {activePreset?.id === preset.id && <Check className="mol-preset-check" size={11} aria-hidden="true" />}
      </button>)}
    </div>

    <div className="mol-label-row mol-representation-heading"><span>Representation</span></div>
    <div className="mol-representations" role="group" aria-label="Molecular representation">
      {REPRESENTATIONS.map(representation => <button type="button" key={representation.id} aria-pressed={value.style === representation.id}
        title={representation.description} onClick={() => update({ style: representation.id,
          ...(['stick', 'wireframe'].includes(representation.id) ? { bondStyle: 'cylinder' as const } : {}) })}>{representation.name}</button>)}
    </div>

    <details className="mol-detail" open>
      <summary><span>Atoms & colors</span><span className="mol-summary-end"><i style={{ background: elementDisplayColor('C', value) }} /><ChevronDown size={13} /></span></summary>
      <div className="mol-detail-body">
        <div className="mol-palette-grid" role="group" aria-label="Atom color palette">
          {ATOM_PALETTES.map(palette => <button type="button" key={palette.id} className="mol-palette" aria-pressed={value.atomPalette === palette.id}
            onClick={() => update({ atomPalette: palette.id, elementColors: {} })}>
            <span className="mol-swatches" aria-hidden="true">{palette.swatches.map((color, index) => <i key={index} style={{ background: palette.id === 'uniform' ? value.atomColor : color }} />)}</span>
            <span>{palette.name}</span>
          </button>)}
        </div>
        {value.atomPalette === 'uniform' ? <label className="mol-color-row"><span>Atom color</span>
          <input type="color" value={value.atomColor} aria-label="Uniform atom color" onChange={event => update({ atomColor: event.target.value })} />
        </label> : visibleElements.length > 0 && <div className="mol-element-colors">
          <div className="mol-element-heading"><span>Element colors</span>{Object.keys(value.elementColors).length > 0
            && <button type="button" onClick={() => update({ elementColors: {} })}>Reset</button>}</div>
          <div className="mol-element-list">{visibleElements.map(element => <label key={element} className="mol-element" title={`Change ${element} color`}>
            <input type="color" value={elementDisplayColor(element, value)} aria-label={`${element} atom color`}
              onChange={event => update({ elementColors: { ...value.elementColors, [element]: event.target.value } })} /><span>{element}</span>
          </label>)}</div>
        </div>}
        <SizeSlider id={`${id}-atom-size`} label="Atom size" min={.4} max={2} value={value.atomScale} onChange={atomScale => update({ atomScale })} />
        <SizeSlider id={`${id}-hydrogen-size`} label="Hydrogen size" min={.4} max={1.5} value={value.hydrogenScale} disabled={!value.hydrogens}
          onChange={hydrogenScale => update({ hydrogenScale })} />
        <label className="mol-select-row" htmlFor={`${id}-material`}><span>Atom finish</span>
          <select id={`${id}-material`} value={value.atomMaterial} onChange={event => update({ atomMaterial: event.target.value as MoleculeAppearance['atomMaterial'] })}>
            <option value="shiny">Polished</option><option value="soft">Soft satin</option><option value="extra">High gloss</option>
          </select>
        </label>
      </div>
    </details>

    <details className="mol-detail">
      <summary><span>Bonds</span><span className="mol-summary-end"><span>{bondsVisible ? `${value.bondScale.toFixed(2)}×` : 'Hidden'}</span><ChevronDown size={13} /></span></summary>
      <div className="mol-detail-body">
        <Switch label="Show bonds" checked={value.bonds} onChange={bonds => update({ bonds })} />
        {(value.style === 'space-fill' || value.style === 'spheres') && <p className="mol-note">Choose ball & stick, sticks, or wireframe to show bonds.</p>}
        <fieldset className="mol-bond-controls" disabled={!bondsVisible}>
          <SizeSlider id={`${id}-bond-size`} label="Bond thickness" min={.25} max={2} value={value.bondScale} disabled={!bondsVisible} onChange={bondScale => update({ bondScale })} />
          {value.style === 'wireframe' ? <p className="mol-note">Wireframe uses fine cylindrical bonds.</p> : <>
          <div className="mol-label-row"><span>Bond shape</span></div>
          <div className="mol-segment" role="group" aria-label="Bond shape">
            <button type="button" aria-pressed={value.bondStyle === 'tapered'} onClick={() => update({ bondStyle: 'tapered' })}>Sculpted</button>
            <button type="button" aria-pressed={value.bondStyle === 'cylinder'} onClick={() => update({ bondStyle: 'cylinder' })}>Cylindrical</button>
          </div>
          </>}
          <div className="mol-label-row"><span>Bond color</span></div>
          <div className="mol-segment" role="group" aria-label="Bond color mode">
            <button type="button" aria-pressed={value.bondColorMode === 'element'} onClick={() => update({ bondColorMode: 'element' })}>By element</button>
            <button type="button" aria-pressed={value.bondColorMode === 'uniform'} onClick={() => update({ bondColorMode: 'uniform' })}>Single color</button>
          </div>
          {value.bondColorMode === 'uniform' && <label className="mol-color-row"><span>Bond tint</span>
            <input type="color" value={value.bondColor} aria-label="Uniform bond color" onChange={event => update({ bondColor: event.target.value })} />
          </label>}
        </fieldset>
      </div>
    </details>
    <div className="mol-visibility">
      <Switch label="Hydrogens" checked={value.hydrogens} onChange={hydrogens => update({ hydrogens })} />
      <Switch label="Atom labels" checked={value.labels} onChange={labels => update({ labels })} />
    </div>
  </section>;
}
