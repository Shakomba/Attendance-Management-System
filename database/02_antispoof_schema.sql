/*
    Anti-Spoofing & Multi-Pose Enrollment Schema Migration
    Run AFTER 01_init_schema.sql
*/

USE AttendanceAI;
GO

/* ---------- Add PoseLabel to face embeddings ---------- */
IF COL_LENGTH(N'dbo.StudentFaceEmbeddings', N'PoseLabel') IS NULL
BEGIN
    ALTER TABLE dbo.StudentFaceEmbeddings
        ADD PoseLabel NVARCHAR(20) NULL;
END
GO

/* Back-fill existing rows as 'front' */
UPDATE dbo.StudentFaceEmbeddings
SET PoseLabel = N'front'
WHERE PoseLabel IS NULL;
GO

/* ---------- Replace unique index to scope by pose ---------- */
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Embeddings_Primary'
           AND object_id = OBJECT_ID(N'dbo.StudentFaceEmbeddings'))
BEGIN
    DROP INDEX UX_Embeddings_Primary ON dbo.StudentFaceEmbeddings;
END
GO

CREATE UNIQUE INDEX UX_Embeddings_PosePrimary
ON dbo.StudentFaceEmbeddings (StudentID, ModelName, PoseLabel)
WHERE IsPrimary = 1;
GO

/* ---------- Add EnrollmentStatus to Students ---------- */
IF COL_LENGTH(N'dbo.Students', N'EnrollmentStatus') IS NULL
BEGIN
    ALTER TABLE dbo.Students
        ADD EnrollmentStatus NVARCHAR(20) NOT NULL
            CONSTRAINT DF_Students_EnrollmentStatus DEFAULT (N'pending');
END
GO
