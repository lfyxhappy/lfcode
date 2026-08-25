CREATE TABLE `claude_code_session` (
  `session_id` text PRIMARY KEY NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `claude_session_id` text NOT NULL UNIQUE,
  `directory` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
