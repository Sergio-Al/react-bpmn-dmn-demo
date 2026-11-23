// Draws a completed run onto a bpmn-js canvas (Modeler or Viewer): the nodes and
// sequence flows the engine went through stand out, everything else fades back.

type Element = {
  id: string; type: string; waypoints?: unknown;
  source?: Element; target?: Element; labelTarget?: Element;
  businessObject?: { implementation?: string; get?: (name: string) => unknown };
};
type Diagram = { get: (name: string) => any };

const MARKERS = ['path-taken', 'path-skipped', 'path-run'];

/** Service tasks that call Jev get the AI accent, run or not. */
export function markAiTasks(diagram: Diagram) {
  const canvas = diagram.get('canvas');
  const registry = diagram.get('elementRegistry');
  registry.filter((element: Element) => String(element.businessObject?.implementation ?? '').includes('assessWithJev'))
    .forEach((element: Element) => canvas.addMarker(element, 'is-ai'));
}

export function clearPath(diagram: Diagram) {
  const canvas = diagram.get('canvas');
  const registry = diagram.get('elementRegistry');
  registry.getAll().forEach((element: Element) => {
    MARKERS.forEach(marker => canvas.removeMarker(element, marker));
    registry.getGraphics(element)?.style.removeProperty('--step');
  });
}

/**
 * `path` is the ordered list of activity ids the engine started. A flow counts as
 * taken when its source and target are consecutive in that list.
 */
export function highlightPath(diagram: Diagram, path: string[]) {
  clearPath(diagram);
  if (!path.length) return;
  const canvas = diagram.get('canvas');
  const registry = diagram.get('elementRegistry');
  const root = canvas.getRootElement();
  const step = new Map<string, number>();
  path.forEach((id, index) => { if (!step.has(id)) step.set(id, index * 2); });
  const elements: Element[] = registry.getAll().filter((element: Element) => element !== root);

  for (const element of elements) {
    if (!element.waypoints || !element.source || !element.target) continue;
    for (let index = 0; index < path.length - 1; index++) {
      if (path[index] === element.source.id && path[index + 1] === element.target.id) { step.set(element.id, index * 2 + 1); break; }
    }
  }

  for (const element of elements) {
    const owner = element.labelTarget ?? element;
    const order = step.get(owner.id);
    canvas.addMarker(element, 'path-run');
    if (order === undefined) { canvas.addMarker(element, 'path-skipped'); continue; }
    // External labels (events, gateways, flows) only fade with their owner; stroking text blurs it.
    if (element.labelTarget) continue;
    canvas.addMarker(element, 'path-taken');
    registry.getGraphics(element)?.style.setProperty('--step', String(order));
  }
}
