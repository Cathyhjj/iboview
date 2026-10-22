import { useRef, useState } from 'react';
import { Code, Copy, Download, X } from 'lucide-react';
import { createInteractiveHTML, iframeEmbedCode, interactiveFileName } from '../lib/interactive-html';
import type { InteractiveView } from '../lib/interactive-scene';
import './interactive-export.css';

export function InteractiveExportControl({ disabled, getView }: { disabled: boolean; getView: () => InteractiveView | undefined }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const embed = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<InteractiveView>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const name = interactiveFileName([view?.title, view?.orbital].filter(Boolean).join('-'));
  const code = iframeEmbedCode(name, view?.title ?? 'Interactive molecule');
  function open() {
    const current = getView();
    if (!current) return;
    // Keep this export stable if the workspace keeps rotating behind the dialog.
    setView(structuredClone(current)); setMessage(''); setFailed(false);
    dialog.current?.showModal();
  }
  async function download() {
    if (!view) return;
    setBusy(true); setMessage('Preparing interactive HTML…'); setFailed(false);
    try {
      const { runtime, fontDataURL, fontLicense } = await import('virtual:interactive-viewer');
      const html = createInteractiveHTML(view, runtime, fontDataURL, fontLicense);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage(`Download requested: ${name} (${(blob.size / 1024 / 1024).toFixed(2)} MB). Open the file in your browser.`);
    } catch (cause) {
      setFailed(true); setMessage(cause instanceof Error ? cause.message : 'Unable to export this view.');
    } finally { setBusy(false); }
  }
  async function copyEmbed() {
    try { await navigator.clipboard.writeText(code); setFailed(false); setMessage('Embed code copied. Upload the HTML alongside your webpage, or replace src with its hosted URL.'); }
    catch { embed.current?.focus(); embed.current?.select(); setFailed(false); setMessage('Press Cmd/Ctrl+C to copy the selected embed code.'); }
  }
  return <>
    <button className="button secondary" disabled={disabled} onClick={open}><Code size={16} />Export HTML</button>
    <dialog ref={dialog} className="interactive-export-dialog" aria-labelledby="interactive-export-title">
      <div className="interactive-export-heading"><h2 id="interactive-export-title">Export interactive HTML</h2><button className="icon-button" aria-label="Close HTML export" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      <p>One offline file with the current molecule, orbital, colors, lighting and view. Drag to rotate, scroll to zoom, or play and pause automatic rotation.</p>
      <p className="interactive-export-note">Includes the currently visible orbital at this isovalue. Keep your IboView project to change orbitals or appearance later.</p>
      <button className="button primary" disabled={busy} onClick={() => void download()}><Download size={16} />{busy ? 'Preparing…' : 'Download HTML'}</button>
      <label className="interactive-embed-label" htmlFor="interactive-embed-code">Embed in a webpage</label>
      <textarea ref={embed} id="interactive-embed-code" readOnly value={code} rows={4} spellCheck={false} />
      <p className="interactive-export-note">Upload the HTML beside your webpage and paste this code into the page. For another location, replace src with the HTML file’s URL. The destination must allow iframe embeds.</p>
      <button className="button secondary" onClick={() => void copyEmbed()}><Copy size={15} />Copy embed code</button>
      <p role={failed ? 'alert' : 'status'} className={failed ? 'interactive-export-error' : 'interactive-export-status'}>{message}</p>
    </dialog>
  </>;
}
