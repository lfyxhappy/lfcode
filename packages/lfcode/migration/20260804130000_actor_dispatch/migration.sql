CREATE TABLE `actor_dispatch` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`parent_actor_id` text,
	`agent` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`execution` text NOT NULL,
	`context_mode` text NOT NULL,
	`model` text,
	`payload` text NOT NULL,
	`context_refs` text NOT NULL,
	`declared_files` text NOT NULL,
	`actual_files` text NOT NULL,
	`write_access` integer NOT NULL,
	`result` text,
	`error` text,
	`unread` integer NOT NULL,
	`acknowledged_at` integer,
	`manual_resume` integer NOT NULL,
	`resumed_from` text,
	`attempt` integer NOT NULL,
	`time_started` integer,
	`time_completed` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `actor_dispatch_session_created_idx` ON `actor_dispatch` (`session_id`,`time_created`);
--> statement-breakpoint
CREATE INDEX `actor_dispatch_session_status_idx` ON `actor_dispatch` (`session_id`,`status`);
--> statement-breakpoint
CREATE INDEX `actor_dispatch_actor_idx` ON `actor_dispatch` (`session_id`,`actor_id`);
--> statement-breakpoint
CREATE INDEX `actor_dispatch_status_idx` ON `actor_dispatch` (`status`);
--> statement-breakpoint
CREATE TABLE `actor_dispatch_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`background_concurrency` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
