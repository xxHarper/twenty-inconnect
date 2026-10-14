-- Candidate minimal integration fixture, NOT an application initialization.
-- PG0 must never execute this file. PG1 requires independent review first.
-- Supervisor must explicitly prepare uuid-ossp in this disposable cluster.
-- No migration history is fabricated; upgradeMigration starts empty.

CREATE SCHEMA core;

CREATE TABLE core.workspace (
  id uuid PRIMARY KEY,
  "activationStatus" varchar NOT NULL CHECK ("activationStatus" IN (
    'PENDING_CREATION', 'ONGOING_CREATION', 'CREATED', 'ACTIVE', 'INACTIVE', 'SUSPENDED'
  )),
  "deletedAt" timestamptz
);

CREATE TABLE core."objectMetadata" (
  id uuid PRIMARY KEY,
  "workspaceId" uuid NOT NULL REFERENCES core.workspace(id),
  UNIQUE (id, "workspaceId")
);

CREATE TABLE core.role (
  id uuid PRIMARY KEY,
  "workspaceId" uuid NOT NULL REFERENCES core.workspace(id),
  UNIQUE (id, "workspaceId")
);

CREATE TABLE core."userWorkspace" (
  id uuid PRIMARY KEY,
  "workspaceId" uuid NOT NULL REFERENCES core.workspace(id)
);

CREATE TABLE core."inconnectMessagingConfiguration" (
  "workspaceId" uuid NOT NULL,
  "anchorObjectMetadataId" uuid NOT NULL,
  revision bigint NOT NULL DEFAULT '0',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "workStateTrackingBaselineAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PK_INCONNECT_MSG_CONFIG" PRIMARY KEY ("workspaceId"),
  CONSTRAINT "CHK_INCONNECT_MSG_CONFIG_REVISION" CHECK (revision >= 0),
  CONSTRAINT "FK_INCONNECT_MSG_CONFIG_WORKSPACE" FOREIGN KEY ("workspaceId")
    REFERENCES core.workspace(id) ON DELETE CASCADE,
  CONSTRAINT "FK_INCONNECT_MSG_CONFIG_ANCHOR" FOREIGN KEY ("anchorObjectMetadataId", "workspaceId")
    REFERENCES core."objectMetadata"(id, "workspaceId") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "IDX_INCONNECT_MSG_CONFIG_WORKSPACE_ANCHOR_UNIQUE"
  ON core."inconnectMessagingConfiguration" ("workspaceId", "anchorObjectMetadataId");

CREATE TABLE core."upgradeMigration" (
  id uuid NOT NULL DEFAULT public.uuid_generate_v4() PRIMARY KEY,
  name varchar NOT NULL,
  status varchar NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  "executedByVersion" varchar NOT NULL,
  "errorMessage" text,
  "isInitial" boolean NOT NULL DEFAULT false,
  "workspaceId" uuid REFERENCES core.workspace(id) ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "UQ_upgrade_migration_instance"
  ON core."upgradeMigration" (name, attempt) WHERE "workspaceId" IS NULL;
CREATE UNIQUE INDEX "UQ_upgrade_migration_workspace"
  ON core."upgradeMigration" (name, attempt, "workspaceId") WHERE "workspaceId" IS NOT NULL;
CREATE INDEX "IDX_UPGRADE_MIGRATION_WORKSPACE_ID_NAME_ATTEMPT"
  ON core."upgradeMigration" ("workspaceId", name, attempt) WHERE "workspaceId" IS NOT NULL;

-- Only synthetic test identities. TypeORM's soft-delete condition must exclude
-- the fifth row; WorkspaceVersionService must exclude INACTIVE as well.
INSERT INTO core.workspace (id, "activationStatus", "deletedAt") VALUES
  ('10000000-0000-4000-8000-000000000001', 'CREATED', NULL),
  ('10000000-0000-4000-8000-000000000002', 'ACTIVE', NULL),
  ('10000000-0000-4000-8000-000000000003', 'SUSPENDED', NULL),
  ('10000000-0000-4000-8000-000000000004', 'INACTIVE', NULL),
  ('10000000-0000-4000-8000-000000000005', 'ACTIVE', CURRENT_TIMESTAMP);
INSERT INTO core."objectMetadata" (id, "workspaceId") VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');
INSERT INTO core.role (id, "workspaceId") VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');
INSERT INTO core."userWorkspace" (id, "workspaceId") VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
INSERT INTO core."inconnectMessagingConfiguration" ("workspaceId", "anchorObjectMetadataId") VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002');
