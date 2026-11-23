import { DecisionGraph, JdmConfigProvider } from '@gorules/jdm-editor';
import '@gorules/jdm-editor/dist/style.css';
import { Typography } from 'antd';
import { antdThemeFor, useThemeMode } from './theme';

export default function DecisionEditor({ graph, onChange }: { graph: any; onChange: (value: any) => void }) {
  const mode = useThemeMode();
  // The JDM editor is built on antd too, so the same tokens keep it consistent with the rest of the app.
  // It takes `mode` instead of antd's `algorithm`.
  const { algorithm: _algorithm, ...theme } = antdThemeFor(mode);
  return <div className="decision-canvas">
    <Typography.Text type="secondary" className="decision-note">Only Request, Response, and Decision table nodes can be saved.</Typography.Text>
    <div className="decision-graph"><JdmConfigProvider theme={{ ...theme, mode }}>{graph && <DecisionGraph value={graph} onChange={onChange} />}</JdmConfigProvider></div>
  </div>;
}
