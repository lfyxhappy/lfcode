CREATE TABLE `scheduled_task_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`concurrency` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
