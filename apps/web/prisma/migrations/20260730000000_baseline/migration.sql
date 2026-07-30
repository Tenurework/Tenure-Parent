-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "InstitutionRole" AS ENUM ('OSE_DIRECTOR', 'OSE_STAFF', 'OSE_ADVISOR');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'PENDING');

-- CreateEnum
CREATE TYPE "OrgCategory" AS ENUM ('COMMUNITY', 'PROFESSIONAL', 'ORGANIZATION', 'SOCIAL');

-- CreateEnum
CREATE TYPE "DeliverableKind" AS ENUM ('DEADLINE', 'WINDOW', 'TRAINING', 'MEETING');

-- CreateEnum
CREATE TYPE "DirectoryKind" AS ENUM ('STUDENT', 'ADVISOR');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('PRESIDENT', 'FUNCTIONAL', 'MEMBER');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('SHADOW', 'ACTIVE', 'ALUMNI');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('EVENT', 'BUDGET', 'VENDOR', 'COMMUNICATION', 'DOCUMENT', 'EXCEPTION', 'ROSTER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'PENDING_PRESIDENT', 'NEEDS_CHANGES', 'PENDING_OSE', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventAudience" AS ENUM ('BOARD_ONLY', 'CLUB_MEMBERS', 'SCHOOL_WIDE', 'INVITE_ONLY', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ConflictSeverity" AS ENUM ('HARD', 'SOFT', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('DIRECT_MESSAGE', 'BOARD_CHANNEL', 'APPROVAL_THREAD', 'PRESIDENT_NETWORK', 'OSE_BROADCAST', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MemoryRecordType" AS ENUM ('CONTACT', 'PLAYBOOK', 'BUDGET', 'VENDOR', 'LESSON', 'THREAD', 'CREDENTIAL', 'DEADLINE');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('FALL', 'SPRING', 'FULL_YEAR');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('ALLOCATION', 'SPEND', 'REIMBURSEMENT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('SPEND', 'REIMBURSEMENT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'EMAIL_DIGEST');

-- CreateEnum
CREATE TYPE "CollabStatus" AS ENUM ('PENDING_OSE', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "RoleTransferStatus" AS ENUM ('PENDING', 'COMPLETED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('FORM', 'GUIDE', 'POLICY', 'TOOL', 'CHECKLIST');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "logoUrl" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "role" "InstitutionRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "imageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "acronym" TEXT,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "rosterNote" TEXT,
    "logoUrl" TEXT,
    "imageKey" TEXT,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "category" "OrgCategory" NOT NULL DEFAULT 'PROFESSIONAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "RoleScope" NOT NULL DEFAULT 'FUNCTIONAL',
    "positionCode" TEXT,
    "positionNote" TEXT,
    "vacancyNote" TEXT,
    "seatOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "term" TEXT,
    "seat" TEXT NOT NULL DEFAULT 'ALL',
    "kind" "DeliverableKind" NOT NULL DEFAULT 'DEADLINE',
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverableReminder" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliverableReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryPerson" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "kind" "DirectoryKind" NOT NULL DEFAULT 'STUDENT',
    "affiliation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectoryPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatHolding" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatHolding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationAdvisor" (
    "organizationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationAdvisor_pkey" PRIMARY KEY ("organizationId","personId")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "fromStatus" "ApprovalStatus" NOT NULL,
    "toStatus" "ApprovalStatus" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRoleContext" TEXT,
    "reason" TEXT,
    "policySnapshot" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerRoleId" TEXT,
    "approvalId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "venue" TEXT,
    "capacity" INTEGER,
    "audience" "EventAudience" NOT NULL DEFAULT 'CLUB_MEMBERS',
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "recurrenceRule" TEXT,
    "conflictSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictRecord" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "conflictWithEventId" TEXT,
    "severity" "ConflictSeverity" NOT NULL,
    "reason" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "organizationId" TEXT,
    "type" "ConversationType" NOT NULL,
    "approvalId" TEXT,
    "subject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleContext" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'to',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadMessageId" TEXT,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'markdown',
    "replyToId" TEXT,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "sensitivity" TEXT NOT NULL DEFAULT 'standard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sensitivity" TEXT NOT NULL DEFAULT 'standard',
    "createdById" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryRecord" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT,
    "title" TEXT NOT NULL,
    "type" "MemoryRecordType" NOT NULL,
    "content" JSONB NOT NULL,
    "authorId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "sensitivity" TEXT NOT NULL DEFAULT 'standard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" "BudgetPeriod" NOT NULL,
    "academicYear" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "allocatedCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "approvalId" TEXT,
    "recordedById" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "budgetedCents" INTEGER NOT NULL DEFAULT 0,
    "actualCents" INTEGER NOT NULL DEFAULT 0,
    "forecastCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "budgetLineId" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL DEFAULT 'SPEND',
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "memo" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvalId" TEXT,
    "vendorId" TEXT,
    "documentId" TEXT,
    "postedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPost" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "eventId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollabInterest" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "note" TEXT,
    "status" "CollabStatus" NOT NULL DEFAULT 'PENDING_OSE',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollabInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "organizationId" TEXT,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "traceId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleTransfer" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "role" "InstitutionRole" NOT NULL,
    "status" "RoleTransferStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "stepDownRole" "InstitutionRole",
    "initiatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RoleTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDelegation" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "external" BOOLEAN NOT NULL DEFAULT false,
    "ready" BOOLEAN NOT NULL DEFAULT true,
    "kind" "ResourceKind" NOT NULL,
    "seats" TEXT[],
    "rule" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_slug_key" ON "Institution"("slug");

-- CreateIndex
CREATE INDEX "InstitutionMembership_institutionId_role_idx" ON "InstitutionMembership"("institutionId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "InstitutionMembership_userId_institutionId_key" ON "InstitutionMembership"("userId", "institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_institutionId_status_idx" ON "Organization"("institutionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Role_positionCode_key" ON "Role"("positionCode");

-- CreateIndex
CREATE INDEX "Role_organizationId_scope_idx" ON "Role"("organizationId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_name_key" ON "Role"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Deliverable_key_key" ON "Deliverable"("key");

-- CreateIndex
CREATE INDEX "Deliverable_institutionId_dueAt_idx" ON "Deliverable"("institutionId", "dueAt");

-- CreateIndex
CREATE INDEX "Deliverable_seat_dueAt_idx" ON "Deliverable"("seat", "dueAt");

-- CreateIndex
CREATE INDEX "DeliverableReminder_userId_idx" ON "DeliverableReminder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverableReminder_deliverableId_userId_key" ON "DeliverableReminder"("deliverableId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryPerson_email_key" ON "DirectoryPerson"("email");

-- CreateIndex
CREATE INDEX "DirectoryPerson_kind_idx" ON "DirectoryPerson"("kind");

-- CreateIndex
CREATE INDEX "SeatHolding_roleId_isCurrent_idx" ON "SeatHolding"("roleId", "isCurrent");

-- CreateIndex
CREATE INDEX "SeatHolding_personId_idx" ON "SeatHolding"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "SeatHolding_roleId_personId_term_key" ON "SeatHolding"("roleId", "personId", "term");

-- CreateIndex
CREATE INDEX "OrganizationAdvisor_personId_idx" ON "OrganizationAdvisor"("personId");

-- CreateIndex
CREATE INDEX "RoleAssignment_userId_roleId_idx" ON "RoleAssignment"("userId", "roleId");

-- CreateIndex
CREATE INDEX "RoleAssignment_roleId_status_idx" ON "RoleAssignment"("roleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_idempotencyKey_key" ON "ApprovalRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ApprovalRequest_organizationId_status_idx" ON "ApprovalRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_institutionId_status_idx" ON "ApprovalRequest"("institutionId", "status");

-- CreateIndex
CREATE INDEX "ApprovalStep_approvalId_idx" ON "ApprovalStep"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_approvalId_key" ON "Event"("approvalId");

-- CreateIndex
CREATE INDEX "Event_institutionId_startAt_idx" ON "Event"("institutionId", "startAt");

-- CreateIndex
CREATE INDEX "Event_organizationId_status_idx" ON "Event"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ConflictRecord_eventId_idx" ON "ConflictRecord"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_approvalId_key" ON "Conversation"("approvalId");

-- CreateIndex
CREATE INDEX "Conversation_institutionId_idx" ON "Conversation"("institutionId");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_type_idx" ON "Conversation"("organizationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_conversationId_userId_key" ON "Participant"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_messageId_participantId_channel_key" ON "Delivery"("messageId", "participantId", "channel");

-- CreateIndex
CREATE INDEX "Document_organizationId_isArchived_idx" ON "Document"("organizationId", "isArchived");

-- CreateIndex
CREATE INDEX "MemoryRecord_organizationId_type_isArchived_idx" ON "MemoryRecord"("organizationId", "type", "isArchived");

-- CreateIndex
CREATE INDEX "MemoryRecord_roleId_idx" ON "MemoryRecord"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_organizationId_period_academicYear_key" ON "Budget"("organizationId", "period", "academicYear");

-- CreateIndex
CREATE INDEX "Transaction_budgetId_occurredAt_idx" ON "Transaction"("budgetId", "occurredAt");

-- CreateIndex
CREATE INDEX "BudgetLine_organizationId_academicYear_idx" ON "BudgetLine"("organizationId", "academicYear");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_organizationId_academicYear_category_key" ON "BudgetLine"("organizationId", "academicYear", "category");

-- CreateIndex
CREATE INDEX "Vendor_organizationId_isArchived_idx" ON "Vendor"("organizationId", "isArchived");

-- CreateIndex
CREATE INDEX "LedgerEntry_budgetLineId_occurredAt_idx" ON "LedgerEntry"("budgetLineId", "occurredAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_organizationId_academicYear_idx" ON "LedgerEntry"("organizationId", "academicYear");

-- CreateIndex
CREATE INDEX "FeedPost_institutionId_createdAt_idx" ON "FeedPost"("institutionId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedComment_postId_createdAt_idx" ON "FeedComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "CollabInterest_status_idx" ON "CollabInterest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CollabInterest_postId_organizationId_key" ON "CollabInterest"("postId", "organizationId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_channel_key" ON "NotificationPreference"("userId", "channel");

-- CreateIndex
CREATE INDEX "AuditEvent_institutionId_occurredAt_idx" ON "AuditEvent"("institutionId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_occurredAt_idx" ON "AuditEvent"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_resourceType_resourceId_idx" ON "AuditEvent"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "RoleTransfer_institutionId_status_idx" ON "RoleTransfer"("institutionId", "status");

-- CreateIndex
CREATE INDEX "RoleTransfer_toUserId_status_idx" ON "RoleTransfer"("toUserId", "status");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_toUserId_revokedAt_idx" ON "ApprovalDelegation"("toUserId", "revokedAt");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_fromUserId_revokedAt_idx" ON "ApprovalDelegation"("fromUserId", "revokedAt");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_institutionId_idx" ON "ApprovalDelegation"("institutionId");

-- CreateIndex
CREATE INDEX "Resource_institutionId_archivedAt_idx" ON "Resource"("institutionId", "archivedAt");

-- CreateIndex
CREATE INDEX "Resource_institutionId_kind_idx" ON "Resource"("institutionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_institutionId_key_key" ON "Resource"("institutionId", "key");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionMembership" ADD CONSTRAINT "InstitutionMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionMembership" ADD CONSTRAINT "InstitutionMembership_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableReminder" ADD CONSTRAINT "DeliverableReminder_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableReminder" ADD CONSTRAINT "DeliverableReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHolding" ADD CONSTRAINT "SeatHolding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHolding" ADD CONSTRAINT "SeatHolding_personId_fkey" FOREIGN KEY ("personId") REFERENCES "DirectoryPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationAdvisor" ADD CONSTRAINT "OrganizationAdvisor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationAdvisor" ADD CONSTRAINT "OrganizationAdvisor_personId_fkey" FOREIGN KEY ("personId") REFERENCES "DirectoryPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictRecord" ADD CONSTRAINT "ConflictRecord_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryRecord" ADD CONSTRAINT "MemoryRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryRecord" ADD CONSTRAINT "MemoryRecord_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabInterest" ADD CONSTRAINT "CollabInterest_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabInterest" ADD CONSTRAINT "CollabInterest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleTransfer" ADD CONSTRAINT "RoleTransfer_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleTransfer" ADD CONSTRAINT "RoleTransfer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleTransfer" ADD CONSTRAINT "RoleTransfer_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleTransfer" ADD CONSTRAINT "RoleTransfer_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

