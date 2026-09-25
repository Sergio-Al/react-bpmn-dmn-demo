import { useCallback, useEffect, useState } from 'react';
import Modeler from 'bpmn-js/lib/Modeler';
import camundaModdle from 'camunda-bpmn-moddle/resources/camunda.json';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';

export default function ProcessEditor({ xml, onSave, saveStatus, decisionKey, setDecisionKey }: {
  xml: string; onSave: (xml: string) => Promise<void>; saveStatus: string; decisionKey: string; setDecisionKey: (value: string) => void;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [modeler, setModeler] = useState<Modeler | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [localSaveError, setLocalSaveError] = useState('');

  const fitDiagram = useCallback(() => {
    if (!modeler) return;
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
  }, [modeler]);

  useEffect(() => {
    if (!host) return;
    const instance = new Modeler({ container: host, moddleExtensions: { camunda: camundaModdle } });
    setModeler(instance);
    instance.on('selection.changed', (event: any) => {
      const element = event.newSelection[0];
      setSelected(element?.type === 'bpmn:BusinessRuleTask' ? element : null);
      setDecisionKey(element?.type === 'bpmn:BusinessRuleTask' ? element.businessObject.get('camunda:decisionRef') ?? '' : '');
    });
    return () => { instance.destroy(); setModeler(null); };
  }, [host, setDecisionKey]);

  useEffect(() => {
    if (!modeler || !xml) return;
    let cancelled = false;
    modeler.importXML(xml).then(() => {
      if (cancelled) return;
      fitDiagram();
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
    <div className="editor-toolbar"><span>Select a business rule task to set its decision key.</span><div className="save-actions"><span role="status">{localSaveError || saveStatus}</span><button onClick={saveFromCanvas}>Save process</button></div></div>
    {selected && <label className="key-field">Decision key <input value={decisionKey} onChange={event => updateDecisionKey(event.target.value)} /></label>}
    <div className="process-canvas" ref={setHost} />
  </>;
}
