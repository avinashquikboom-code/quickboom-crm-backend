-- CreateIndex
CREATE INDEX "leads_customer_id_deleted_at_created_at_idx" ON "leads"("customer_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "leads_customer_id_status_deleted_at_idx" ON "leads"("customer_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "tasks_customer_id_deleted_at_created_at_idx" ON "tasks"("customer_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "tasks_assigned_to_id_status_deleted_at_idx" ON "tasks"("assigned_to_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "notifications_customer_id_created_at_idx" ON "notifications"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "data_capture_places_customer_id_deleted_at_created_at_idx" ON "data_capture_places"("customer_id", "deleted_at", "created_at");
