CREATE TABLE `background_job` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`cwd` text NOT NULL,
	`payload` text NOT NULL,
	`env_json` text,
	`pid` integer,
	`exit_code` integer,
	`error` text,
	`source_message_id` text,
	`source_tool_call_id` text,
	`recovery` text,
	`metadata` text,
	`last_log_at` integer,
	`completed_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `background_job_session_idx` ON `background_job` (`session_id`);
--> statement-breakpoint
CREATE INDEX `background_job_status_idx` ON `background_job` (`status`);
--> statement-breakpoint
CREATE INDEX `background_job_session_status_idx` ON `background_job` (`session_id`,`status`);
--> statement-breakpoint
CREATE TABLE `background_job_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`stream` text NOT NULL,
	`text` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `background_job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `background_job_log_job_seq_idx` ON `background_job_log` (`job_id`,`seq`);
--> statement-breakpoint
CREATE INDEX `background_job_log_session_idx` ON `background_job_log` (`session_id`,`at`);
