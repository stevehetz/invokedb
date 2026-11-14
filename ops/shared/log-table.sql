SET client_min_messages TO WARNING;

CREATE TABLE IF NOT EXISTS log
(
    timestamp timestamp without time zone DEFAULT now(),
    level character varying,
    message character varying,
    meta json
)