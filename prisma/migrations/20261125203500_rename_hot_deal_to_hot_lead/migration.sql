-- Campaign/template category values are stored as text on email_templates.
-- LeadStage is a Prisma model mapped to lead_stages, and its HOT_DEAL stage
-- rows are existing CRM pipeline data; leave those rows and sales deals alone.
UPDATE "email_templates"
SET "category" = 'HOT_LEAD',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "category" = 'HOT_DEAL';
