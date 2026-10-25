-- Additive only: existing customers remain unassigned; no work/assignee backfill.
ALTER TABLE "customer_accounts" ADD COLUMN "assignedTeamId" INTEGER;
CREATE INDEX "customer_accounts_assignedTeamId_idx" ON "customer_accounts"("assignedTeamId");
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_assignedTeamId_fkey"
FOREIGN KEY ("assignedTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
