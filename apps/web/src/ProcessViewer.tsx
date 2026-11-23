import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import camundaModdle from 'camunda-bpmn-moddle/resources/camunda.json';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import { clearPath, highlightPath, markAiTasks } from './pathHighlight';
import { bpmnRenderer, useThemeMode } from './theme';
import { bpmnName } from './i18n';

/** Read-only view, so element names can be shown in the UI language without touching the file. */
function localizeNames(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return xml;
  doc.querySelectorAll('[name]').forEach(element => element.setAttribute('name', bpmnName(element.getAttribute('name') ?? '')));
  return new XMLSerializer().serializeToString(doc);
}

export type PathNote = { id: string; text: string; tone: 'rules' | 'ai' | 'action' };

/** Read-only diagram that shows which way a run went. */
export default function ProcessViewer({ xml, path, notes, label }: {
  xml: string; path: string[] | null; notes: PathNote[]; label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<NavigatedViewer | null>(null);
  const [ready, setReady] = useState(false);
  const mode = useThemeMode();
  const { i18n } = useTranslation();
  const lng = i18n.resolvedLanguage;
  const source = useMemo(() => (lng && lng !== 'en' && xml ? localizeNames(xml) : xml), [xml, lng]);

  useEffect(() => {
    if (!host.current) return;
    // Colors are baked in at creation, so the viewer is rebuilt when the theme changes.
    const instance = new NavigatedViewer({ container: host.current, moddleExtensions: { camunda: camundaModdle }, bpmnRenderer: bpmnRenderer(mode) } as any);
    setReady(false);
    setViewer(instance);
    return () => { instance.destroy(); setViewer(null); };
  }, [mode]);

  useEffect(() => {
    if (!viewer || !source) return;
    let cancelled = false;
    setReady(false);
    viewer.importXML(source).then(() => {
      if (cancelled) return;
      markAiTasks(viewer);
      (viewer.get('canvas') as any).zoom('fit-viewport', 'auto');
      setReady(true);
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [viewer, source]);

  useEffect(() => {
    if (!viewer || !host.current) return;
    const canvas = viewer.get('canvas') as any;
    const observer = new ResizeObserver(() => {
      if (!host.current?.clientWidth || !canvas.getRootElement()) return;
      canvas.resized();
      canvas.zoom('fit-viewport', 'auto');
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [viewer]);

  useEffect(() => {
    if (!viewer || !ready) return;
    const overlays = viewer.get('overlays') as any;
    const registry = viewer.get('elementRegistry') as any;
    overlays.remove({ type: 'path-note' });
    if (!path) { clearPath(viewer); return; }
    highlightPath(viewer, path);
    for (const note of notes) {
      const element = registry.get(note.id);
      if (!element) continue;
      const html = document.createElement('div');
      html.className = `path-note path-note-${note.tone}`;
      // Zero-width spaces let rule names like RULES_ONLY_RISK_UNCLEAR wrap at underscores, not mid-word.
      html.textContent = note.text.replaceAll('_', '_\u200b');
      html.style.width = `${element.width}px`;
      overlays.add(element, 'path-note', { position: { top: element.height + 8, left: 0 }, html, scale: { min: 0.85 } });
    }
  }, [viewer, ready, path, notes]);

  return <div className="process-viewer" role="img" aria-label={label}><div className="process-viewer-canvas" ref={host} /></div>;
}
