import type { Api } from "./http.ts";
import type { Signer } from "./jwt.ts";

/** `/v1/health` must say `env: "loadtest"`; anything else aborts before any write. */
export async function assertLoadtestServer(api: Api): Promise<void> {
  const r = await api.req<{ env?: string }>(
    "GET",
    "/v1/health",
    "/health",
    null,
  );
  if (r.status !== 200 || r.body?.env !== "loadtest") {
    throw new Error(
      `Refusing: ${api.base.origin}/v1/health reports env ${JSON.stringify(r.body?.env ?? null)} (status ${r.status}), not "loadtest".`,
    );
  }
}

/**
 * Closes every queue and wipes the loadtest D1 tables (server side, see
 * apps/api/src/modules/loadtest/service.ts). Retries while DO outboxes drain.
 */
export async function resetServer(
  api: Api,
  signer: Signer,
  log: (m: string) => void,
  maxMs = 90_000,
): Promise<Record<string, number>> {
  const token = signer.token("lt-reset");
  const until = Date.now() + maxMs;
  for (;;) {
    const r = await api.req<{
      done: boolean;
      closedQueues: number;
      pendingOutbox?: number;
      wiped?: Record<string, number>;
    }>("POST", "/v1/loadtest/reset", "/loadtest/reset", token);
    if (r.status === 200 && r.body.done) {
      log(
        `reset: closed ${r.body.closedQueues} queues, wiped ${
          Object.entries(r.body.wiped ?? {})
            .filter(([, n]) => n > 0)
            .map(([t, n]) => `${t} ${n}`)
            .join(", ") || "nothing"
        }`,
      );
      return r.body.wiped ?? {};
    }
    if (r.status !== 409) {
      throw new Error(`reset failed: ${r.status} ${r.code}`);
    }
    if (Date.now() > until) {
      throw new Error(
        `reset: outboxes still draining after ${maxMs / 1000} s (${r.body.pendingOutbox} pending)`,
      );
    }
    log(`reset: waiting for ${r.body.pendingOutbox} outbox items to drain`);
    await new Promise((res) => setTimeout(res, 3_000));
  }
}
