# Keeping JDM decisions portable to DMN

The app executes GoRules JDM JSON today; it does **not** claim OMG DMN conformance. Keep the authored subset small so a future exporter can produce DMN 1.x XML with FEEL, then verify behavior in a DMN engine. A visually similar rule table is not proof of identical semantics. [JDM format](https://docs.gorules.io/developers/jdm/standard), [ZEN language](https://docs.gorules.io/learn/zen-language/syntax), [OMG DMN 1.5](https://www.omg.org/spec/DMN/1.5/About-DMN)

## Authoring rules for this project

- Make each decision one JDM decision table between input and output nodes. Give it a stable file/key name, for example `order-discount`; reference that key from BPMN, never a ZEN node ID. [BRIEF.md](../BRIEF.md), [JDM format](https://docs.gorules.io/developers/jdm/standard)
- Use plain scalar inputs/outputs with documented types and stable names. Keep table cells to literals, simple comparisons, lists, and numeric ranges that can be translated to FEEL unary tests; keep output cells to literal values. ZEN's unary test mode supports comparisons, ranges, and lists. [ZEN syntax](https://docs.gorules.io/learn/zen-language/syntax)
- Use first-match only if row order and overlapping rules are intentional. Prefer mutually exclusive rules; then a later DMN `UNIQUE` table can express the intended invariant. For a ZEN `first` table, a DMN `FIRST` table is the direct behavioral candidate. Treat ZEN `collect` as a separate list-output case and check result shape before mapping to DMN `COLLECT`/`RULE ORDER`. GoRules' own migration guide shows that hit policies need explicit mapping. [GoRules migration guide](https://gorules.io/switch/camunda), [DMN hit policies](https://docs.camunda.org/manual/7.24/reference/dmn/decision-table/hit-policy/)
- Specify what happens when no row matches, and test boundaries (`=`, `<`, `<=`, range endpoints), missing/null inputs, number types, and multiple matches in both engines. These are migration acceptance tests, not assumed equivalences. [OMG DMN 1.5](https://www.omg.org/spec/DMN/1.5/PDF)

## Concept mapping

| JDM / app concept | Candidate DMN 1.x representation | Conversion note |
| --- | --- | --- |
| Decision file/key | `<decision id="…" name="…">` | Keep a stable key-to-ID mapping; BPMN references the decision key. |
| JDM input node and named JSON fields | `<inputData>` plus `<informationRequirement>`; table `<input><inputExpression>` | Declare input names and types explicitly. |
| `decisionTableNode` | `<decisionTable>` inside `<decision>` | One table per decision in the portable subset. |
| Input column and cell | `<input>` / `<inputEntry>` with FEEL unary test | Translate syntax and escape XML; do not copy arbitrary ZEN text unchanged. |
| Output column and literal cell | `<output>` / `<outputEntry>` | Preserve output names, scalar types, and literals. |
| `first` / `collect` hit policy | `FIRST` / `COLLECT`, after result-shape checks | `UNIQUE` is possible only when overlap is ruled out. |
| JDM output node | Decision result | Validate scalar/object shape expected by the BPMN variable adapter. |

DMN's decision, input-data, table, input/output entry, and XML schema are defined by [OMG DMN 1.5](https://www.omg.org/spec/DMN/1.5/About-DMN); the JDM graph structure is documented by [GoRules](https://docs.gorules.io/developers/jdm/standard). The table describes an exporter design, not an existing ZEN feature.

## Features to avoid in portable decisions

Do not author Function (JavaScript), Switch/branch, custom, or expression nodes, nested decision calls, or policy-document constructs for this subset. Also avoid ZEN-only functions, JavaScript coercion, string/date helpers, assignments, complex JSON outputs, and mixed-type comparisons in table cells. Some of these could be modeled in DMN with more work, but they are outside the simple conversion contract. [BRIEF.md](../BRIEF.md), [ZEN README](https://github.com/gorules/zen/blob/master/README.md), [ZEN syntax](https://docs.gorules.io/learn/zen-language/syntax)

## Exporter sketch

1. Parse and validate JDM JSON; reject graphs outside the permitted input → one table → output shape and reject unsupported cell syntax or hit policies. GoRules documents the JDM `nodes`/`edges` shape and an editor-exported Zod schema. [JDM format](https://docs.gorules.io/developers/jdm/standard)
2. Resolve the decision key and declared field types. Build a DMN `<definitions>` document targeting a chosen DMN 1.x version, with stable IDs, `<inputData>` elements, one `<decision>`, and one `<decisionTable>`. Validate against that version's OMG XSD. [OMG DMN 1.5 schemas](https://www.omg.org/spec/DMN/1.5/About-DMN)
3. Translate each input condition into FEEL unary-test text and each output literal into a typed FEEL literal. Emit `<inputEntry>` and `<outputEntry>` for every row in its original order; set the checked hit policy. Escape XML and fail with a row/column diagnostic on any unsupported expression. [ZEN syntax](https://docs.gorules.io/learn/zen-language/syntax), [OMG DMN 1.5](https://www.omg.org/spec/DMN/1.5/PDF)
4. Import the XML into the chosen DMN engine and run the same saved cases against ZEN and DMN. Compare output values and types, including no-match and overlap cases, before changing `DecisionService` adapters. [GoRules migration guide](https://gorules.io/switch/camunda)
