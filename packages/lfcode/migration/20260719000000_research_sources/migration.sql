CREATE TABLE `research_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`browser_search_engine` text,
	`browser_search_url_template` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_source_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`subject` text NOT NULL,
	`domains` text NOT NULL,
	`paths` text NOT NULL,
	`kind` text NOT NULL,
	`identity` text NOT NULL,
	`official_repository` text,
	`refresh_policy` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_source_profile_project_idx` ON `research_source_profile` (`project_id`,`priority`);
--> statement-breakpoint
CREATE INDEX `research_source_profile_domain_idx` ON `research_source_profile` (`project_id`,`identity`);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_source_profile_project_subject_idx` ON `research_source_profile` (`project_id`,`subject`);
--> statement-breakpoint
CREATE TABLE `research_evidence_record` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_profile_id` text,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`final_url` text,
	`domain` text NOT NULL,
	`title` text,
	`author` text,
	`published_at` text,
	`source_updated_at` text,
	`fetched_at` integer NOT NULL,
	`content_hash` text NOT NULL,
	`etag` text,
	`last_modified` text,
	`excerpts` text NOT NULL,
	`locator` text,
	`attachments` text NOT NULL,
	`body` text,
	`source_identity` text NOT NULL,
	`evidence_status` text NOT NULL,
	`route` text NOT NULL,
	`expires_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`metadata` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`source_profile_id`) REFERENCES `research_source_profile`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_evidence_project_canonical_idx` ON `research_evidence_record` (`project_id`,`canonical_url`);
--> statement-breakpoint
CREATE INDEX `research_evidence_project_fetched_idx` ON `research_evidence_record` (`project_id`,`fetched_at`);
--> statement-breakpoint
CREATE INDEX `research_evidence_project_status_idx` ON `research_evidence_record` (`project_id`,`evidence_status`);
--> statement-breakpoint
CREATE INDEX `research_evidence_profile_idx` ON `research_evidence_record` (`source_profile_id`);
--> statement-breakpoint
CREATE TABLE `research_source_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_profile_id` text,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_check_at` integer,
	`last_checked_at` integer,
	`etag` text,
	`last_modified` text,
	`content_hash` text,
	`failure_summary` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`source_profile_id`) REFERENCES `research_source_profile`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `research_subscription_project_idx` ON `research_source_subscription` (`project_id`,`enabled`);
--> statement-breakpoint
CREATE INDEX `research_subscription_due_idx` ON `research_source_subscription` (`enabled`,`next_check_at`);
--> statement-breakpoint
CREATE TABLE `research_source_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`changed` integer NOT NULL,
	`title` text,
	`url` text,
	`content_hash` text,
	`detail` text NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `research_source_subscription`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `research_observation_subscription_idx` ON `research_source_observation` (`subscription_id`,`observed_at`);
