CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('victim','donor','volunteer')),
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE needs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  item_type TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  urgency INT NOT NULL DEFAULT 2 CHECK (urgency BETWEEN 1 AND 3),
  location GEOGRAPHY(Point,4326) NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','assigned','delivered')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE resources (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  item_type TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  location GEOGRAPHY(Point,4326) NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','assigned')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  need_id INT REFERENCES needs(id),
  resource_id INT REFERENCES resources(id),
  volunteer_id INT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'assigned',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_needs_location ON needs USING GIST (location);
CREATE INDEX idx_resources_location ON resources USING GIST (location);
