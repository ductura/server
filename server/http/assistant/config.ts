// The provider configuration of the AI assistant proxy (SRV-1204; Ductus
// docs/contracts/ai-request-v1.md, "Politika"; plan #1662 P7, P8). One
// versioned entry: the version names the configuration the provider and the
// model come from, the entry is one provider and one model. There is exactly
// one, so there is nothing to fall back to after a failure (P7). The entry
// passes the provider ban of D-194 t. 2 in code (`parseProviderEntry`), or the
// configuration is not loaded (P8).
//
// Nothing here names a real provider, a model or an amount (OA-1, OA-2, Q-10):
// the production composition has no configuration and answers ai_disabled;
// tests use provider-test-a and model-test-1.
import {
  parseProviderEntry,
  type ProviderEntry,
  type ProviderEntryRule,
} from "../../external/assistant/index.ts";

/** `config_version` shape of assistant.begin_request. */
export const CONFIG_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type AssistantProviderConfig = {
  readonly configVersion: string;
  readonly provider: ProviderEntry;
};

export type ConfigResult =
  | { readonly ok: true; readonly config: AssistantProviderConfig }
  | { readonly ok: false; readonly rule: ProviderEntryRule | "invalid_config" };

/** The configuration, or why it is not loaded. The shape is closed. */
export function parseAssistantProviderConfig(value: unknown): ConfigResult {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).some((key) => key !== "configVersion" && key !== "provider")
  ) {
    return { ok: false, rule: "invalid_config" };
  }
  const { configVersion, provider } = value as Record<string, unknown>;
  if (typeof configVersion !== "string" || !CONFIG_VERSION_PATTERN.test(configVersion)) {
    return { ok: false, rule: "invalid_config" };
  }
  const entry = parseProviderEntry(provider);
  if (!entry.ok) return { ok: false, rule: entry.rule };
  return { ok: true, config: Object.freeze({ configVersion, provider: entry.entry }) };
}
