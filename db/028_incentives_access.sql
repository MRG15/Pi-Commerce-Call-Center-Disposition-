-- "Incentives" access (finance team): only the Incentives tab in Analytics and its downloads.
-- Granted and removed by Super Admins in Manage Access.
ALTER TABLE workspace_access DROP CONSTRAINT IF EXISTS workspace_access_workspace_check;
ALTER TABLE workspace_access ADD CONSTRAINT workspace_access_workspace_check CHECK (workspace IN ('seller','onboarding','csm','incentives'));
