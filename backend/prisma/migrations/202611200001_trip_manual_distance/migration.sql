ALTER TABLE "tomasini"."Trip"
    ADD COLUMN "manualDistanceKm" INTEGER,
    ALTER COLUMN "startKm" DROP NOT NULL,
    ALTER COLUMN "endKm" DROP NOT NULL,
    ADD CONSTRAINT "Trip_distance_method" CHECK (
        ("manualDistanceKm" IS NULL AND "startKm" IS NOT NULL AND "endKm" IS NOT NULL)
        OR ("manualDistanceKm" IS NOT NULL AND "manualDistanceKm" BETWEEN 0 AND 9999999
            AND "startKm" IS NULL AND "endKm" IS NULL)
    );
