type Column = { id?: string; field?: string };
type Rule = Record<string, unknown>;
type Table = { inputs?: Column[]; outputs?: Column[]; rules?: Rule[]; hitPolicy?: string };
type Node = { type?: string; content?: Table };

const field = /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/;
const value = '(?:-?\\d+(?:\\.\\d+)?|true|false|null|"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')';
const unary = new RegExp(`^(?:[<>]=?\\s*)?${value}$`);
const range = /^\[\s*-?\d+(?:\.\d+)?\s*\.\.\s*-?\d+(?:\.\d+)?\s*\]$/;
const literal = new RegExp(`^${value}$`);

export function validatePortableDecision(graph: unknown): void {
  const nodes = (graph as { nodes?: Node[] })?.nodes;
  if (!Array.isArray(nodes) || !nodes.some(node => node.type === 'decisionTableNode')) throw new Error('A decision table is required');
  for (const node of nodes) {
    if (node.type === 'inputNode' || node.type === 'outputNode') continue;
    if (node.type !== 'decisionTableNode') throw new Error('Only input, output, and decision table nodes are supported');
    const table = node.content;
    if (!table || !Array.isArray(table.inputs) || !Array.isArray(table.outputs) || !Array.isArray(table.rules)) throw new Error('Invalid decision table');
    if (table.hitPolicy !== 'first') throw new Error('Only first-hit decision tables are supported');
    if ([...table.inputs, ...table.outputs].some(column => !column.id || !column.field || !field.test(column.field))) throw new Error('Table columns need simple field paths');
    for (const rule of table.rules) {
      for (const column of table.inputs) {
        const cell = rule[column.id!];
        if (typeof cell !== 'string' || (cell.trim() && !cell.split(',').every(part => unary.test(part.trim()) || range.test(part.trim())))) {
          throw new Error(`Input cell ${column.id} must use simple FEEL-compatible unary tests`);
        }
      }
      for (const column of table.outputs) {
        const cell = rule[column.id!];
        if (typeof cell !== 'string' || !literal.test(cell.trim())) throw new Error(`Output cell ${column.id} must be a literal`);
      }
    }
  }
}
