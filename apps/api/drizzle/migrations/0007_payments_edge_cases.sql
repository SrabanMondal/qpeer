ALTER TABLE `payments` ADD `refund_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `refund_retry_at` integer;