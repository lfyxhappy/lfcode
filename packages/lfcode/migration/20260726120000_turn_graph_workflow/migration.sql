ALTER TABLE `orchestration_execution` ADD COLUMN `source_message_id` text;
--> statement-breakpoint
ALTER TABLE `orchestration_execution` ADD COLUMN `strategy` text NOT NULL DEFAULT 'auto-workflow';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `orchestration_execution_session_source_message_idx` ON `orchestration_execution` (`session_id`,`source_message_id`);
--> statement-breakpoint
CREATE TABLE `orchestration_task` (
  `execution_id` text NOT NULL REFERENCES `orchestration_execution`(`id`) ON UPDATE no action ON DELETE cascade,
  `node_id` text NOT NULL,
  `id` text NOT NULL,
  `parent_task_id` text,
  `status` text NOT NULL,
  `summary` text NOT NULL,
  `owner` text,
  `read_only` integer NOT NULL,
  `created_at` integer NOT NULL,
  `last_event_at` integer NOT NULL,
  `ended_at` integer,
  PRIMARY KEY(`execution_id`, `node_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `orchestration_task_node_idx` ON `orchestration_task` (`execution_id`,`node_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `orchestration_task_status_idx` ON `orchestration_task` (`execution_id`,`node_id`,`status`);
--> statement-breakpoint
CREATE TABLE `orchestration_task_event` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `execution_id` text NOT NULL REFERENCES `orchestration_execution`(`id`) ON UPDATE no action ON DELETE cascade,
  `node_id` text NOT NULL,
  `task_id` text NOT NULL,
  `at` integer NOT NULL,
  `kind` text NOT NULL,
  `summary` text
);
--> statement-breakpoint
CREATE INDEX `orchestration_task_event_node_idx` ON `orchestration_task_event` (`execution_id`,`node_id`,`task_id`,`at`);
