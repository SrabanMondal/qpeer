import { DurableObject } from "cloudflare:workers";

export class QueueDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )
    `);
  }

  async ping(): Promise<{ ok: true; pings: number }> {
    const rows = this.ctx.storage.sql
      .exec<{ value: number }>("SELECT value FROM meta WHERE key = 'pings'")
      .toArray();

    const currentPings = rows.length > 0 ? rows[0].value : 0;
    const nextPings = currentPings + 1;

    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('pings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      nextPings,
    );

    return { ok: true, pings: nextPings };
  }
}
