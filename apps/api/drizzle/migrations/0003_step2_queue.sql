CREATE TABLE `analytics_hourly` (
	`queue_id` text NOT NULL,
	`business_id` text NOT NULL,
	`hour_start` integer NOT NULL,
	`joins` integer DEFAULT 0 NOT NULL,
	`leaves` integer DEFAULT 0 NOT NULL,
	`served` integer DEFAULT 0 NOT NULL,
	`no_shows` integer DEFAULT 0 NOT NULL,
	`cancels` integer DEFAULT 0 NOT NULL,
	`sum_wait_ms` integer DEFAULT 0 NOT NULL,
	`waits` integer DEFAULT 0 NOT NULL,
	`sum_interval_ms` integer DEFAULT 0 NOT NULL,
	`intervals` integer DEFAULT 0 NOT NULL,
	`eta_hits` integer DEFAULT 0 NOT NULL,
	`eta_total` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`queue_id`, `hour_start`)
);
--> statement-breakpoint
CREATE INDEX `analytics_hourly_business_id_hour_start_idx` ON `analytics_hourly` (`business_id`,`hour_start`);--> statement-breakpoint
CREATE TABLE `devices` (
	`expo_push_token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `devices_user_id_idx` ON `devices` (`user_id`);--> statement-breakpoint
CREATE TABLE `free_lane_strikes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_id` text NOT NULL,
	`at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `free_lane_strikes_user_id_at_idx` ON `free_lane_strikes` (`user_id`,`at`);--> statement-breakpoint
CREATE TABLE `outbox_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`applied_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`token_id` text NOT NULL,
	`expo_push_token` text NOT NULL,
	`kind` text NOT NULL,
	`sent_at` integer NOT NULL,
	`receipt_checked_at` integer,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `push_tickets_receipt_checked_at_idx` ON `push_tickets` (`receipt_checked_at`);--> statement-breakpoint
CREATE TABLE `queue_snapshots` (
	`queue_id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`lat` real,
	`lng` real,
	`is_open` integer NOT NULL,
	`is_paused` integer NOT NULL,
	`waiting` integer NOT NULL,
	`eta_low_ms` integer,
	`eta_high_ms` integer,
	`now_serving` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `queue_snapshots_lat_lng_idx` ON `queue_snapshots` (`lat`,`lng`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`queue_id` text NOT NULL,
	`session_id` text NOT NULL,
	`business_id` text NOT NULL,
	`user_id` text,
	`number` integer NOT NULL,
	`series` text NOT NULL,
	`class` text NOT NULL,
	`method` text NOT NULL,
	`state` text NOT NULL,
	`joined_at` integer NOT NULL,
	`called_at` integer,
	`served_at` integer,
	`ended_at` integer,
	`end_reason` text,
	`payment_id` text,
	`rev` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tokens_user_id_state_idx` ON `tokens` (`user_id`,`state`);--> statement-breakpoint
CREATE INDEX `tokens_queue_id_session_id_idx` ON `tokens` (`queue_id`,`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_queue_session_series_number_uq` ON `tokens` (`queue_id`,`session_id`,`series`,`number`);