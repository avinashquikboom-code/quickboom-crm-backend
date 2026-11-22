-- The coupon schema objects in this migration were already introduced by
-- 20261008143000_extend_subscription_coupons. Keep this migration in history,
-- but verify the resulting schema instead of attempting duplicate DDL.
-- This intentionally fails closed if a database is missing or has drifted from
-- the expected schema; it never modifies existing coupon or subscription data.
DO $coupon_schema_check$
DECLARE
  mismatch TEXT;
BEGIN
  WITH expected_columns (table_name, column_name, data_type, is_nullable, default_fragment) AS (
    VALUES
      ('customer_subscriptions', 'couponCode', 'text', 'YES', NULL),
      ('customer_subscriptions', 'originalAmount', 'double precision', 'YES', NULL),
      ('customer_subscriptions', 'discountAmount', 'double precision', 'YES', NULL),
      ('customer_subscriptions', 'paidAmount', 'double precision', 'YES', NULL),
      ('Coupon', 'appliesToAllPlans', 'boolean', 'NO', 'true'),
      ('Coupon', 'description', 'text', 'YES', NULL),
      ('Coupon', 'discountType', 'text', 'NO', 'percentage'),
      ('Coupon', 'discountValue', 'double precision', 'YES', NULL),
      ('Coupon', 'maximumDiscountAmount', 'double precision', 'YES', NULL),
      ('Coupon', 'minimumAmount', 'double precision', 'YES', NULL),
      ('Coupon', 'name', 'text', 'YES', NULL),
      ('Coupon', 'perCustomerLimit', 'integer', 'NO', '1'),
      ('Coupon', 'startsAt', 'timestamp without time zone', 'YES', NULL),
      ('PaymentHistory', 'couponCode', 'text', 'YES', NULL),
      ('PaymentHistory', 'couponId', 'integer', 'YES', NULL),
      ('PaymentHistory', 'discountAmount', 'double precision', 'YES', NULL),
      ('PaymentHistory', 'originalAmount', 'double precision', 'YES', NULL),
      ('coupon_plans', 'couponId', 'integer', 'NO', NULL),
      ('coupon_plans', 'planId', 'integer', 'NO', NULL),
      ('coupon_redemptions', 'id', 'integer', 'NO', 'nextval'),
      ('coupon_redemptions', 'couponId', 'integer', 'NO', NULL),
      ('coupon_redemptions', 'customerId', 'integer', 'NO', NULL),
      ('coupon_redemptions', 'planId', 'integer', 'NO', NULL),
      ('coupon_redemptions', 'subscriptionId', 'integer', 'YES', NULL),
      ('coupon_redemptions', 'paymentId', 'integer', 'YES', NULL),
      ('coupon_redemptions', 'couponCode', 'text', 'NO', NULL),
      ('coupon_redemptions', 'originalAmount', 'double precision', 'NO', NULL),
      ('coupon_redemptions', 'discountAmount', 'double precision', 'NO', NULL),
      ('coupon_redemptions', 'finalAmount', 'double precision', 'NO', NULL),
      ('coupon_redemptions', 'redeemedAt', 'timestamp without time zone', 'NO', 'current_timestamp')
  )
  SELECT format(
    '%I.%I expected type %s nullable=%s default fragment=%s; found type %s nullable=%s default=%s',
    expected.table_name,
    expected.column_name,
    expected.data_type,
    expected.is_nullable,
    coalesce(expected.default_fragment, '<none>'),
    coalesce(actual.data_type, '<missing>'),
    coalesce(actual.is_nullable, '<missing>'),
    coalesce(actual.column_default, '<none>')
  )
  INTO mismatch
  FROM expected_columns AS expected
  LEFT JOIN information_schema.columns AS actual
    ON actual.table_schema = current_schema()
   AND actual.table_name = expected.table_name
   AND actual.column_name = expected.column_name
  WHERE actual.column_name IS NULL
     OR actual.data_type <> expected.data_type
     OR actual.is_nullable <> expected.is_nullable
     OR (expected.default_fragment IS NULL AND actual.column_default IS NOT NULL)
     OR (expected.default_fragment IS NOT NULL AND position(lower(expected.default_fragment) IN lower(coalesce(actual.column_default, ''))) = 0)
  LIMIT 1;

  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'Coupon migration schema verification failed: %', mismatch;
  END IF;

  WITH expected_indexes (index_name, table_name, is_unique, is_primary, columns_fragment) AS (
    VALUES
      ('coupon_plans_pkey', 'coupon_plans', true, true, '("couponId", "planId")'),
      ('coupon_redemptions_pkey', 'coupon_redemptions', true, true, '(id)'),
      ('coupon_redemptions_paymentId_key', 'coupon_redemptions', true, false, '("paymentId")'),
      ('coupon_redemptions_couponId_customerId_idx', 'coupon_redemptions', false, false, '("couponId", "customerId")'),
      ('Coupon_deletedAt_idx', 'Coupon', false, false, '("deletedAt")')
  )
  SELECT format('index %I on %I expected unique=%s primary=%s columns=%s', expected.index_name, expected.table_name, expected.is_unique, expected.is_primary, expected.columns_fragment)
  INTO mismatch
  FROM expected_indexes AS expected
  LEFT JOIN pg_class AS index_relation
    ON index_relation.relname = expected.index_name
   AND index_relation.relnamespace = to_regnamespace(current_schema())
  LEFT JOIN pg_index AS index_info
    ON index_info.indexrelid = index_relation.oid
   AND index_info.indrelid = to_regclass(format('%I.%I', current_schema(), expected.table_name))
  WHERE index_info.indexrelid IS NULL
     OR index_info.indisunique <> expected.is_unique
     OR index_info.indisprimary <> expected.is_primary
     OR position(expected.columns_fragment IN pg_get_indexdef(index_info.indexrelid)) = 0
  LIMIT 1;

  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'Coupon migration index verification failed: %', mismatch;
  END IF;

  WITH expected_foreign_keys (constraint_name, source_table, source_column, target_table, target_column, delete_action, update_action) AS (
    VALUES
      ('coupon_plans_couponId_fkey', 'coupon_plans', 'couponId', 'Coupon', 'id', 'c', 'c'),
      ('coupon_plans_planId_fkey', 'coupon_plans', 'planId', 'Plan', 'id', 'c', 'c'),
      ('coupon_redemptions_couponId_fkey', 'coupon_redemptions', 'couponId', 'Coupon', 'id', 'r', 'c'),
      ('coupon_redemptions_customerId_fkey', 'coupon_redemptions', 'customerId', 'customers', 'id', 'c', 'c'),
      ('coupon_redemptions_planId_fkey', 'coupon_redemptions', 'planId', 'Plan', 'id', 'r', 'c'),
      ('coupon_redemptions_subscriptionId_fkey', 'coupon_redemptions', 'subscriptionId', 'customer_subscriptions', 'id', 'n', 'c'),
      ('coupon_redemptions_paymentId_fkey', 'coupon_redemptions', 'paymentId', 'PaymentHistory', 'id', 'n', 'c'),
      ('PaymentHistory_couponId_fkey', 'PaymentHistory', 'couponId', 'Coupon', 'id', 'n', 'c')
  )
  SELECT format('foreign key %I expected %I.%I -> %I.%I delete=%s update=%s', expected.constraint_name, expected.source_table, expected.source_column, expected.target_table, expected.target_column, expected.delete_action, expected.update_action)
  INTO mismatch
  FROM expected_foreign_keys AS expected
  LEFT JOIN pg_class AS source_table
    ON source_table.oid = to_regclass(format('%I.%I', current_schema(), expected.source_table))
  LEFT JOIN pg_class AS target_table
    ON target_table.oid = to_regclass(format('%I.%I', current_schema(), expected.target_table))
  LEFT JOIN pg_attribute AS source_column
    ON source_column.attrelid = source_table.oid
   AND source_column.attname = expected.source_column
   AND NOT source_column.attisdropped
  LEFT JOIN pg_attribute AS target_column
    ON target_column.attrelid = target_table.oid
   AND target_column.attname = expected.target_column
   AND NOT target_column.attisdropped
  LEFT JOIN pg_constraint AS constraint_info
    ON constraint_info.conname = expected.constraint_name
   AND constraint_info.conrelid = source_table.oid
   AND constraint_info.confrelid = target_table.oid
   AND constraint_info.contype = 'f'
   AND constraint_info.conkey = ARRAY[source_column.attnum]::smallint[]
   AND constraint_info.confkey = ARRAY[target_column.attnum]::smallint[]
   AND constraint_info.confdeltype::text = expected.delete_action
   AND constraint_info.confupdtype::text = expected.update_action
  WHERE constraint_info.oid IS NULL
  LIMIT 1;

  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'Coupon migration foreign key verification failed: %', mismatch;
  END IF;
END
$coupon_schema_check$;
