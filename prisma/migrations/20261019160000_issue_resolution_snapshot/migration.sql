-- Phase 5: a decision keeps a snapshot of its issue (type, message) and of the evidence it was about (refsKey).
-- The table had no rows before phase 5 (no code wrote it), so the new columns need no default.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReviewIssueResolution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "issueMessage" TEXT NOT NULL,
    "refsKey" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewIssueResolution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReviewIssueResolution" ("createdAt", "decision", "id", "issueKey", "note", "projectId", "updatedAt") SELECT "createdAt", "decision", "id", "issueKey", "note", "projectId", "updatedAt" FROM "ReviewIssueResolution";
DROP TABLE "ReviewIssueResolution";
ALTER TABLE "new_ReviewIssueResolution" RENAME TO "ReviewIssueResolution";
CREATE UNIQUE INDEX "ReviewIssueResolution_projectId_issueKey_key" ON "ReviewIssueResolution"("projectId", "issueKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
