CREATE TABLE `maintenance_candidate_event` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`action` text NOT NULL,
	`detail` text,
	`time_created` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `maintenance_candidate`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `maintenance_candidate_event_candidate_idx` ON `maintenance_candidate_event` (`candidate_id`,`time_created`);
