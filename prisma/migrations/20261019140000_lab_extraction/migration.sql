-- AlterTable
ALTER TABLE "AiRun" ADD COLUMN "stopReason" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LabDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "pagesTextJson" TEXT NOT NULL,
    "labReportId" TEXT,
    "labName" TEXT,
    "projectRef" TEXT,
    "issuedDate" TEXT,
    "documentNotesJson" TEXT NOT NULL DEFAULT '[]',
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "error" TEXT,
    "errorCode" TEXT,
    "extractionStartedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- No lab documents existed before phase 3. Should an old row exist, it keeps its data, its status EXTRACTED becomes
-- NEEDS_REVIEW, and sizeBytes 0 / updatedAt = createdAt mark it as pre-phase-3 data.
INSERT INTO "new_LabDocument" ("createdAt", "updatedAt", "sizeBytes", "error", "fileName", "id", "labReportId", "pageCount", "pagesTextJson", "projectId", "sha256", "status", "storagePath") SELECT "createdAt", "createdAt", 0, "error", "fileName", "id", "labReportId", "pageCount", "pagesTextJson", "projectId", "sha256", CASE "status" WHEN 'EXTRACTED' THEN 'NEEDS_REVIEW' ELSE "status" END, "storagePath" FROM "LabDocument";
DROP TABLE "LabDocument";
ALTER TABLE "new_LabDocument" RENAME TO "LabDocument";
CREATE UNIQUE INDEX "LabDocument_projectId_sha256_key" ON "LabDocument"("projectId", "sha256");
CREATE TABLE "new_LabResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labDocumentId" TEXT NOT NULL,
    "aiRunId" TEXT,
    "origin" TEXT NOT NULL,
    "aiJson" TEXT,
    "sampleId" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "resultLabel" TEXT NOT NULL,
    "asbestosType" TEXT,
    "percentage" REAL,
    "percentageRaw" TEXT,
    "sourcePage" INTEGER NOT NULL,
    "sourceText" TEXT NOT NULL,
    "labNote" TEXT,
    "confidence" TEXT,
    "evidenceVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationJson" TEXT NOT NULL DEFAULT '[]',
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabResult_labDocumentId_fkey" FOREIGN KEY ("labDocumentId") REFERENCES "LabDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabResult_aiRunId_fkey" FOREIGN KEY ("aiRunId") REFERENCES "AiRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LabResult" ("aiJson", "aiRunId", "asbestosType", "confidence", "createdAt", "evidenceVerified", "id", "labDocumentId", "labNote", "layer", "origin", "percentage", "percentageRaw", "rejectReason", "resultLabel", "reviewStatus", "sampleId", "sourcePage", "sourceText", "updatedAt") SELECT "aiJson", "aiRunId", "asbestosType", "confidence", "createdAt", "evidenceVerified", "id", "labDocumentId", "labNote", "layer", "origin", "percentage", "percentageRaw", "rejectReason", "resultLabel", "reviewStatus", "sampleId", "sourcePage", "sourceText", "updatedAt" FROM "LabResult";
DROP TABLE "LabResult";
ALTER TABLE "new_LabResult" RENAME TO "LabResult";
CREATE INDEX "LabResult_labDocumentId_idx" ON "LabResult"("labDocumentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

