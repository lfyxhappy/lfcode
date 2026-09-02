CREATE TABLE `activity` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `parent_activity_id` text,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `current_step` text,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `metadata` text NOT NULL,
  `revision` integer NOT NULL DEFAULT 0,
  `error` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_started` integer,
  `time_completed` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_source_idx` ON `activity` (`source_type`,`source_id`);
--> statement-breakpoint
CREATE INDEX `activity_session_updated_idx` ON `activity` (`session_id`,`time_updated`);
--> statement-breakpoint
CREATE INDEX `activity_parent_idx` ON `activity` (`parent_activity_id`);
--> statement-breakpoint
CREATE INDEX `activity_status_idx` ON `activity` (`status`);
