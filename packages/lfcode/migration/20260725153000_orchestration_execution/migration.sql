CREATE TABLE `orchestration_execution` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
  `title` text NOT NULL,
  `status` text NOT NULL,
  `error` text,
  `confirmation_reason` text,
  `evidence` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orchestration_execution_session_idx` ON `orchestration_execution` (`session_id`);
--> statement-breakpoint
CREATE INDEX `orchestration_execution_status_idx` ON `orchestration_execution` (`status`);
--> statement-breakpoint
CREATE TABLE `orchestration_node` (
  `id` text PRIMARY KEY NOT NULL,
  `execution_id` text NOT NULL REFERENCES `orchestration_execution`(`id`) ON UPDATE no action ON DELETE cascade,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `title` text NOT NULL,
  `agent` text,
  `actor_id` text,
  `depends_on` text NOT NULL,
  `input` text,
  `acceptance` text,
  `worktree` text,
  `artifact` text,
  `evidence` text,
  `error` text,
  `superseded_by` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orchestration_node_execution_idx` ON `orchestration_node` (`execution_id`);
--> statement-breakpoint
CREATE INDEX `orchestration_node_status_idx` ON `orchestration_node` (`execution_id`,`status`);
--> statement-breakpoint
CREATE TABLE `orchestration_event` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `execution_id` text NOT NULL REFERENCES `orchestration_execution`(`id`) ON UPDATE no action ON DELETE cascade,
  `node_id` text REFERENCES `orchestration_node`(`id`) ON UPDATE no action ON DELETE cascade,
  `kind` text NOT NULL,
  `summary` text,
  `payload` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orchestration_event_execution_idx` ON `orchestration_event` (`execution_id`,`created_at`);
