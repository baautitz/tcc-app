\set ON_ERROR_STOP on
\getenv olist_reader_password OLIST_READER_PASSWORD
\if :{?olist_reader_password}
\else
  \echo 'A variável OLIST_READER_PASSWORD é obrigatória.'
  \quit
\endif

BEGIN;

CREATE ROLE olist_reader
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS
  PASSWORD :'olist_reader_password';

REVOKE ALL ON DATABASE olist FROM PUBLIC;
GRANT CONNECT ON DATABASE olist TO olist_reader;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA olist AUTHORIZATION olist_owner;
CREATE SCHEMA staging AUTHORIZATION olist_owner;
REVOKE ALL ON SCHEMA olist FROM PUBLIC;
REVOKE ALL ON SCHEMA staging FROM PUBLIC;
GRANT USAGE ON SCHEMA olist TO olist_reader;

CREATE TABLE olist.states (
  state_code varchar(2) PRIMARY KEY
);

CREATE TABLE olist.cities (
  city_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  state_code varchar(2) NOT NULL REFERENCES olist.states (state_code),
  UNIQUE (name, state_code)
);

CREATE TABLE olist.zip_code_prefixes (
  zip_code_prefix varchar(5) PRIMARY KEY
);

CREATE TABLE olist.geolocations (
  geolocation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  zip_code_prefix varchar(5) NOT NULL REFERENCES olist.zip_code_prefixes (zip_code_prefix),
  city_id bigint NOT NULL REFERENCES olist.cities (city_id),
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  UNIQUE (zip_code_prefix, city_id, latitude, longitude)
);

CREATE TABLE olist.customers (
  customer_unique_id varchar(32) PRIMARY KEY
);

CREATE TABLE olist.order_customers (
  customer_id varchar(32) PRIMARY KEY,
  customer_unique_id varchar(32) NOT NULL REFERENCES olist.customers (customer_unique_id),
  zip_code_prefix varchar(5) NOT NULL REFERENCES olist.zip_code_prefixes (zip_code_prefix),
  city_id bigint NOT NULL REFERENCES olist.cities (city_id)
);

CREATE TABLE olist.order_statuses (
  order_status varchar(32) PRIMARY KEY
);

CREATE TABLE olist.categories (
  category_name text PRIMARY KEY,
  category_name_english text
);

CREATE TABLE olist.products (
  product_id varchar(32) PRIMARY KEY,
  category_name text REFERENCES olist.categories (category_name),
  product_name_length integer,
  product_description_length integer,
  product_photos_qty integer,
  product_weight_g integer,
  product_length_cm integer,
  product_height_cm integer,
  product_width_cm integer
);

CREATE TABLE olist.sellers (
  seller_id varchar(32) PRIMARY KEY,
  zip_code_prefix varchar(5) NOT NULL REFERENCES olist.zip_code_prefixes (zip_code_prefix),
  city_id bigint NOT NULL REFERENCES olist.cities (city_id)
);

CREATE TABLE olist.orders (
  order_id varchar(32) PRIMARY KEY,
  customer_id varchar(32) NOT NULL UNIQUE REFERENCES olist.order_customers (customer_id),
  order_status varchar(32) NOT NULL REFERENCES olist.order_statuses (order_status),
  purchased_at timestamp NOT NULL,
  approved_at timestamp,
  delivered_to_carrier_at timestamp,
  delivered_to_customer_at timestamp,
  estimated_delivery_at timestamp
);

CREATE TABLE olist.order_items (
  order_id varchar(32) NOT NULL REFERENCES olist.orders (order_id),
  order_item_id integer NOT NULL,
  product_id varchar(32) NOT NULL REFERENCES olist.products (product_id),
  seller_id varchar(32) NOT NULL REFERENCES olist.sellers (seller_id),
  shipping_limit_at timestamp NOT NULL,
  price numeric(12, 2) NOT NULL CHECK (price >= 0),
  freight_value numeric(12, 2) NOT NULL CHECK (freight_value >= 0),
  PRIMARY KEY (order_id, order_item_id)
);

CREATE TABLE olist.payment_methods (
  payment_type varchar(32) PRIMARY KEY
);

CREATE TABLE olist.order_payments (
  order_id varchar(32) NOT NULL REFERENCES olist.orders (order_id),
  payment_sequential integer NOT NULL,
  payment_type varchar(32) NOT NULL REFERENCES olist.payment_methods (payment_type),
  payment_installments integer NOT NULL CHECK (payment_installments >= 0),
  payment_value numeric(12, 2) NOT NULL CHECK (payment_value >= 0),
  PRIMARY KEY (order_id, payment_sequential)
);

CREATE TABLE olist.reviews (
  review_id varchar(32) PRIMARY KEY,
  review_score smallint NOT NULL CHECK (review_score BETWEEN 1 AND 5),
  review_comment_title text,
  review_comment_message text,
  created_at timestamp NOT NULL,
  answered_at timestamp
);

CREATE TABLE olist.order_reviews (
  order_id varchar(32) NOT NULL REFERENCES olist.orders (order_id),
  review_id varchar(32) NOT NULL REFERENCES olist.reviews (review_id),
  PRIMARY KEY (order_id, review_id)
);

CREATE TABLE staging.customers (
  customer_id varchar(32),
  customer_unique_id varchar(32),
  customer_zip_code_prefix varchar(5),
  customer_city text,
  customer_state varchar(2)
);

CREATE TABLE staging.geolocation (
  geolocation_zip_code_prefix varchar(5),
  geolocation_lat double precision,
  geolocation_lng double precision,
  geolocation_city text,
  geolocation_state varchar(2)
);

CREATE TABLE staging.orders (
  order_id varchar(32),
  customer_id varchar(32),
  order_status varchar(32),
  order_purchase_timestamp timestamp,
  order_approved_at timestamp,
  order_delivered_carrier_date timestamp,
  order_delivered_customer_date timestamp,
  order_estimated_delivery_date timestamp
);

CREATE TABLE staging.products (
  product_id varchar(32),
  product_category_name text,
  product_name_lenght integer,
  product_description_lenght integer,
  product_photos_qty integer,
  product_weight_g integer,
  product_length_cm integer,
  product_height_cm integer,
  product_width_cm integer
);

CREATE TABLE staging.sellers (
  seller_id varchar(32),
  seller_zip_code_prefix varchar(5),
  seller_city text,
  seller_state varchar(2)
);

CREATE TABLE staging.order_items (
  order_id varchar(32),
  order_item_id integer,
  product_id varchar(32),
  seller_id varchar(32),
  shipping_limit_date timestamp,
  price numeric(12, 2),
  freight_value numeric(12, 2)
);

CREATE TABLE staging.order_payments (
  order_id varchar(32),
  payment_sequential integer,
  payment_type varchar(32),
  payment_installments integer,
  payment_value numeric(12, 2)
);

CREATE TABLE staging.order_reviews (
  review_id varchar(32),
  order_id varchar(32),
  review_score smallint,
  review_comment_title text,
  review_comment_message text,
  review_creation_date timestamp,
  review_answer_timestamp timestamp
);

CREATE TABLE staging.product_category_name_translation (
  product_category_name text,
  product_category_name_english text
);

COPY staging.customers (customer_id, customer_unique_id, customer_zip_code_prefix, customer_city, customer_state)
  FROM '/docker-entrypoint-initdb.d/data/olist_customers_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY staging.geolocation (geolocation_zip_code_prefix, geolocation_lat, geolocation_lng, geolocation_city, geolocation_state)
  FROM '/docker-entrypoint-initdb.d/data/olist_geolocation_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY staging.orders (order_id, customer_id, order_status, order_purchase_timestamp, order_approved_at, order_delivered_carrier_date, order_delivered_customer_date, order_estimated_delivery_date)
  FROM '/docker-entrypoint-initdb.d/data/olist_orders_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY staging.products (product_id, product_category_name, product_name_lenght, product_description_lenght, product_photos_qty, product_weight_g, product_length_cm, product_height_cm, product_width_cm)
  FROM '/docker-entrypoint-initdb.d/data/olist_products_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY staging.sellers (seller_id, seller_zip_code_prefix, seller_city, seller_state)
  FROM '/docker-entrypoint-initdb.d/data/olist_sellers_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY staging.order_items (order_id, order_item_id, product_id, seller_id, shipping_limit_date, price, freight_value)
  FROM '/docker-entrypoint-initdb.d/data/olist_order_items_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY staging.order_payments (order_id, payment_sequential, payment_type, payment_installments, payment_value)
  FROM '/docker-entrypoint-initdb.d/data/olist_order_payments_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY staging.order_reviews (review_id, order_id, review_score, review_comment_title, review_comment_message, review_creation_date, review_answer_timestamp)
  FROM '/docker-entrypoint-initdb.d/data/olist_order_reviews_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY staging.product_category_name_translation (product_category_name, product_category_name_english)
  FROM '/docker-entrypoint-initdb.d/data/product_category_name_translation.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

INSERT INTO olist.states (state_code)
SELECT customer_state FROM staging.customers
UNION
SELECT seller_state FROM staging.sellers
UNION
SELECT geolocation_state FROM staging.geolocation;

INSERT INTO olist.cities (name, state_code)
SELECT customer_city, customer_state FROM staging.customers
UNION
SELECT seller_city, seller_state FROM staging.sellers
UNION
SELECT geolocation_city, geolocation_state FROM staging.geolocation;

INSERT INTO olist.zip_code_prefixes (zip_code_prefix)
SELECT customer_zip_code_prefix FROM staging.customers
UNION
SELECT seller_zip_code_prefix FROM staging.sellers
UNION
SELECT geolocation_zip_code_prefix FROM staging.geolocation;

INSERT INTO olist.geolocations (zip_code_prefix, city_id, latitude, longitude)
SELECT DISTINCT
  geo.geolocation_zip_code_prefix,
  city.city_id,
  geo.geolocation_lat,
  geo.geolocation_lng
FROM staging.geolocation geo
JOIN olist.cities city ON city.name = geo.geolocation_city AND city.state_code = geo.geolocation_state;

INSERT INTO olist.customers (customer_unique_id)
SELECT DISTINCT customer_unique_id
FROM staging.customers;

INSERT INTO olist.order_customers (customer_id, customer_unique_id, zip_code_prefix, city_id)
SELECT
  customer.customer_id,
  customer.customer_unique_id,
  customer.customer_zip_code_prefix,
  city.city_id
FROM staging.customers customer
JOIN olist.cities city ON city.name = customer.customer_city AND city.state_code = customer.customer_state;

INSERT INTO olist.order_statuses (order_status)
SELECT DISTINCT order_status
FROM staging.orders;

WITH category_names AS (
  SELECT product_category_name AS category_name
  FROM staging.products
  WHERE product_category_name IS NOT NULL
  UNION
  SELECT product_category_name
  FROM staging.product_category_name_translation
)
INSERT INTO olist.categories (category_name, category_name_english)
SELECT category_names.category_name, translation.product_category_name_english
FROM category_names
LEFT JOIN staging.product_category_name_translation translation
  ON translation.product_category_name = category_names.category_name;

INSERT INTO olist.products (
  product_id,
  category_name,
  product_name_length,
  product_description_length,
  product_photos_qty,
  product_weight_g,
  product_length_cm,
  product_height_cm,
  product_width_cm
)
SELECT
  product_id,
  product_category_name,
  product_name_lenght,
  product_description_lenght,
  product_photos_qty,
  product_weight_g,
  product_length_cm,
  product_height_cm,
  product_width_cm
FROM staging.products;

INSERT INTO olist.sellers (seller_id, zip_code_prefix, city_id)
SELECT
  seller.seller_id,
  seller.seller_zip_code_prefix,
  city.city_id
FROM staging.sellers seller
JOIN olist.cities city ON city.name = seller.seller_city AND city.state_code = seller.seller_state;

INSERT INTO olist.orders (
  order_id,
  customer_id,
  order_status,
  purchased_at,
  approved_at,
  delivered_to_carrier_at,
  delivered_to_customer_at,
  estimated_delivery_at
)
SELECT
  order_id,
  customer_id,
  order_status,
  order_purchase_timestamp,
  order_approved_at,
  order_delivered_carrier_date,
  order_delivered_customer_date,
  order_estimated_delivery_date
FROM staging.orders;

INSERT INTO olist.order_items (
  order_id,
  order_item_id,
  product_id,
  seller_id,
  shipping_limit_at,
  price,
  freight_value
)
SELECT
  order_id,
  order_item_id,
  product_id,
  seller_id,
  shipping_limit_date,
  price,
  freight_value
FROM staging.order_items;

INSERT INTO olist.payment_methods (payment_type)
SELECT DISTINCT payment_type
FROM staging.order_payments;

INSERT INTO olist.order_payments (
  order_id,
  payment_sequential,
  payment_type,
  payment_installments,
  payment_value
)
SELECT
  order_id,
  payment_sequential,
  payment_type,
  payment_installments,
  payment_value
FROM staging.order_payments;

INSERT INTO olist.reviews (
  review_id,
  review_score,
  review_comment_title,
  review_comment_message,
  created_at,
  answered_at
)
SELECT DISTINCT
  review_id,
  review_score,
  review_comment_title,
  review_comment_message,
  review_creation_date,
  review_answer_timestamp
FROM staging.order_reviews;

INSERT INTO olist.order_reviews (order_id, review_id)
SELECT DISTINCT order_id, review_id
FROM staging.order_reviews;

DROP SCHEMA staging CASCADE;

CREATE INDEX geolocations_zip_code_prefix_idx ON olist.geolocations (zip_code_prefix);
CREATE INDEX order_customers_customer_unique_id_idx ON olist.order_customers (customer_unique_id);
CREATE INDEX order_customers_zip_code_prefix_idx ON olist.order_customers (zip_code_prefix);
CREATE INDEX order_customers_city_id_idx ON olist.order_customers (city_id);
CREATE INDEX products_category_name_idx ON olist.products (category_name);
CREATE INDEX sellers_zip_code_prefix_idx ON olist.sellers (zip_code_prefix);
CREATE INDEX sellers_city_id_idx ON olist.sellers (city_id);
CREATE INDEX order_items_product_id_idx ON olist.order_items (product_id);
CREATE INDEX order_items_seller_id_idx ON olist.order_items (seller_id);
CREATE INDEX order_reviews_review_id_idx ON olist.order_reviews (review_id);

GRANT SELECT ON ALL TABLES IN SCHEMA olist TO olist_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE olist_owner IN SCHEMA olist GRANT SELECT ON TABLES TO olist_reader;

ANALYZE olist.states;
ANALYZE olist.cities;
ANALYZE olist.zip_code_prefixes;
ANALYZE olist.geolocations;
ANALYZE olist.customers;
ANALYZE olist.order_customers;
ANALYZE olist.order_statuses;
ANALYZE olist.categories;
ANALYZE olist.products;
ANALYZE olist.sellers;
ANALYZE olist.orders;
ANALYZE olist.order_items;
ANALYZE olist.payment_methods;
ANALYZE olist.order_payments;
ANALYZE olist.reviews;
ANALYZE olist.order_reviews;

COMMIT;
