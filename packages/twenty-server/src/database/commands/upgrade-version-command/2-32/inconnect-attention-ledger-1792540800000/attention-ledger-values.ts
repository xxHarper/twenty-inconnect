// Immutable SQL definitions, not queries executed by importing this file.
export const ATTENTION_LEDGER_VALUE_FUNCTIONS: readonly string[] = [
  `CREATE FUNCTION core.im_at_keys(value jsonb, keys text[]) RETURNS boolean
   LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $fn$
     SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN
       value ?& keys AND NOT EXISTS (
         SELECT 1 FROM jsonb_object_keys(value) AS fields(field) WHERE NOT field = ANY(keys)
       ) ELSE false END
   $fn$`,
  `CREATE FUNCTION core.im_at_text(value text, maximum_bytes integer) RETURNS boolean
   LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $fn$
     SELECT COALESCE(octet_length(value) BETWEEN 1 AND maximum_bytes AND value = btrim(value,
       chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||
       chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||
       chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||
       chr(8287)||chr(12288)||chr(65279)), false)
   $fn$`,
  `CREATE FUNCTION core.im_at_revision(value text) RETURNS boolean
   LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $fn$
     SELECT COALESCE(value ~ '^(0|[1-9][0-9]*)$' AND value !~ '[^0-9]', false)
   $fn$`,
  `CREATE FUNCTION core.im_at_next_revision(value text) RETURNS text
   LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $fn$
     SELECT CASE WHEN rtrim(value, '9') = '' THEN '1' || repeat('0', length(value))
       ELSE left(rtrim(value, '9'), length(rtrim(value, '9')) - 1) ||
         chr(ascii(right(rtrim(value, '9'), 1)) + 1) ||
         repeat('0', length(value) - length(rtrim(value, '9'))) END
   $fn$`,
  `CREATE FUNCTION core.im_at_compare_revision(left_value text, right_value text) RETURNS integer
   LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $fn$
     SELECT CASE WHEN length(left_value) < length(right_value) THEN -1
       WHEN length(left_value) > length(right_value) THEN 1
       WHEN left_value COLLATE "C" < right_value COLLATE "C" THEN -1
       WHEN left_value COLLATE "C" > right_value COLLATE "C" THEN 1 ELSE 0 END
   $fn$`,
  `CREATE FUNCTION core.im_at_compact(value jsonb) RETURNS text
   LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog AS $fn$
   BEGIN
     IF jsonb_typeof(value) = 'array' THEN
       RETURN '[' || COALESCE((SELECT string_agg(core.im_at_compact(item), ',' ORDER BY ordinal)
         FROM jsonb_array_elements(value) WITH ORDINALITY AS entries(item, ordinal)), '') || ']';
     ELSIF jsonb_typeof(value) = 'object' THEN
       RETURN '{' || COALESCE((SELECT string_agg(to_jsonb(key)::text || ':' || core.im_at_compact(item), ',' ORDER BY key COLLATE "C")
         FROM jsonb_each(value) AS entries(key, item)), '') || '}';
     END IF;
     RETURN value::text;
   END
   $fn$`,
  `CREATE FUNCTION core.im_at_uuid(value jsonb) RETURNS boolean
   LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $fn$
     SELECT COALESCE(jsonb_typeof(value) = 'string' AND value #>> '{}' ~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
   $fn$`,
  `CREATE FUNCTION core.im_at_string(value jsonb, maximum_bytes integer) RETURNS boolean
   LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $fn$
     SELECT COALESCE(jsonb_typeof(value) = 'string' AND core.im_at_text(value #>> '{}', maximum_bytes), false)
   $fn$`,
  `CREATE FUNCTION core.im_at_provenance(value jsonb) RETURNS boolean
   LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $fn$
     SELECT COALESCE(CASE WHEN value->>'kind' = 'HUMAN' THEN
       core.im_at_keys(value, ARRAY['kind','actorWorkspaceMemberId','authorityReference']) AND
       core.im_at_uuid(value->'actorWorkspaceMemberId')
       ELSE value->>'kind' IN ('AUTOMATION','LEGACY_UNKNOWN') AND
         core.im_at_keys(value, ARRAY['kind','authorityReference']) END AND
       core.im_at_string(value->'authorityReference',16384), false)
   $fn$`,
];

export const ATTENTION_LEDGER_VALUE_FUNCTIONS_DOWN: readonly string[] = [
  'DROP FUNCTION core.im_at_provenance(jsonb)',
  'DROP FUNCTION core.im_at_string(jsonb,integer)',
  'DROP FUNCTION core.im_at_uuid(jsonb)',
  'DROP FUNCTION core.im_at_compact(jsonb)',
  'DROP FUNCTION core.im_at_compare_revision(text,text)',
  'DROP FUNCTION core.im_at_next_revision(text)',
  'DROP FUNCTION core.im_at_revision(text)',
  'DROP FUNCTION core.im_at_text(text,integer)',
  'DROP FUNCTION core.im_at_keys(jsonb,text[])',
];
