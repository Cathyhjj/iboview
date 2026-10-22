import { packInteractiveView, type InteractiveView } from './interactive-scene';

const escapeHTML = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const safeJSON = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export const MAX_INTERACTIVE_HTML_BYTES = 25 * 1024 * 1024;
export function interactiveFileName(title: string): string {
  return `${title.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'molecule'}-interactive.html`;
}
export function iframeEmbedCode(fileName: string, title: string): string {
  return `<iframe src="${escapeHTML(encodeURIComponent(fileName))}" title="${escapeHTML(title)}" width="960" height="600" style="width:100%;height:600px;border:0" sandbox="allow-scripts" loading="lazy"></iframe>`;
}
export function createInteractiveHTML(view: InteractiveView, runtime: string, fontDataURL: string, fontLicense: string): string {
  if (/<\/script/i.test(runtime)) throw new Error('The viewer bundle contains an invalid script terminator.');
  const packed = packInteractiveView(view);
  const dark = view.theme === 'dark';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHTML(view.title)} · IboView</title>
<style>
@font-face{font-family:Figtree;src:url('${fontDataURL}') format('woff2');font-style:normal;font-weight:300 900;font-display:swap}
:root{color-scheme:${dark ? 'dark' : 'light'};font-family:Figtree,Arial,sans-serif;color:${dark ? '#fafafa' : '#352b45'};background:${dark ? '#09090b' : '#fff'}}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}#viewer{position:absolute;inset:0;overflow:hidden}canvas{position:absolute;inset:0;width:100%;height:100%;display:block}#molecule{touch-action:none;cursor:grab}#molecule:active{cursor:grabbing}#labels{pointer-events:none}header{position:absolute;top:16px;left:18px;right:18px;pointer-events:none}h1{font-size:15px;margin:0;font-weight:600}header p{font-size:12px;margin:5px 0;opacity:.65}.toolbar{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:5px;align-items:center;padding:6px;border:1px solid ${dark ? '#444' : '#e4deeb'};border-radius:10px;background:${dark ? '#202023ed' : '#ffffffed'};max-width:calc(100% - 16px)}button{font:inherit;font-size:12px;color:inherit;background:transparent;border:0;border-radius:6px;padding:8px 10px;cursor:pointer;white-space:nowrap}button:hover{background:${dark ? '#38313f' : '#f1ebfa'}}button:focus-visible,canvas:focus-visible{outline:2px solid #9563de;outline-offset:-2px}button[aria-pressed=true]{background:${dark ? '#493760' : '#ede1ff'}}.hint{font-size:11px;opacity:.65;margin-left:6px;white-space:nowrap}#error{position:absolute;inset:25%;padding:20px;background:${dark ? '#202023' : '#fff'};border:1px solid #b47a7a;border-radius:8px;line-height:1.5;z-index:3}#error[hidden]{display:none}@media(max-width:600px){.hint{display:none}header{top:12px;left:12px}button{padding:8px}.toolbar{bottom:8px}}@media print{.toolbar{display:none}}
</style></head><body>
<div id="viewer"><canvas id="molecule" tabindex="0" role="img" aria-label="Interactive molecule: drag to rotate, scroll to zoom. Arrow keys rotate; plus and minus zoom."></canvas><canvas id="labels" aria-hidden="true"></canvas></div>
<header><h1>${escapeHTML(view.title)}</h1><p>${escapeHTML(view.orbital ?? 'Molecular structure')}</p></header>
<nav class="toolbar" aria-label="Molecule controls"><button id="spin" aria-pressed="false">Auto rotate</button><button id="zoom-in" aria-label="Zoom in">＋</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="reset">Reset view</button><span class="hint">Drag to rotate · Scroll to zoom</span></nav>
<p id="error" role="alert" hidden></p><noscript>This interactive molecule needs JavaScript and WebGL 2.</noscript>
<script id="iboview-scene" type="application/json">${safeJSON(packed)}</script>
<script id="iboview-font-license" type="application/json">${safeJSON(fontLicense)}</script>
<script>/* IboView renderer, original shaders by Gerald Knizia; GPL-3.0. */\n${runtime}</script>
</body></html>`;
  if (new Blob([html]).size > MAX_INTERACTIVE_HTML_BYTES) {
    throw new Error('This interactive view exceeds 25 MB. Use a smaller structure or a simpler molecular representation before exporting.');
  }
  return html;
}
