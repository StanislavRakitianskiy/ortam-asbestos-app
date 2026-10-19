-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "building" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "inspectionDate" TEXT,
    "reportDate" TEXT,
    "preparedBy" TEXT NOT NULL DEFAULT '',
    "reviewedBy" TEXT,
    "scope" TEXT NOT NULL DEFAULT '',
    "plannedWork" TEXT NOT NULL DEFAULT '',
    "limitations" TEXT NOT NULL DEFAULT '',
    "jurisdictionNote" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MaterialZone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "floor" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "quantity" REAL,
    "unit" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "plannedDisturbance" BOOLEAN NOT NULL,
    "rateRef" TEXT,
    "accessible" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "MaterialZone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ZoneSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zoneId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "ZoneSample_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "MaterialZone" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "pagesTextJson" TEXT NOT NULL,
    "labReportId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "labDocumentId" TEXT,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "responseId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "promptVersion" TEXT NOT NULL,
    "rawResponse" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiRun_labDocumentId_fkey" FOREIGN KEY ("labDocumentId") REFERENCES "LabDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabResult" (
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
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabResult_labDocumentId_fkey" FOREIGN KEY ("labDocumentId") REFERENCES "LabDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabResult_aiRunId_fkey" FOREIGN KEY ("aiRunId") REFERENCES "AiRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Correction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewIssueResolution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewIssueResolution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportNarrative" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL DEFAULT '',
    "aiText" TEXT,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportNarrative_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewChecklist" (
    "projectId" TEXT NOT NULL PRIMARY KEY,
    "samplesChecked" BOOLEAN NOT NULL DEFAULT false,
    "layersChecked" BOOLEAN NOT NULL DEFAULT false,
    "quantitiesChecked" BOOLEAN NOT NULL DEFAULT false,
    "costsChecked" BOOLEAN NOT NULL DEFAULT false,
    "narrativeChecked" BOOLEAN NOT NULL DEFAULT false,
    "reviewerName" TEXT,
    "reviewedAt" DATETIME,
    CONSTRAINT "ReviewChecklist_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "docxPath" TEXT,
    "pdfPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "MaterialZone_projectId_sortOrder_idx" ON "MaterialZone"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialZone_projectId_materialId_key" ON "MaterialZone"("projectId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneSample_zoneId_sampleId_key" ON "ZoneSample"("zoneId", "sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "LabDocument_projectId_sha256_key" ON "LabDocument"("projectId", "sha256");

-- CreateIndex
CREATE INDEX "AiRun_projectId_createdAt_idx" ON "AiRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "LabResult_labDocumentId_idx" ON "LabResult"("labDocumentId");

-- CreateIndex
CREATE INDEX "Correction_projectId_entity_entityId_idx" ON "Correction"("projectId", "entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewIssueResolution_projectId_issueKey_key" ON "ReviewIssueResolution"("projectId", "issueKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReportNarrative_projectId_section_itemKey_key" ON "ReportNarrative"("projectId", "section", "itemKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReportRevision_projectId_number_key" ON "ReportRevision"("projectId", "number");
