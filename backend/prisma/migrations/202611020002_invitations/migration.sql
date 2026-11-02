-- Additive migration: no existing data, tables or applied migrations are changed.
CREATE TABLE "tomasini"."Invitation" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "role" "tomasini"."Role" NOT NULL,
    "name" VARCHAR(120),
    "driverId" UUID,
    "createdById" UUID NOT NULL,
    "acceptedById" UUID,
    "revokedById" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Invitation_driver_role" CHECK ("driverId" IS NULL OR "role" = 'DRIVER'),
    CONSTRAINT "Invitation_single_terminal_state" CHECK ("acceptedAt" IS NULL OR "revokedAt" IS NULL),
    CONSTRAINT "Invitation_acceptor_consistent" CHECK (("acceptedAt" IS NULL) = ("acceptedById" IS NULL)),
    CONSTRAINT "Invitation_revoker_consistent" CHECK (("revokedAt" IS NULL) = ("revokedById" IS NULL)),
    CONSTRAINT "Invitation_expiry_after_creation" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "tomasini"."Invitation"("tokenHash");
CREATE INDEX "Invitation_createdAt_idx" ON "tomasini"."Invitation"("createdAt");
CREATE INDEX "Invitation_driverId_acceptedAt_revokedAt_idx" ON "tomasini"."Invitation"("driverId", "acceptedAt", "revokedAt");
CREATE INDEX "Invitation_expiresAt_idx" ON "tomasini"."Invitation"("expiresAt");

ALTER TABLE "tomasini"."Invitation" ADD CONSTRAINT "Invitation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "tomasini"."Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tomasini"."Invitation" ADD CONSTRAINT "Invitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "tomasini"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tomasini"."Invitation" ADD CONSTRAINT "Invitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "tomasini"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tomasini"."Invitation" ADD CONSTRAINT "Invitation_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "tomasini"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
