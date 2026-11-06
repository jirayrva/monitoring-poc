-- Up Migration

-- Every status appended, as the history of each device, for offline inspection (R-13). A status is stored whole, as
-- the core hands it over, as only this adapter reads it back. No foreign key to devices: an unregistered device's
-- history stays (Q-16). The id orders a device's statuses as they were appended.
CREATE TABLE device_statuses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id text NOT NULL,
  status jsonb NOT NULL
);

-- Serves the latest status of each device.
CREATE INDEX device_statuses_device_id_id ON device_statuses (device_id, id DESC);

-- Down Migration

DROP TABLE device_statuses;
