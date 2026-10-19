-- Phase 6: narrative draft and employee review checklist.
-- AiRun.inputHash: hash of the facts a NARRATIVE run was given, to show when the draft is outdated.
-- ReviewChecklist.reviewedAt (DateTime) becomes reviewedOn, a "YYYY-MM-DD" calendar day like the project dates (D-013).
-- No code wrote ReviewChecklist before this migration, so no review date is lost.

-- AlterTable
ALTER TABLE "AiRun" ADD COLUMN "inputHash" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReviewChecklist" (
    "projectId" TEXT NOT NULL PRIMARY KEY,
    "samplesChecked" BOOLEAN NOT NULL DEFAULT false,
    "layersChecked" BOOLEAN NOT NULL DEFAULT false,
    "quantitiesChecked" BOOLEAN NOT NULL DEFAULT false,
    "costsChecked" BOOLEAN NOT NULL DEFAULT false,
    "narrativeChecked" BOOLEAN NOT NULL DEFAULT false,
    "reviewerName" TEXT,
    "reviewedOn" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewChecklist_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReviewChecklist" ("costsChecked", "layersChecked", "narrativeChecked", "projectId", "quantitiesChecked", "reviewerName", "samplesChecked") SELECT "costsChecked", "layersChecked", "narrativeChecked", "projectId", "quantitiesChecked", "reviewerName", "samplesChecked" FROM "ReviewChecklist";
DROP TABLE "ReviewChecklist";
ALTER TABLE "new_ReviewChecklist" RENAME TO "ReviewChecklist";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
