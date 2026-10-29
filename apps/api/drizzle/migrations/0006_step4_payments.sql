CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`business_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_business_id_at_idx` ON `ledger_entries` (`business_id`,`at`);--> statement-breakpoint
CREATE INDEX `ledger_entries_payment_id_idx` ON `ledger_entries` (`payment_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`queue_id` text NOT NULL,
	`business_id` text NOT NULL,
	`token_id` text,
	`kind` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`business_share_pct` integer NOT NULL,
	`device_hash` text,
	`razorpay_order_id` text NOT NULL,
	`razorpay_payment_id` text,
	`status` text NOT NULL,
	`refund_id` text,
	`refund_paise` integer,
	`refund_status` text,
	`reason` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_razorpay_order_id_unique` ON `payments` (`razorpay_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_razorpay_payment_id_unique` ON `payments` (`razorpay_payment_id`);--> statement-breakpoint
CREATE INDEX `payments_user_id_created_at_idx` ON `payments` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_status_expires_at_idx` ON `payments` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `payments_queue_device_created_idx` ON `payments` (`queue_id`,`device_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_queue_user_created_idx` ON `payments` (`queue_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_business_created_idx` ON `payments` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_token_id_idx` ON `payments` (`token_id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `webhook_events_received_at_idx` ON `webhook_events` (`received_at`);--> statement-breakpoint
DROP INDEX `tokens_queue_session_series_number_uq`;--> statement-breakpoint
ALTER TABLE `tokens` ADD `check_code` text;--> statement-breakpoint
ALTER TABLE `tokens` ADD `checked_in_at` integer;--> statement-breakpoint
ALTER TABLE `tokens` ADD `missed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_queue_session_series_number_uq` ON `tokens` (`queue_id`,`session_id`,`series`,`number`) WHERE session_id <> '';--> statement-breakpoint
UPDATE `queues` SET `settings_json` = json_set(`settings_json`, '$.priorityPerRegular', 2) WHERE json_extract(`settings_json`, '$.priorityPerRegular') = 0;