-- Student Portal Migration
-- Run once against the AttendanceAI database after 01_init_schema.sql

-- 1. Add new columns to dbo.Students
ALTER TABLE dbo.Students
    ADD FullNameKurdish  NVARCHAR(120) NULL,
        PasswordHash     NVARCHAR(255) NULL,
        FaceDeletedBySelf BIT NOT NULL CONSTRAINT DF_Students_FaceDeletedBySelf DEFAULT (0),
        FaceDeletedAt    DATETIME2(0)  NULL;

-- 2. Create invite-token table
CREATE TABLE dbo.StudentInviteTokens
(
    TokenID   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_StudentInviteTokens PRIMARY KEY DEFAULT NEWID(),
    StudentID INT              NOT NULL,
    Token     NVARCHAR(128)    NOT NULL CONSTRAINT UQ_StudentInviteTokens_Token UNIQUE,
    ExpiresAt DATETIME2(0)     NOT NULL,
    UsedAt    DATETIME2(0)     NULL,
    CreatedAt DATETIME2(0)     NOT NULL CONSTRAINT DF_StudentInviteTokens_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_StudentInviteTokens_Students
        FOREIGN KEY (StudentID) REFERENCES dbo.Students(StudentID)
);
