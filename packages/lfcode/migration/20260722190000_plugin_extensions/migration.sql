ALTER TABLE `project` ADD `extension` text;
--> statement-breakpoint
CREATE INDEX `project_extension_idx` ON `project` (`extension`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_extension_unique_idx` ON `project` (`extension`);
--> statement-breakpoint
ALTER TABLE `session` ADD `extension` text;
--> statement-breakpoint
CREATE INDEX `session_extension_idx` ON `session` (`extension`);
