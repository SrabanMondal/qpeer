ALTER TABLE `devices` ADD `device_hash` text;--> statement-breakpoint
ALTER TABLE `free_lane_strikes` ADD `device_hash` text;--> statement-breakpoint
CREATE INDEX `free_lane_strikes_device_hash_at_idx` ON `free_lane_strikes` (`device_hash`,`at`);--> statement-breakpoint
ALTER TABLE `queue_snapshots` ADD `in_service` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `device_hash` text;--> statement-breakpoint
ALTER TABLE `tokens` ADD `expires_at` integer;