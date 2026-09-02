CREATE TABLE `session_context_status` (
  `session_id` text PRIMARY KEY NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `active_context_tokens` integer NOT NULL DEFAULT 0,
  `context_window_tokens` integer,
  `context_percentage` integer,
  `remaining_context_tokens` integer,
  `provider_id` text,
  `model_id` text,
  `measured_at` integer NOT NULL,
  `measurement_source` text NOT NULL
);
