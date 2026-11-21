// Public interface of the AI assistant adapters (Ductus
// docs/contracts/ai-request-v1.md, "Port i sintetički adapter"). Areas other
// than `http` import it with `import type` only (docs/server-map.md §2). Only
// the synthetic adapter exists; the real one waits for M9.1 (OA-1).
export {
  SYNTHETIC_BRANCHES,
  createSyntheticAssistant,
  syntheticAnswer,
  type SyntheticAssistant,
  type SyntheticBranch,
} from "./synthetic-assistant.ts";
// What the AI proxy route (server/http/assistant, SRV-1204) needs from the
// domain to drive the port: http may not import domain (docs/server-map.md
// §2), so it reads them here, next to the port they serve.
export {
  AI_POLICIES,
  buildPortInput,
  checkResponse,
  composeInstructions,
  parseAssistantRequest,
  parseProviderEntry,
  PURPOSE_CATALOG_VERSIONS,
  type AiPolicy,
  type AssignmentRules,
  type AssistantPort,
  type AssistantPortInput,
  type AssistantPortOutcome,
  type AssistantRequest,
  type ProviderEntry,
  type ProviderEntryRule,
  type PurposeCatalogVersion,
} from "../../domain/index.ts";
