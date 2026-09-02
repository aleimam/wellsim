-- Stable content checksum input, not an export endpoint. Administrative drill only.
\set ON_ERROR_STOP on
SELECT format('COPY (SELECT %L AS table_name, to_jsonb(t)::text AS record FROM app.%I t ORDER BY to_jsonb(t)::text) TO STDOUT;', tablename, tablename)
FROM pg_tables WHERE schemaname = 'app' ORDER BY tablename
\gexec
