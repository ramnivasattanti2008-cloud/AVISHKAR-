-- When the car is usually plugged in at home (spec section 31). Blank when the owner has not said: nothing is assumed in the column.
ALTER TABLE "evs" ADD COLUMN "arrival_time" TEXT;
ALTER TABLE "evs" ADD CONSTRAINT "evs_arrival" CHECK ("arrival_time" IS NULL OR "arrival_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
