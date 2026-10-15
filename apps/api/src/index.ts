import { createApp } from "./app";
import { runScheduled } from "./cron/jobs";
import { QueueDO } from "./queue/queue-do";

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron, env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;

export { QueueDO };
