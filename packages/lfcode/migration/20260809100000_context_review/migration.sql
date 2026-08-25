CREATE TABLE `context_review` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_user_message_id` text NOT NULL,
	`source_assistant_message_id` text,
	`reviewer_actor_id` text,
	`status` text NOT NULL,
	`findings` text,
	`error` text,
	`time_completed` integer,
	`time_consumed` integer,
	`time_expired` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `context_review_source_user_idx` ON `context_review` (`session_id`,`source_user_message_id`);
--> statement-breakpoint
CREATE INDEX `context_review_session_status_idx` ON `context_review` (`session_id`,`status`);
--> statement-breakpoint
CREATE INDEX `context_review_session_created_idx` ON `context_review` (`session_id`,`time_created`);
