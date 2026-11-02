-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tomasini";
SET search_path TO "tomasini";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DRIVER');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ObligationKind" AS ENUM ('SERVICE', 'DOCUMENT');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "phone" VARCHAR(40),
    "assignedTruckId" UUID,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Truck" (
    "id" UUID NOT NULL,
    "plate" VARCHAR(16) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "initialOdometer" INTEGER NOT NULL,
    "initialOdometerAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Truck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" UUID NOT NULL,
    "clientRequestId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "createdById" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "truckId" UUID NOT NULL,
    "origin" VARCHAR(180) NOT NULL,
    "destination" VARCHAR(180) NOT NULL,
    "departureAt" TIMESTAMPTZ(3) NOT NULL,
    "arrivalAt" TIMESTAMPTZ(3) NOT NULL,
    "startKm" INTEGER NOT NULL,
    "endKm" INTEGER NOT NULL,
    "allowance" DECIMAL(14,2),
    "notes" VARCHAR(2000),
    "status" "TripStatus" NOT NULL DEFAULT 'ACTIVE',
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedById" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,
    "cancellationReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "id" UUID NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "kind" "ObligationKind" NOT NULL,
    "truckId" UUID,
    "driverId" UUID,
    "dueDate" DATE,
    "dueKm" INTEGER,
    "intervalMonths" INTEGER,
    "intervalKm" INTEGER,
    "warningDays" INTEGER NOT NULL DEFAULT 30,
    "warningKm" INTEGER NOT NULL DEFAULT 1000,
    "notes" VARCHAR(2000),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Renewal" (
    "id" UUID NOT NULL,
    "obligationId" UUID NOT NULL,
    "performedAt" TIMESTAMPTZ(3) NOT NULL,
    "odometer" INTEGER,
    "nextDueDate" DATE,
    "nextDueKm" INTEGER,
    "notes" VARCHAR(2000),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Renewal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" UUID NOT NULL,
    "entity" VARCHAR(40) NOT NULL,
    "entityId" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "actorId" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "recipientEmail" VARCHAR(254),
    "warningDays" INTEGER NOT NULL DEFAULT 30,
    "warningKm" INTEGER NOT NULL DEFAULT 1000,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "recipient" VARCHAR(254) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "error" VARCHAR(500),
    "sentAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_plate_key" ON "Truck"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_clientRequestId_key" ON "Trip"("clientRequestId");

-- CreateIndex
CREATE INDEX "Trip_truckId_arrivalAt_idx" ON "Trip"("truckId", "arrivalAt");

-- CreateIndex
CREATE INDEX "Trip_driverId_departureAt_idx" ON "Trip"("driverId", "departureAt");

-- CreateIndex
CREATE INDEX "Trip_status_departureAt_idx" ON "Trip"("status", "departureAt");

-- CreateIndex
CREATE INDEX "Obligation_truckId_active_idx" ON "Obligation"("truckId", "active");

-- CreateIndex
CREATE INDEX "Obligation_driverId_active_idx" ON "Obligation"("driverId", "active");

-- CreateIndex
CREATE INDEX "Renewal_obligationId_performedAt_idx" ON "Renewal"("obligationId", "performedAt");

-- CreateIndex
CREATE INDEX "Audit_entity_entityId_createdAt_idx" ON "Audit"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_nextAttemptAt_idx" ON "Notification"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_date_recipient_key" ON "Notification"("date", "recipient");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_assignedTruckId_fkey" FOREIGN KEY ("assignedTruckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Renewal" ADD CONSTRAINT "Renewal_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business invariants remain enforced even for direct database writes.
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_odometer_nonnegative" CHECK ("initialOdometer" >= 0);
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_km_range" CHECK ("startKm" >= 0 AND "endKm" >= "startKm");
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_date_range" CHECK ("arrivalAt" >= "departureAt");
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_allowance_nonnegative" CHECK ("allowance" IS NULL OR "allowance" >= 0);
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_version_positive" CHECK ("version" > 0);
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_one_owner" CHECK (("truckId" IS NOT NULL)::integer + ("driverId" IS NOT NULL)::integer = 1);
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_km_requires_truck" CHECK (("dueKm" IS NULL AND "intervalKm" IS NULL) OR "truckId" IS NOT NULL);
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_positive_limits" CHECK (("dueKm" IS NULL OR "dueKm" >= 0) AND ("intervalKm" IS NULL OR "intervalKm" > 0) AND ("intervalMonths" IS NULL OR "intervalMonths" > 0) AND "warningDays" >= 0 AND "warningKm" >= 0);
ALTER TABLE "Renewal" ADD CONSTRAINT "Renewal_odometer_nonnegative" CHECK ("odometer" IS NULL OR "odometer" >= 0);
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_singleton" CHECK ("id" = 'main');
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_warning_nonnegative" CHECK ("warningDays" >= 0 AND "warningKm" >= 0);
INSERT INTO "Setting" ("id") VALUES ('main');

