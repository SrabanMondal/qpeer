ALTER TABLE `businesses` ADD `public_stats` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `first_listed_at` integer;--> statement-breakpoint
-- Hand-added backfill (MAP-06): businesses listed today count as listed since their first active queue was created.
UPDATE `businesses` SET `first_listed_at` = (
  SELECT MIN(q.`created_at`) FROM `queues` q WHERE q.`business_id` = `businesses`.`id` AND q.`status` = 'active'
) WHERE `status` = 'active' AND `lat` IS NOT NULL AND `lng` IS NOT NULL
  AND EXISTS (SELECT 1 FROM `queues` q WHERE q.`business_id` = `businesses`.`id` AND q.`status` = 'active');
