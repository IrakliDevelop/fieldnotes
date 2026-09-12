import type { RedisHashClient } from './redis-hash-client';

/** Keys and arguments passed to a Lua script, matching node-redis' `eval` options. */
export interface ScriptRunOptions {
  keys: string[];
  arguments: string[];
}

/** Runs a Lua script against Redis, by SHA when the client supports it. */
export type ScriptRunner = (script: string, options: ScriptRunOptions) => Promise<unknown>;

function isNoScriptError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('NOSCRIPT');
}

/**
 * Builds a script runner bound to one client instance. When the client exposes
 * both `scriptLoad` and `evalSha`, each distinct script is loaded once and then
 * evaluated by SHA; a `NOSCRIPT` failure (the server's script cache was flushed
 * or the connection moved to another node) reloads the script and retries once.
 * Clients without the optional methods fall back to plain `EVAL`, so existing
 * implementations keep working unchanged.
 */
export function createScriptRunner(client: RedisHashClient): ScriptRunner {
  const evalScript = client.eval.bind(client);
  const scriptLoad = client.scriptLoad?.bind(client);
  const evalSha = client.evalSha?.bind(client);
  const shaByScript = new Map<string, Promise<string>>();

  const load = (script: string, loader: (source: string) => Promise<string>): Promise<string> => {
    const cached = shaByScript.get(script);
    if (cached) return cached;
    const pending = loader(script);
    shaByScript.set(script, pending);
    pending.catch(() => {
      if (shaByScript.get(script) === pending) shaByScript.delete(script);
    });
    return pending;
  };

  return async (script, options) => {
    if (!scriptLoad || !evalSha) return evalScript(script, options);
    const pending = load(script, scriptLoad);
    const sha = await pending;
    try {
      return await evalSha(sha, options);
    } catch (error) {
      if (!isNoScriptError(error)) throw error;
      // Evict only this call's load: a concurrent NOSCRIPT may already have
      // started the reload, and dropping it would load the script again.
      if (shaByScript.get(script) === pending) shaByScript.delete(script);
      const reloaded = await load(script, scriptLoad);
      return await evalSha(reloaded, options);
    }
  };
}
