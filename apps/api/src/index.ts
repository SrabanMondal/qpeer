import { createApp } from "./app";
import { QueueDO } from "./queue-do";

const app = createApp();

export default {
  fetch: app.fetch,
};

export { QueueDO };
