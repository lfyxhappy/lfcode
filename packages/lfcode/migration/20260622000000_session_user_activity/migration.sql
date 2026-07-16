ALTER TABLE `session` ADD COLUMN `time_last_user` integer;
ALTER TABLE `project` ADD COLUMN `time_last_user` integer;

UPDATE `session`
SET `time_last_user` = (
  SELECT max(`message`.`time_created`)
  FROM `message`
  WHERE `message`.`session_id` = `session`.`id`
    AND json_extract(`message`.`data`, '$.role') = 'user'
    AND EXISTS (
      SELECT 1
      FROM `part`
      WHERE `part`.`message_id` = `message`.`id`
        AND (
          json_extract(`part`.`data`, '$.type') <> 'text'
          OR (
            coalesce(json_extract(`part`.`data`, '$.synthetic'), 0) = 0
            AND coalesce(json_extract(`part`.`data`, '$.ignored'), 0) = 0
            AND length(trim(coalesce(json_extract(`part`.`data`, '$.text'), ''))) > 0
          )
        )
    )
);

UPDATE `project`
SET `time_last_user` = (
  SELECT max(`session`.`time_last_user`)
  FROM `session`
  WHERE `session`.`project_id` = `project`.`id`
);
