CREATE TABLE `hook_definition` (
  `id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `description` text NOT NULL, `enabled` integer DEFAULT true NOT NULL,
  `scope` text NOT NULL, `project_id` text, `session_id` text, `owner_session_id` text, `events` text NOT NULL, `matcher` text NOT NULL,
  `handler` text NOT NULL, `lifetime` text NOT NULL, `expiry` text, `remaining_runs` integer, `expired_at` integer, `source` text NOT NULL,
  `time_created` integer NOT NULL, `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hook_definition_scope_idx` ON `hook_definition` (`scope`,`project_id`,`session_id`);
--> statement-breakpoint
CREATE INDEX `hook_definition_enabled_idx` ON `hook_definition` (`enabled`,`time_created`);
--> statement-breakpoint
CREATE TABLE `hook_run` (
  `id` text PRIMARY KEY NOT NULL, `hook_id` text NOT NULL, `session_id` text, `event` text NOT NULL, `status` text NOT NULL,
  `duration_ms` integer NOT NULL, `summary` text NOT NULL, `input` text NOT NULL, `output` text NOT NULL, `time_created` integer NOT NULL,
  FOREIGN KEY (`hook_id`) REFERENCES `hook_definition`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hook_run_hook_time_idx` ON `hook_run` (`hook_id`,`time_created`);
--> statement-breakpoint
CREATE INDEX `hook_run_session_time_idx` ON `hook_run` (`session_id`,`time_created`);
