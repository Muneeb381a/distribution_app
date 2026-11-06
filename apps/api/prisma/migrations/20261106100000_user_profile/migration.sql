-- A name to show and a small profile picture (stored as a data URL) for each user.
ALTER TABLE "AppUser" ADD COLUMN "displayName" TEXT,
ADD COLUMN "avatar" TEXT;
