# ADR 0001: Stack A — ZEN decisions beside bpmn-engine

**Status:** Accepted for the first milestone. **Context:** [BRIEF.md](../../BRIEF.md).

## Decision

Use an npm-workspaces TypeScript monorepo: React + Vite and `bpmn-js` for process editing, `@gorules/jdm-editor` for decision editing, Fastify and `bpmn-engine` for BPMN execution, and ZEN behind `packages/decisions`' `DecisionService` interface. Store BPMN XML and JDM JSON in files for now. [BRIEF.md](../../BRIEF.md), [bpmn-js](https://github.com/bpmn-io/bpmn-js), [bpmn-engine](https://github.com/paed01/bpmn-engine), [ZEN README](https://github.com/gorules/zen/blob/master/README.md)

This gives the small first milestone an in-process JavaScript/TypeScript BPMN runner and an embeddable decision engine/editor. The `DecisionService` boundary is deliberate: ZEN uses JDM JSON and its own expression language, whereas OMG DMN specifies an XML interchange format and FEEL. GoRules describes translating DMN models into ZEN rather than native DMN execution. [JDM format](https://docs.gorules.io/developers/jdm/standard), [ZEN language](https://docs.gorules.io/learn/zen-language/syntax), [GoRules migration guide](https://gorules.io/switch/camunda), [OMG DMN 1.5](https://www.omg.org/spec/DMN/1.5/About-DMN)

## Alternatives

| Option | Disposition |
| --- | --- |
| Camunda 8 | Rejected under the project's free/open-source-only rule: its core uses Camunda License v1, and production self-managed use requires an Enterprise license. [Camunda licensing](https://docs.camunda.io/docs/reference/licenses/) |
| Operaton | Deferred. Its Apache 2.0 Java engine supports BPMN and native DMN, making it a credible later choice when standard DMN becomes more important; the current milestone favors the selected TypeScript stack and smaller integration surface. [Operaton README](https://github.com/operaton/operaton) |
| ZEN alone | Insufficient for process execution. GoRules says BPMN workflow state, timers, and user tasks remain with an orchestrator. [GoRules migration guide](https://gorules.io/switch/camunda) |

## License and usage notes

ZEN, its [React JDM editor](https://github.com/gorules/jdm-editor), and [bpmn-engine](https://github.com/paed01/bpmn-engine/blob/master/LICENSE) are MIT licensed. [ZEN README](https://github.com/gorules/zen/blob/master/README.md)

`bpmn-js` uses the free [bpmn.io license](https://bpmn.io/license/), an MIT-like license with an additional condition: preserve its visible, unobscured bpmn.io watermark and the license notice. It must remain visible in the app's modeler. This is not a paid production license. [bpmn.io license](https://bpmn.io/license/)

## Consequences

The application must implement and test the BPMN business rule task → `DecisionService` bridge and variable mapping; `bpmn-engine` does not supply a ZEN/DMN integration out of the box. JDM authoring is constrained by [the portability guide](../dmn-portability.md), and migration to a native DMN engine will require conversion and behavior tests. [bpmn-engine examples](https://github.com/paed01/bpmn-engine/blob/master/docs/Examples.md), [GoRules migration guide](https://gorules.io/switch/camunda)
