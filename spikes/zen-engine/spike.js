const { performance } = require('node:perf_hooks');
const { ZenEngine } = require('@gorules/zen-engine');

const jdm = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [
    { id: 'input', type: 'inputNode', name: 'Order', position: { x: 0, y: 0 } },
    {
      id: 'discount', type: 'decisionTableNode', name: 'Discount', position: { x: 200, y: 0 },
      content: {
        hitPolicy: 'first',
        inputs: [
          { id: 'tier', name: 'Tier', field: 'customerTier' },
          { id: 'total', name: 'Total', field: 'orderTotal' },
        ],
        outputs: [{ id: 'rate', name: 'Discount rate', field: 'discountRate' }],
        rules: [
          { _id: 'gold-large', tier: '"gold"', total: '>= 100', rate: '0.15' },
          { _id: 'gold', tier: '"gold"', total: '', rate: '0.10' },
          { _id: 'default', tier: '', total: '', rate: '0' },
        ],
      },
    },
  ],
  edges: [{ id: 'input-to-discount', type: 'edge', sourceId: 'input', targetId: 'discount' }],
};

const dmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="discounts" name="Discounts" namespace="https://example.org/discounts">
  <inputData id="tier" name="customerTier"><variable id="tierVar" name="customerTier" typeRef="string"/></inputData>
  <decision id="discount" name="discountRate">
    <variable id="discountVar" name="discountRate" typeRef="number"/>
    <informationRequirement><requiredInput href="#tier"/></informationRequirement>
    <decisionTable id="table" hitPolicy="FIRST">
      <input id="tierInput"><inputExpression id="tierExpr" typeRef="string"><text>customerTier</text></inputExpression></input>
      <output id="rateOutput" name="discountRate" typeRef="number"/>
      <rule id="goldRule"><inputEntry id="goldTest"><text>"gold"</text></inputEntry><outputEntry id="goldRate"><text>0.1</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>`;

async function main() {
  const engine = new ZenEngine();
  const loadStart = performance.now();
  const decision = engine.createDecision(Buffer.from(JSON.stringify(jdm)));
  console.log('JDM load ms:', (performance.now() - loadStart).toFixed(3));
  for (const input of [
    { customerTier: 'gold', orderTotal: 150 },
    { customerTier: 'gold', orderTotal: 50 },
    { customerTier: 'silver', orderTotal: 150 },
  ]) {
    const start = performance.now();
    const result = await decision.evaluate(input);
    console.log('JDM result:', JSON.stringify({ input, output: result.result, enginePerformance: result.performance, wallMs: +(performance.now() - start).toFixed(3) }));
  }
  try {
    engine.createDecision(Buffer.from(dmnXml));
    console.log('DMN XML: loaded');
  } catch (error) {
    console.log('DMN XML error:', error.message);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
