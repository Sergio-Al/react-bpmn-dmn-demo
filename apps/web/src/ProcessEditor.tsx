import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Typography } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import Modeler from 'bpmn-js/lib/Modeler';
import camundaModdle from 'camunda-bpmn-moddle/resources/camunda.json';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import { clearPath, highlightPath, markAiTasks } from './pathHighlight';
import { bpmnRenderer, useThemeMode } from './theme';

export default function ProcessEditor({ xml, onSave, saveStatus, decisionKey, setDecisionKey, highlight, onEdit }: {
  xml: string; onSave: (xml: string) => Promise<void>; saveStatus: string; decisionKey: string; setDecisionKey: (value: string) => void;
  /** Activity ids from the last run, drawn on the canvas until the diagram is edited. */
  highlight: string[] | null; onEdit: () => void;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [modeler, setModeler] = useState<Modeler | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [localSaveError, setLocalSaveError] = useState('');
  const [imported, setImported] = useState('');
  const mode = useThemeMode();
  // bpmn-js bakes colors in when it is created, so a theme change rebuilds the modeler.
  // Unsaved edits are carried over through this draft.
  const draft = useRef<string | null>(null);

  const fitDiagram = useCallback(() => {
    // A hidden or zero-sized container makes fit-viewport compute a non-finite scale.
    if (!modeler || !host || host.clientWidth === 0 || host.clientHeight === 0) return;
    const canvas = modeler.get('canvas') as any;
    // Invalidate bpmn-js's cached outer viewbox before fitting a resized container.
    canvas.resized();
    if (!canvas.getRootElement()) return;
    canvas.zoom('fit-viewport');
    const { inner, outer } = canvas.viewbox(false);
    const padding = { left: 128, right: 32, top: 32, bottom: 32 };
    const width = outer.width - padding.left - padding.right;
    const height = outer.height - padding.top - padding.bottom;
    if (inner.width <= 0 || inner.height <= 0 || width <= 0 || height <= 0) return;
    const scale = Math.min(1, width / inner.width, height / inner.height);
    canvas.viewbox({
      x: inner.x - padding.left / scale - (width / scale - inner.width) / 2,
      y: inner.y - padding.top / scale - (height / scale - inner.height) / 2,
      width: outer.width / scale,
      height: outer.height / scale,
    });
  }, [modeler, host]);

  useEffect(() => {
    if (!host) return;
    const instance = new Modeler({ container: host, moddleExtensions: { camunda: camundaModdle }, bpmnRenderer: bpmnRenderer(mode) } as any);
    setImported('');
    setModeler(instance);
    instance.on('selection.changed', (event: any) => {
      const element = event.newSelection[0];
      setSelected(element?.type === 'bpmn:BusinessRuleTask' ? element : null);
      setDecisionKey(element?.type === 'bpmn:BusinessRuleTask' ? element.businessObject.get('camunda:decisionRef') ?? '' : '');
    });
    return () => { instance.destroy(); setModeler(null); };
  }, [host, setDecisionKey, mode]);

  useEffect(() => { draft.current = null; }, [xml]);

  useEffect(() => {
    if (!modeler || !xml) return;
    let cancelled = false;
    modeler.importXML(draft.current ?? xml).then(() => {
      if (cancelled) return;
      markAiTasks(modeler);
      fitDiagram();
      setImported(xml);
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [modeler, xml, fitDiagram]);

  useEffect(() => {
    if (!host || !modeler) return;
    let timer: number | undefined;
    let frame: number | undefined;
    let previousSize = '';
    const scheduleFit = () => {
      const { width, height } = host.getBoundingClientRect();
      const size = `${width}x${height}`;
      if (size === previousSize) return;
      previousSize = size;
      window.clearTimeout(timer);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      timer = window.setTimeout(() => {
        frame = window.requestAnimationFrame(fitDiagram);
      }, 100);
    };
    const observer = new ResizeObserver(() => {
      scheduleFit();
    });
    observer.observe(host);
    if (host.parentElement) observer.observe(host.parentElement);
    window.addEventListener('resize', scheduleFit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleFit);
      window.clearTimeout(timer);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [host, modeler, fitDiagram]);

  // Any edit makes the drawn path stale, so drop it and tell the parent.
  useEffect(() => {
    if (!modeler) return;
    const onChange = (event: { trigger?: string }) => {
      if (event.trigger === 'clear') return; // fired by importXML, not by an edit
      onEdit();
      modeler.saveXML().then(({ xml: source }) => { draft.current = source ?? null; }).catch(() => {});
    };
    modeler.on('commandStack.changed', onChange);
    return () => modeler.off('commandStack.changed', onChange);
  }, [modeler, onEdit]);

  useEffect(() => {
    if (!modeler || imported !== xml) return;
    if (highlight) highlightPath(modeler, highlight); else clearPath(modeler);
  }, [modeler, imported, xml, highlight]);

  async function saveFromCanvas() {
    if (!modeler) return;
    try {
      setLocalSaveError('');
      const result = await modeler.saveXML({ format: true });
      await onSave(result.xml ?? '');
    } catch (error) { setLocalSaveError(String(error)); }
  }

  function updateDecisionKey(value: string) {
    setDecisionKey(value);
    if (modeler && selected) (modeler.get('modeling') as any).updateProperties(selected, { 'camunda:decisionRef': value });
  }

  return <>
    <div className="editor-toolbar">
      {selected
        ? <label className="key-field"><Typography.Text type="secondary">Decision key</Typography.Text><Input size="small" className="mono" value={decisionKey} onChange={event => updateDecisionKey(event.target.value)} /></label>
        : <Typography.Text type="secondary">Select a business rule task to set its decision key.</Typography.Text>}
      <div className="save-actions"><Typography.Text type={localSaveError ? 'danger' : 'secondary'} role="status">{localSaveError || saveStatus}</Typography.Text><Button icon={<SaveOutlined />} onClick={saveFromCanvas}>Save process</Button></div>
    </div>
    <div className="process-canvas" data-tour="canvas" ref={setHost} />
  </>;
}
