-- SOURCE-ONLY proposal. No automatic installation or startup execution.
-- UP: run only through a separately authorized upgrade after review/physical tests.
CREATE TABLE "core"."inconnectLeadPoolOperation" (
  "id" uuid PRIMARY KEY,
  "workspaceId" uuid NOT NULL REFERENCES "core"."workspace" ("id") ON DELETE RESTRICT,
  "actorUserId" uuid NOT NULL REFERENCES "core"."user" ("id") ON DELETE RESTRICT,
  "actorWorkspaceMemberId" uuid NOT NULL,
  "intentionId" uuid NOT NULL,
  "requestHash" text NOT NULL CHECK (length("requestHash") = 64),
  "state" jsonb NOT NULL CHECK (jsonb_typeof("state") = 'object'),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("workspaceId", "actorUserId", "intentionId")
);
CREATE INDEX "IDX_inconnectLeadPoolOperation_actor"
  ON "core"."inconnectLeadPoolOperation" ("workspaceId", "actorUserId", "createdAt");
-- No retention/purge or workspace deletion policy is introduced by this proposal.
-- DOWN (separately authorized; destroys operation/audit history):
-- DROP TABLE "core"."inconnectLeadPoolOperation";
