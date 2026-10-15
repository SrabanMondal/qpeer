CREATE TABLE `business_members` (
	`business_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`business_id`, `user_id`),
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `business_members_user_id_idx` ON `business_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`address` text NOT NULL,
	`phone` text,
	`lat` real,
	`lng` real,
	`geohash` text,
	`hours_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `businesses_status_lat_lng_idx` ON `businesses` (`status`,`lat`,`lng`);--> statement-breakpoint
CREATE INDEX `businesses_owner_user_id_idx` ON `businesses` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `queues` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`settings_json` text NOT NULL,
	`settings_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `queues_business_id_idx` ON `queues` (`business_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `free_lane_blocked_until` integer;--> statement-breakpoint
-- Hand-written: users timestamps move from epoch seconds to epoch milliseconds.
-- The guard (< 1e11, i.e. before 1973 if read as ms) skips rows already in ms.
UPDATE `users` SET `created_at` = `created_at` * 1000 WHERE `created_at` < 100000000000;--> statement-breakpoint
UPDATE `users` SET `updated_at` = `updated_at` * 1000 WHERE `updated_at` < 100000000000;