import { AnalyticsQuery, EarningsQuery } from "@qpeer/shared";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { parseQuery } from "../../lib/validate";
import {
  membership,
  requireBusinessRole,
  requireRegistered,
} from "../../middleware/guards";
import { businessAnalytics, businessEarnings } from "./service";

/**
 * Insights (Step 5, INS-01…08). Non-members get 404 (no existence leak),
 * like every business route. Analytics: owner and staff (they run the
 * queue). Earnings: owner only (money, same as the Step 4 payments list).
 */
export const insightsRoutes = new Hono<AppEnv>()
  .get(
    "/businesses/:id/analytics",
    requireRegistered(),
    requireBusinessRole("staff", "business"),
    async (c) => {
      const q = parseQuery(c, AnalyticsQuery);
      return c.json(
        await businessAnalytics(
          c.env.DB,
          membership(c).businessId,
          q,
          c.get("clock").now(),
        ),
      );
    },
  )
  .get(
    "/businesses/:id/earnings",
    requireRegistered(),
    requireBusinessRole("owner", "business"),
    async (c) => {
      const q = parseQuery(c, EarningsQuery);
      return c.json(
        await businessEarnings(
          c.env.DB,
          membership(c).businessId,
          q,
          c.get("clock").now(),
        ),
      );
    },
  );
