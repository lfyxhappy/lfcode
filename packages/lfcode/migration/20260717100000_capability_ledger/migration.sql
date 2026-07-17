CREATE TABLE `capability_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`capability` text NOT NULL,
	`scope` text NOT NULL,
	`source` text NOT NULL,
	`expires_at` integer,
	`remaining_budget` integer,
	`revoked` integer DEFAULT false NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `capability_grant_capability_idx` ON `capability_grant` (`capability`);
--> statement-breakpoint
CREATE INDEX `capability_grant_active_idx` ON `capability_grant` (`revoked`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `capability_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`caller` text NOT NULL,
	`capability` text NOT NULL,
	`operation` text NOT NULL,
	`decision` text NOT NULL,
	`target` text,
	`project_id` text,
	`session_id` text,
	`message_id` text,
	`reason` text,
	`metadata` text,
	`result` text,
	`rollback` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `capability_audit_capability_idx` ON `capability_audit` (`capability`,`time_created`);
--> statement-breakpoint
CREATE INDEX `capability_audit_session_idx` ON `capability_audit` (`session_id`,`time_created`);
--> statement-breakpoint
CREATE INDEX `capability_audit_project_idx` ON `capability_audit` (`project_id`,`time_created`);
