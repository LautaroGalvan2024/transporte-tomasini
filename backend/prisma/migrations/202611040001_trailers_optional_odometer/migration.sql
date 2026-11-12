-- Reviewed, additive migration. The wrapper verifies the database and migrator role.
SET search_path TO "tomasini";

ALTER TABLE "Truck" ALTER COLUMN "initialOdometer" DROP NOT NULL,
  ALTER COLUMN "initialOdometerAt" DROP NOT NULL;
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_initial_odometer_pair"
  CHECK (("initialOdometer" IS NULL) = ("initialOdometerAt" IS NULL));

CREATE TABLE "Trailer" (
  "id" UUID NOT NULL,
  "plate" VARCHAR(16) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "assignedTruckId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Trailer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Trailer_version_positive" CHECK ("version" > 0),
  CONSTRAINT "Trailer_inactive_unassigned" CHECK ("active" OR "assignedTruckId" IS NULL)
);
CREATE UNIQUE INDEX "Trailer_plate_key" ON "Trailer"("plate");
CREATE UNIQUE INDEX "Trailer_assignedTruckId_key" ON "Trailer"("assignedTruckId");
ALTER TABLE "Trailer" ADD CONSTRAINT "Trailer_assignedTruckId_fkey"
  FOREIGN KEY ("assignedTruckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Trip" ADD COLUMN "trailerId" UUID;
CREATE INDEX "Trip_trailerId_departureAt_idx" ON "Trip"("trailerId", "departureAt");
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_trailerId_fkey"
  FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Obligation" ADD COLUMN "trailerId" UUID;
CREATE INDEX "Obligation_trailerId_active_idx" ON "Obligation"("trailerId", "active");
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_trailerId_fkey"
  FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Obligation" DROP CONSTRAINT "Obligation_one_owner";
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_one_owner"
  CHECK (("truckId" IS NOT NULL)::integer + ("driverId" IS NOT NULL)::integer + ("trailerId" IS NOT NULL)::integer = 1);
-- Existing km_requires_truck keeps trailer obligations strictly calendar based.
