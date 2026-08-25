CREATE TABLE `usage_fact` (
  `part_id` text PRIMARY KEY NOT NULL,
  `message_id` text NOT NULL,
  `session_id` text NOT NULL,
  `project_id` text NOT NULL REFERENCES `project`(`id`) ON DELETE CASCADE,
  `time_created` integer NOT NULL,
  `agent_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `status` text NOT NULL,
  `input_tokens` integer NOT NULL DEFAULT 0,
  `output_tokens` integer NOT NULL DEFAULT 0,
  `reasoning_tokens` integer NOT NULL DEFAULT 0,
  `cache_read_tokens` integer NOT NULL DEFAULT 0,
  `cache_write_tokens` integer NOT NULL DEFAULT 0,
  `overhead_tokens` integer NOT NULL DEFAULT 0,
  `cost` real NOT NULL DEFAULT 0,
  `overhead_cost` real NOT NULL DEFAULT 0,
  `duration` integer,
  `ttft` integer,
  `submit_to_first_delta` integer,
  `pre_stream` integer
);
--> statement-breakpoint
CREATE INDEX `usage_fact_time_idx` ON `usage_fact` (`time_created`, `part_id`);
--> statement-breakpoint
CREATE INDEX `usage_fact_session_time_idx` ON `usage_fact` (`session_id`, `time_created`, `part_id`);
--> statement-breakpoint
CREATE INDEX `usage_fact_project_time_idx` ON `usage_fact` (`project_id`, `time_created`, `part_id`);
--> statement-breakpoint
CREATE INDEX `usage_fact_provider_model_idx` ON `usage_fact` (`provider_id`, `model_id`, `time_created`);
--> statement-breakpoint
CREATE INDEX `usage_fact_status_idx` ON `usage_fact` (`status`, `time_created`);

-- Existing step-finish parts are copied in the same migration so delivery never
-- depends on a first-run background scan or a partially populated report.
INSERT INTO usage_fact (
  part_id, message_id, session_id, project_id, time_created, agent_id, provider_id, model_id, status,
  input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, overhead_tokens,
  cost, overhead_cost, duration, ttft, submit_to_first_delta, pre_stream
)
SELECT
  p.id,
  p.message_id,
  p.session_id,
  s.project_id,
  p.time_created,
  m.agent_id,
  coalesce(json_extract(m.data, '$.providerID'), ''),
  coalesce(json_extract(m.data, '$.modelID'), ''),
  coalesce(json_extract(p.data, '$.status'), 'completed'),
  coalesce(json_extract(p.data, '$.tokens.input'), 0),
  coalesce(json_extract(p.data, '$.tokens.output'), 0),
  coalesce(json_extract(p.data, '$.tokens.reasoning'), 0),
  coalesce(json_extract(p.data, '$.tokens.cache.read'), 0),
  coalesce(json_extract(p.data, '$.tokens.cache.write'), 0),
  coalesce(json_extract(p.data, '$.overhead.tokens.input'), 0) +
    coalesce(json_extract(p.data, '$.overhead.tokens.output'), 0) +
    coalesce(json_extract(p.data, '$.overhead.tokens.reasoning'), 0) +
    coalesce(json_extract(p.data, '$.overhead.tokens.cache.read'), 0) +
    coalesce(json_extract(p.data, '$.overhead.tokens.cache.write'), 0),
  coalesce(json_extract(p.data, '$.cost'), 0),
  coalesce(json_extract(p.data, '$.overhead.cost'), 0),
  CASE
    WHEN json_extract(p.data, '$.time.start') IS NULL AND json_extract(p.data, '$.time.end') IS NULL THEN NULL
    ELSE max(0, coalesce(json_extract(p.data, '$.time.end'), 0) - coalesce(json_extract(p.data, '$.time.start'), 0))
  END,
  nullif(json_extract(p.data, '$.time.ttft'), 0),
  nullif(json_extract(p.data, '$.time.submit_to_first_delta'), 0),
  nullif(json_extract(p.data, '$.time.pre_stream'), 0)
FROM part p
JOIN message m ON m.id = p.message_id
JOIN session s ON s.id = p.session_id
WHERE json_extract(p.data, '$.type') = 'step-finish';
--> statement-breakpoint

CREATE TABLE `usage_fact_backfill` (
  `id` integer PRIMARY KEY NOT NULL,
  `cursor_time` integer,
  `cursor_part_id` text,
  `completed` integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `usage_fact_backfill` (`id`, `completed`, `updated_at`) VALUES (1, 1, unixepoch() * 1000);
