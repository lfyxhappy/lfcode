CREATE INDEX `session_project_activity_idx`
ON `session` (`project_id`, coalesce(`time_last_user`, `time_created`) DESC, `id` DESC);

CREATE INDEX `session_activity_idx`
ON `session` (coalesce(`time_last_user`, `time_created`) DESC, `id` DESC);
