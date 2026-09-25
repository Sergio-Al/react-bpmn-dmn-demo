# ADR 0002: Typed requests and decision-based routing

**Status:** Accepted for Milestone 2 design; implementation in progress. **Source:** [BRIEF.md](../../BRIEF.md).

## Context

The first milestone starts a known process directly. The next milestone must accept one envelope while choosing both the payload contract and the process from a request `type` and `version`. The chosen stack already isolates ZEN behind `DecisionService` and executes BPMN with `bpmn-engine`. [Architecture](../architecture.md), [ADR 0001](0001-stack-a-zen-bpmn-engine.md)

## Decision

Use `{ requestId, type, version, payload }` as the strict envelope. Store a JSON Schema per type/version and validate payload with Ajv. Evaluate a portable ZEN `route-<type>` decision to return `processKey` and optional variables, then start that BPMN process. The API reports payload violations as `400` and an invalid route result as `500`. [Brief](../../BRIEF.md), [request contract](../request-contracts.md)

## Rationale

- **ZEN route decision per type:** Route selection is a business decision over typed payload fields, so it belongs in a small, inspectable first-hit decision table. A BPMN gateway would require starting a process before knowing which process owns the request, and it would mix cross-process dispatch rules into a particular flow. Per-type tables let routing change independently of the processes; the `DecisionService` boundary preserves a later switch to a standard DMN engine. [Brief](../../BRIEF.md), [JDM format](https://docs.gorules.io/developers/jdm/standard), [portability guide](../dmn-portability.md)
- **JSON Schema + Ajv:** JSON Schema files give each published type/version an explicit, machine-readable contract: types, required fields, closed properties, choices, and bounds. Ajv validates the chosen draft and provides structured errors for the `{ path, message }` list. Both JSON Schema and Ajv are available without a paid production license; Ajv is MIT licensed. [JSON Schema object reference](https://json-schema.org/understanding-json-schema/reference/object), [Ajv README](https://github.com/ajv-validator/ajv), [Ajv license](https://github.com/ajv-validator/ajv/blob/master/LICENSE)
- **`500 ROUTING_ERROR`:** Once the envelope and payload pass validation, failure to produce a usable `processKey` means the maintained routing model or process registry is broken. Retrying with a different client payload is not the prescribed fix; operators need to correct the route or deploy the missing process. `400 UNKNOWN_CONTRACT` and `400 CONTRACT_VIOLATION` remain client-facing input errors. [Brief](../../BRIEF.md)

## Consequences

Every new request type needs a contract, a route decision, referenced BPMN processes, service handlers where needed, and branch/error tests. Published contract versions remain immutable; new versions use new files. Route outputs must be checked against available process keys before execution. These obligations are captured in the [adding-a-type checklist](../request-contracts.md#adding-a-new-request-type). [Brief](../../BRIEF.md)
