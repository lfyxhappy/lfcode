ALTER TABLE `session` ADD COLUMN `temporary` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX `session_temporary_idx` ON `session` (`temporary`);
