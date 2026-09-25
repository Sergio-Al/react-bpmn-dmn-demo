import { DecisionGraph, JdmConfigProvider } from '@gorules/jdm-editor';
import '@gorules/jdm-editor/dist/style.css';

export default function DecisionEditor({ graph, onChange }: { graph: any; onChange: (value: any) => void }) {
  return <div className="decision-canvas"><p className="decision-note">Only Request, Response, and Decision table nodes can be saved.</p><div className="decision-graph"><JdmConfigProvider>{graph && <DecisionGraph value={graph} onChange={onChange} />}</JdmConfigProvider></div></div>;
}
