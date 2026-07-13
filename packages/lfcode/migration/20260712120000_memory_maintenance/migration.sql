CREATE TABLE `memory_record` (
	`id` text PRIMARY KEY NOT NULL,
	`layer` text NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text DEFAULT '' NOT NULL,
	`record_kind` text NOT NULL,
	`source` text NOT NULL,
	`authority` text NOT NULL,
	`freshness` text,
	`search_text` text NOT NULL,
	`body` text NOT NULL,
	`summary` text,
	`projection_path` text,
	`import_origin` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_record_projection_path_unique` ON `memory_record` (`projection_path`);
--> statement-breakpoint
CREATE INDEX `memory_record_scope_idx` ON `memory_record` (`scope`,`scope_id`);
--> statement-breakpoint
CREATE INDEX `memory_record_layer_idx` ON `memory_record` (`layer`);
--> statement-breakpoint
CREATE INDEX `memory_record_projection_idx` ON `memory_record` (`projection_path`);
--> statement-breakpoint
CREATE TABLE `maintenance_run` (
	`id` text PRIMARY KEY NOT NULL,
	`day_key` text NOT NULL,
	`job_kind` text NOT NULL,
	`trigger_source` text NOT NULL,
	`status` text NOT NULL,
	`dream_status` text NOT NULL,
	`distill_status` text NOT NULL,
	`project_ids` text NOT NULL,
	`summary` text,
	`error_excerpt` text,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `maintenance_run_day_idx` ON `maintenance_run` (`day_key`);
--> statement-breakpoint
CREATE INDEX `maintenance_run_status_idx` ON `maintenance_run` (`status`);
--> statement-breakpoint
CREATE TABLE `maintenance_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`candidate_kind` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_path` text,
	`evidence` text NOT NULL,
	`confidence` integer NOT NULL,
	`proposed_summary` text NOT NULL,
	`proposed_patch_preview` text,
	`status` text NOT NULL,
	`applied_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `maintenance_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `maintenance_candidate_run_idx` ON `maintenance_candidate` (`run_id`);
--> statement-breakpoint
CREATE INDEX `maintenance_candidate_status_idx` ON `maintenance_candidate` (`status`);
--> statement-breakpoint
CREATE TABLE `maintenance_lock` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_run_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
