CREATE TABLE `scheduled_task` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`schedule` text NOT NULL,
	`target` text NOT NULL,
	`message` text NOT NULL,
	`agent` text NOT NULL,
	`model` text,
	`permission_mode` text NOT NULL,
	`timezone` text NOT NULL,
	`enabled` integer NOT NULL,
	`notifications` text NOT NULL,
	`source_session_id` text,
	`next_run_at` integer,
	`last_run_at` integer,
	`deleted_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_task_due_idx` ON `scheduled_task` (`enabled`,`next_run_at`);
--> statement-breakpoint
CREATE INDEX `scheduled_task_source_session_idx` ON `scheduled_task` (`source_session_id`);
--> statement-breakpoint
CREATE INDEX `scheduled_task_deleted_idx` ON `scheduled_task` (`deleted_at`);
--> statement-breakpoint
CREATE TABLE `scheduled_task_run` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`late` integer NOT NULL,
	`attempt` integer NOT NULL,
	`session_id` text,
	`lease_owner` text,
	`lease_expires_at` integer,
	`result` text,
	`error` text,
	`time_started` integer,
	`time_completed` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `scheduled_task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_task_run_task_scheduled_unique` ON `scheduled_task_run` (`task_id`,`scheduled_for`);
--> statement-breakpoint
CREATE INDEX `scheduled_task_run_task_created_idx` ON `scheduled_task_run` (`task_id`,`time_created`);
--> statement-breakpoint
CREATE INDEX `scheduled_task_run_status_scheduled_idx` ON `scheduled_task_run` (`status`,`scheduled_for`);
--> statement-breakpoint
CREATE INDEX `scheduled_task_run_session_idx` ON `scheduled_task_run` (`session_id`);
--> statement-breakpoint
CREATE INDEX `scheduled_task_run_lease_idx` ON `scheduled_task_run` (`status`,`lease_expires_at`);
