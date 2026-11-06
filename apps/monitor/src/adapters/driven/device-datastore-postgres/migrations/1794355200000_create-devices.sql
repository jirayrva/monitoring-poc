-- Up Migration

-- The auth columns mirror the AuthProfile union: only a reference to a secret is stored, never
-- its value. The C collation makes ORDER BY device_id sort by code point, as the DeviceDatastore
-- contract requires, whatever the database's default collation is.
CREATE TABLE devices (
  device_id text COLLATE "C" PRIMARY KEY,
  name text NOT NULL,
  base_url text NOT NULL,
  auth_strategy text NOT NULL CHECK (auth_strategy IN ('none', 'bearer')),
  auth_secret_ref text,
  -- A device not probed yet has been unknown since then.
  registered_at timestamptz NOT NULL,
  CONSTRAINT secret_ref_matches_strategy
    CHECK ((auth_strategy = 'bearer') = (auth_secret_ref IS NOT NULL))
);

-- Down Migration

DROP TABLE devices;
