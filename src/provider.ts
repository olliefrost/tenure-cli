import process from "node:process";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
export const DEFAULT_OPENAI_MODEL = "gpt-4.1";

export type Provider = "anthropic" | "openai";

export interface ResolvedProvider {
  provider: Provider;
  model: string;
}

export function resolveProvider(model?: string): ResolvedProvider {
  const env = readProviderEnv();
  if (!env.hasAnyKey) {
    throw new Error("Missing API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
  }

  const provider = model
    ? resolveProviderForModel(model, env)
    : resolveDefaultProvider(env);

  return {
    provider,
    model: model ?? defaultModelFor(provider)
  };
}

function resolveProviderForModel(
  model: string,
  env: ProviderEnv
): Provider {
  const inferredProvider = inferProviderFromModel(model);
  if (inferredProvider) {
    assertProviderKeyIsAvailable(inferredProvider, model, env);
    return inferredProvider;
  }

  if (env.hasSingleProvider) {
    return env.hasAnthropicKey ? "anthropic" : "openai";
  }

  throw new Error(
    `Cannot infer provider from model "${model}". Use a recognizable model name (e.g. "claude-..." or "gpt-...").`
  );
}

function assertProviderKeyIsAvailable(
  provider: Provider,
  model: string,
  env: ProviderEnv
): void {
  if (provider === "anthropic" && !env.hasAnthropicKey) {
    throw new Error(
      `Model "${model}" requires ANTHROPIC_API_KEY, but it is not set.`
    );
  }

  if (provider === "openai" && !env.hasOpenAIKey) {
    throw new Error(`Model "${model}" requires OPENAI_API_KEY, but it is not set.`);
  }
}

function resolveDefaultProvider(env: ProviderEnv): Provider {
  // Keep Anthropic as first default when both keys are available.
  return env.hasAnthropicKey ? "anthropic" : "openai";
}

function defaultModelFor(provider: Provider): string {
  return provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL;
}

function inferProviderFromModel(model: string): Provider | undefined {
  if (looksLikeAnthropicModel(model)) {
    return "anthropic";
  }
  if (looksLikeOpenAIModel(model)) {
    return "openai";
  }
  return undefined;
}

function looksLikeAnthropicModel(model: string): boolean {
  return model.toLowerCase().startsWith("claude");
}

function looksLikeOpenAIModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.startsWith("gpt") || normalized.startsWith("o");
}

interface ProviderEnv {
  hasAnthropicKey: boolean;
  hasOpenAIKey: boolean;
  hasAnyKey: boolean;
  hasSingleProvider: boolean;
}

function readProviderEnv(): ProviderEnv {
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
  return {
    hasAnthropicKey,
    hasOpenAIKey,
    hasAnyKey: hasAnthropicKey || hasOpenAIKey,
    hasSingleProvider: hasAnthropicKey !== hasOpenAIKey
  };
}
