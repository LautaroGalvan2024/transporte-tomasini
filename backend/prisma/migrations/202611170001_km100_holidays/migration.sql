ALTER TABLE "tomasini"."Trip" ADD COLUMN "km100" INTEGER CHECK ("km100" >= 0);
ALTER TABLE "tomasini"."Trip" ADD COLUMN "km100Context" TEXT;
ALTER TABLE "tomasini"."Setting" ADD COLUMN "holidayCalendar" TEXT;
