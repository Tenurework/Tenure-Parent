-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- AlterTable
ALTER TABLE "InstitutionMembership" ADD COLUMN     "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "effectiveUntil" TIMESTAMP(3),
ADD COLUMN     "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "statusReason" TEXT;

-- CreateIndex
CREATE INDEX "InstitutionMembership_institutionId_status_effectiveUntil_idx" ON "InstitutionMembership"("institutionId", "status", "effectiveUntil");
