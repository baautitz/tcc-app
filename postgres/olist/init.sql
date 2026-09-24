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
REVOKE ALL ON SCHEMA olist FROM PUBLIC;
GRANT USAGE ON SCHEMA olist TO olist_reader;

CREATE TABLE olist.customers (
  customer_id varchar(32) PRIMARY KEY,
  customer_unique_id varchar(32) NOT NULL,
  customer_zip_code_prefix varchar(5),
  customer_city text,
  customer_state varchar(2)
);

CREATE TABLE olist.geolocation (
  geolocation_zip_code_prefix varchar(5),
  geolocation_lat double precision,
  geolocation_lng double precision,
  geolocation_city text,
  geolocation_state varchar(2)
);

CREATE TABLE olist.orders (
  order_id varchar(32) PRIMARY KEY,
  customer_id varchar(32) NOT NULL,
  order_status varchar(32) NOT NULL,
  order_purchase_timestamp timestamp NOT NULL,
  order_approved_at timestamp,
  order_delivered_carrier_date timestamp,
  order_delivered_customer_date timestamp,
  order_estimated_delivery_date timestamp
);

CREATE TABLE olist.products (
  product_id varchar(32) PRIMARY KEY,
  product_category_name text,
  product_name_lenght integer,
  product_description_lenght integer,
  product_photos_qty integer,
  product_weight_g integer,
  product_length_cm integer,
  product_height_cm integer,
  product_width_cm integer
);

CREATE TABLE olist.sellers (
  seller_id varchar(32) PRIMARY KEY,
  seller_zip_code_prefix varchar(5),
  seller_city text,
  seller_state varchar(2)
);

CREATE TABLE olist.order_items (
  order_id varchar(32) NOT NULL,
  order_item_id integer NOT NULL,
  product_id varchar(32) NOT NULL,
  seller_id varchar(32) NOT NULL,
  shipping_limit_date timestamp NOT NULL,
  price numeric(12, 2) NOT NULL,
  freight_value numeric(12, 2) NOT NULL,
  PRIMARY KEY (order_id, order_item_id)
);

CREATE TABLE olist.order_payments (
  order_id varchar(32) NOT NULL,
  payment_sequential integer NOT NULL,
  payment_type varchar(32),
  payment_installments integer,
  payment_value numeric(12, 2),
  PRIMARY KEY (order_id, payment_sequential)
);

CREATE TABLE olist.order_reviews (
  review_id varchar(32) NOT NULL,
  order_id varchar(32) NOT NULL,
  review_score integer,
  review_comment_title text,
  review_comment_message text,
  review_creation_date timestamp,
  review_answer_timestamp timestamp
);

CREATE TABLE olist.product_category_name_translation (
  product_category_name text PRIMARY KEY,
  product_category_name_english text NOT NULL
);

COPY olist.customers (customer_id, customer_unique_id, customer_zip_code_prefix, customer_city, customer_state)
  FROM '/docker-entrypoint-initdb.d/data/olist_customers_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY olist.geolocation (geolocation_zip_code_prefix, geolocation_lat, geolocation_lng, geolocation_city, geolocation_state)
  FROM '/docker-entrypoint-initdb.d/data/olist_geolocation_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY olist.orders (order_id, customer_id, order_status, order_purchase_timestamp, order_approved_at, order_delivered_carrier_date, order_delivered_customer_date, order_estimated_delivery_date)
  FROM '/docker-entrypoint-initdb.d/data/olist_orders_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY olist.products (product_id, product_category_name, product_name_lenght, product_description_lenght, product_photos_qty, product_weight_g, product_length_cm, product_height_cm, product_width_cm)
  FROM '/docker-entrypoint-initdb.d/data/olist_products_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY olist.sellers (seller_id, seller_zip_code_prefix, seller_city, seller_state)
  FROM '/docker-entrypoint-initdb.d/data/olist_sellers_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY olist.order_items (order_id, order_item_id, product_id, seller_id, shipping_limit_date, price, freight_value)
  FROM '/docker-entrypoint-initdb.d/data/olist_order_items_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY olist.order_payments (order_id, payment_sequential, payment_type, payment_installments, payment_value)
  FROM '/docker-entrypoint-initdb.d/data/olist_order_payments_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY olist.order_reviews (review_id, order_id, review_score, review_comment_title, review_comment_message, review_creation_date, review_answer_timestamp)
  FROM '/docker-entrypoint-initdb.d/data/olist_order_reviews_dataset.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
COPY olist.product_category_name_translation (product_category_name, product_category_name_english)
  FROM '/docker-entrypoint-initdb.d/data/product_category_name_translation.csv'
  WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

CREATE INDEX orders_customer_id_idx ON olist.orders (customer_id);
CREATE INDEX orders_purchase_timestamp_idx ON olist.orders (order_purchase_timestamp);
CREATE INDEX order_items_product_id_idx ON olist.order_items (product_id);
CREATE INDEX order_items_seller_id_idx ON olist.order_items (seller_id);
CREATE INDEX order_payments_order_id_idx ON olist.order_payments (order_id);
CREATE INDEX order_reviews_order_id_idx ON olist.order_reviews (order_id);
CREATE INDEX products_category_name_idx ON olist.products (product_category_name);

GRANT SELECT ON ALL TABLES IN SCHEMA olist TO olist_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE olist_owner IN SCHEMA olist GRANT SELECT ON TABLES TO olist_reader;

ANALYZE olist.customers;
ANALYZE olist.geolocation;
ANALYZE olist.orders;
ANALYZE olist.products;
ANALYZE olist.sellers;
ANALYZE olist.order_items;
ANALYZE olist.order_payments;
ANALYZE olist.order_reviews;
ANALYZE olist.product_category_name_translation;

COMMIT;
