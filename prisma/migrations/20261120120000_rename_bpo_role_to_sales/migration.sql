-- Rename the legacy BPO employee role in place. Keep all IDs, UserRole and
-- RolePermission rows intact. If a same-customer Sales role already exists,
-- merge only missing links into it before removing the duplicate legacy role.
BEGIN;

DO $$
DECLARE legacy_role RECORD;
DECLARE sales_role_id INTEGER;
BEGIN
  FOR legacy_role IN
    SELECT id, "customerId", name
    FROM "Role"
    WHERE upper(name) IN ('BPO', 'BPO_EXECUTIVE')
      AND "deletedAt" IS NULL
    ORDER BY id
  LOOP
    SELECT id INTO sales_role_id
    FROM "Role"
    WHERE "customerId" IS NOT DISTINCT FROM legacy_role."customerId"
      AND upper(name) = CASE upper(legacy_role.name)
        WHEN 'BPO_EXECUTIVE' THEN 'SALES_TELECALLER'
        ELSE 'SALES'
      END
      AND "deletedAt" IS NULL
      AND id <> legacy_role.id
    ORDER BY id
    LIMIT 1;

    IF sales_role_id IS NULL THEN
      UPDATE "Role"
      SET name = CASE upper(legacy_role.name)
          WHEN 'BPO_EXECUTIVE' THEN 'SALES_TELECALLER'
          ELSE 'SALES'
        END,
        description = CASE upper(legacy_role.name)
          WHEN 'BPO_EXECUTIVE' THEN 'Sales Telecaller role for CRM capture and lead follow-ups'
          ELSE 'Sales role for CRM follow-ups and visits'
        END,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = legacy_role.id;
    ELSE
      INSERT INTO "UserRole" ("userId", "roleId")
      SELECT "userId", sales_role_id FROM "UserRole"
      WHERE "roleId" = legacy_role.id
      ON CONFLICT ("userId", "roleId") DO NOTHING;

      INSERT INTO "RolePermission" ("roleId", "permissionId")
      SELECT sales_role_id, "permissionId" FROM "RolePermission"
      WHERE "roleId" = legacy_role.id
      ON CONFLICT ("roleId", "permissionId") DO NOTHING;

      -- designationId is unique; move the designation only if the destination
      -- Sales role is not already linked to one.
      UPDATE "Role" destination
      SET "designationId" = source."designationId"
      FROM "Role" source
      WHERE source.id = legacy_role.id
        AND destination.id = sales_role_id
        AND destination."designationId" IS NULL
        AND source."designationId" IS NOT NULL;

      DELETE FROM "UserRole" WHERE "roleId" = legacy_role.id;
      DELETE FROM "RolePermission" WHERE "roleId" = legacy_role.id;
      DELETE FROM "Role" WHERE id = legacy_role.id;
    END IF;
    sales_role_id := NULL;
  END LOOP;
END $$;

-- Preserve employee records and user IDs. Department/designation display names
-- are intentionally not rewritten because they can encode real business units.
COMMIT;
