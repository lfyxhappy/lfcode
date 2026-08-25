UPDATE `message`
SET `data` = json_set(`data`, '$.agent', 'build')
WHERE json_extract(`data`, '$.agent') = 'compose';

DELETE FROM `workflow_run`
WHERE `name` = 'compose-orchestrator';

ALTER TABLE `session` DROP COLUMN `compose_route`;
