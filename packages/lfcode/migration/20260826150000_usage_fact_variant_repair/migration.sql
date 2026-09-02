UPDATE usage_fact
SET
  variant = CASE
    WHEN status NOT IN ('completed', 'error', 'aborted')
      AND variant IN ('completed', 'error', 'aborted')
    THEN status
    ELSE variant
  END,
  status = CASE
    WHEN status NOT IN ('completed', 'error', 'aborted')
      AND variant IN ('completed', 'error', 'aborted')
    THEN variant
    ELSE status
  END
WHERE status NOT IN ('completed', 'error', 'aborted')
  AND variant IN ('completed', 'error', 'aborted');
