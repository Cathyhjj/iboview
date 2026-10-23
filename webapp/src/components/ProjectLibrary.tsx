import { useState } from 'react';
import { Check, FolderOpen, LoaderCircle, RefreshCw, Search, Trash2, X } from 'lucide-react';
import type { SavedProjectSummary } from '../lib/saved-projects';
import './project-library.css';

export interface ProjectLibraryProps {
  projects: SavedProjectSummary[];
  activeId?: string;
  loading: boolean;
  busy: boolean;
  error?: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

function savedDate(value: string | number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { label: 'Date unavailable', dateTime: undefined };
  return {
    label: date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
    dateTime: date.toISOString(),
  };
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function projectDetails(project: SavedProjectSummary) {
  if (project.kind === 'crystal') return 'Crystal structure';
  if (project.kind === 'xyz') return 'Structure';
  if (project.kind === 'cube') return 'Volume data';
  return `${project.orbitalCount} orbital${project.orbitalCount === 1 ? '' : 's'}`;
}

export function ProjectLibrary({ projects, activeId, loading, busy, error, onOpen, onDelete, onRefresh, onClose }: ProjectLibraryProps) {
  const [query, setQuery] = useState('');
  const [removeId, setRemoveId] = useState<string>();
  const search = query.trim().toLocaleLowerCase();
  const visible = projects.filter(project => `${project.name} ${project.formula}`.toLocaleLowerCase().includes(search));
  const close = () => { setRemoveId(undefined); setQuery(''); onClose(); };

  return <>
    <div className="dialog-heading project-library-heading">
      <h2 id="project-library-title">Saved projects</h2>
      <button type="button" className="icon-button" aria-label="Close saved projects" onClick={close} disabled={busy}><X size={19} /></button>
    </div>
    <p className="project-library-note">Saved in this browser. Open a project to restore its structure, orbitals, and view.</p>
    <div className="project-library-toolbar">
      <label className="project-library-search">
        <Search size={15} aria-hidden="true" />
        <span className="visually-hidden">Search saved projects</span>
        <input type="search" placeholder="Search by name or formula" value={query} disabled={busy || (loading && !projects.length)}
          onChange={event => { setQuery(event.target.value); setRemoveId(undefined); }} />
      </label>
      <button type="button" className="icon-button project-library-refresh" aria-label="Refresh saved projects" title="Refresh saved projects"
        disabled={busy || loading} onClick={onRefresh}><RefreshCw size={16} /></button>
    </div>
    {error && <p className="project-library-error" role="alert">{error}</p>}
    <div className="project-library-content" aria-busy={busy || loading}>
      {loading && <div className="project-library-status" role="status"><LoaderCircle className="project-library-spinner" size={17} />Loading projects…</div>}
      {!loading && !error && projects.length === 0 && <div className="project-library-empty">
        <FolderOpen size={28} aria-hidden="true" />
        <h3>No saved projects yet</h3>
        <p>Use Save project to keep your current workspace here.</p>
      </div>}
      {!loading && projects.length > 0 && visible.length === 0 && <div className="project-library-empty" role="status">
        <Search size={25} aria-hidden="true" />
        <h3>No matching projects</h3>
        <p>Try a different name or molecular formula.</p>
        <button type="button" className="button secondary" disabled={busy} onClick={() => setQuery('')}>Clear search</button>
      </div>}
      {visible.length > 0 && <ul className="saved-project-list" aria-label="Saved projects">
        {visible.map(project => {
          const active = project.id === activeId;
          const date = savedDate(project.updatedAt);
          const removing = removeId === project.id;
          return <li className={`saved-project-row${active ? ' is-active' : ''}`} key={project.id}>
            <div className="saved-project-copy">
              <div className="saved-project-title"><h3>{project.name}</h3>
                {active && <span className="saved-project-active"><Check size={11} aria-hidden="true" />Current</span>}
              </div>
              <div className="saved-project-details"><span>{project.formula}</span><span>{projectDetails(project)}</span><span>{fileSize(project.byteLength)}</span></div>
              <div className="saved-project-date">Saved <time dateTime={date.dateTime}>{date.label}</time></div>
            </div>
            <div className="saved-project-actions">
              <button type="button" className="button secondary saved-project-open" disabled={busy || loading}
                aria-label={`Open project ${project.name}`} onClick={() => { setRemoveId(undefined); onOpen(project.id); }}><FolderOpen size={14} />Open</button>
              <button type="button" className="icon-button saved-project-remove" disabled={busy || loading}
                aria-label={`Remove project ${project.name}`} title="Remove from this browser" aria-expanded={removing}
                onClick={() => setRemoveId(removing ? undefined : project.id)}><Trash2 size={15} /></button>
            </div>
            {removing && <div className="saved-project-confirm" role="group" aria-label={`Confirm removal of ${project.name}`}>
              <p>Remove <strong>{project.name}</strong> from this browser? Your current view stays open.</p>
              <div className="saved-project-confirm-actions">
                <button type="button" className="button secondary" disabled={busy} onClick={() => setRemoveId(undefined)}>Cancel</button>
                <button type="button" className="button saved-project-delete" disabled={busy}
                  onClick={() => { setRemoveId(undefined); onDelete(project.id); }}>Remove</button>
              </div>
            </div>}
          </li>;
        })}
      </ul>}
    </div>
    <div className="project-library-footer"><span>{projects.length} saved project{projects.length === 1 ? '' : 's'}</span>
      <button type="button" className="button secondary" disabled={busy} onClick={close}>Done</button>
    </div>
  </>;
}
