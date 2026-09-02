ALTER TABLE `session` ADD COLUMN `recoverable` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `recoverable_reason` text;
--> statement-breakpoint
CREATE INDEX `session_recoverable_idx` ON `session` (`recoverable`);
