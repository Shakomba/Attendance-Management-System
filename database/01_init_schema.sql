/*
    Attendance & Grade Management System - SQL Server Bootstrap
    Phase 1 deliverable
*/

IF DB_ID(N'AttendanceAI') IS NULL
BEGIN
    CREATE DATABASE AttendanceAI;
END
GO

USE AttendanceAI;
GO

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

/* ---------- Re-runnable drops (optional for clean setup) ---------- */
IF OBJECT_ID(N'dbo.vw_Gradebook', N'V') IS NOT NULL DROP VIEW dbo.vw_Gradebook;
GO
IF OBJECT_ID(N'dbo.sp_FinalizeSession', N'P') IS NOT NULL DROP PROCEDURE dbo.sp_FinalizeSession;
GO
IF OBJECT_ID(N'dbo.sp_UpsertAttendanceOnRecognition', N'P') IS NOT NULL DROP PROCEDURE dbo.sp_UpsertAttendanceOnRecognition;
GO
IF OBJECT_ID(N'dbo.sp_StartSession', N'P') IS NOT NULL DROP PROCEDURE dbo.sp_StartSession;
GO

IF OBJECT_ID(N'dbo.EmailDispatchLog', N'U') IS NOT NULL DROP TABLE dbo.EmailDispatchLog;
IF OBJECT_ID(N'dbo.SessionHourLog', N'U') IS NOT NULL DROP TABLE dbo.SessionHourLog;
IF OBJECT_ID(N'dbo.SessionAttendance', N'U') IS NOT NULL DROP TABLE dbo.SessionAttendance;
IF OBJECT_ID(N'dbo.SessionRecognitions', N'U') IS NOT NULL DROP TABLE dbo.SessionRecognitions;
IF OBJECT_ID(N'dbo.ClassSessions', N'U') IS NOT NULL DROP TABLE dbo.ClassSessions;
IF OBJECT_ID(N'dbo.StudentFaceEmbeddings', N'U') IS NOT NULL DROP TABLE dbo.StudentFaceEmbeddings;
IF OBJECT_ID(N'dbo.Enrollments', N'U') IS NOT NULL DROP TABLE dbo.Enrollments;
IF OBJECT_ID(N'dbo.Courses', N'U') IS NOT NULL DROP TABLE dbo.Courses;
IF OBJECT_ID(N'dbo.Students', N'U') IS NOT NULL DROP TABLE dbo.Students;
GO

/* ---------- Core master data ---------- */
CREATE TABLE dbo.Students
(
    StudentID       INT IDENTITY(1,1) PRIMARY KEY,
    StudentCode     NVARCHAR(30) NOT NULL UNIQUE,
    FullName        NVARCHAR(120) NOT NULL,
    Email           NVARCHAR(255) NOT NULL UNIQUE,
    ProfilePhotoUrl NVARCHAR(500) NULL,
    IsActive        BIT NOT NULL CONSTRAINT DF_Students_IsActive DEFAULT (1),
    CreatedAt       DATETIME2(0) NOT NULL CONSTRAINT DF_Students_CreatedAt DEFAULT (SYSUTCDATETIME())
);
GO

CREATE TABLE dbo.Courses
(
    CourseID              INT IDENTITY(1,1) PRIMARY KEY,
    CourseCode            NVARCHAR(30) NOT NULL UNIQUE,
    CourseName            NVARCHAR(120) NOT NULL,
    ScheduledStartTime    TIME(0) NOT NULL CONSTRAINT DF_Courses_ScheduledStart DEFAULT ('08:00:00'),
    LateGraceMinutes      INT NOT NULL CONSTRAINT DF_Courses_LateGrace DEFAULT (10),
    MaxAllowedAbsentHours INT NOT NULL CONSTRAINT DF_Courses_MaxAbsent DEFAULT (8),
    IsActive              BIT NOT NULL CONSTRAINT DF_Courses_IsActive DEFAULT (1),
    CreatedAt             DATETIME2(0) NOT NULL CONSTRAINT DF_Courses_CreatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* ---------- Gradebook + automated formulas ---------- */
CREATE TABLE dbo.Enrollments
(
    EnrollmentID      INT IDENTITY(1,1) PRIMARY KEY,
    StudentID         INT NOT NULL,
    CourseID          INT NOT NULL,

    Quiz1             DECIMAL(5,2) NOT NULL CONSTRAINT DF_Enrollments_Quiz1 DEFAULT (0),
    Quiz2             DECIMAL(5,2) NOT NULL CONSTRAINT DF_Enrollments_Quiz2 DEFAULT (0),
    ProjectGrade      DECIMAL(5,2) NOT NULL CONSTRAINT DF_Enrollments_Project DEFAULT (0),
    AssignmentGrade   DECIMAL(5,2) NOT NULL CONSTRAINT DF_Enrollments_Assignment DEFAULT (0),
    MidtermGrade      DECIMAL(5,2) NOT NULL CONSTRAINT DF_Enrollments_Midterm DEFAULT (0),
    FinalExamGrade    DECIMAL(5,2) NOT NULL CONSTRAINT DF_Enrollments_FinalExam DEFAULT (0),

    HoursAbsentTotal  DECIMAL(8,2) NOT NULL CONSTRAINT DF_Enrollments_HoursAbsent DEFAULT (0),

    /* Auto penalty: -0.25 for each absent hour */
    AttendancePenalty AS CAST(HoursAbsentTotal * 0.25 AS DECIMAL(8,2)) PERSISTED,

    /* Raw sum of all grade components */
    RawTotal          AS CAST(
                          ISNULL(Quiz1,0) + ISNULL(Quiz2,0) + ISNULL(ProjectGrade,0)
                        + ISNULL(AssignmentGrade,0) + ISNULL(MidtermGrade,0) + ISNULL(FinalExamGrade,0)
                        AS DECIMAL(8,2)) PERSISTED,

    /* Final after attendance penalty, not below 0 */
    AdjustedTotal     AS CAST(
                          CASE
                              WHEN (ISNULL(Quiz1,0) + ISNULL(Quiz2,0) + ISNULL(ProjectGrade,0)
                                  + ISNULL(AssignmentGrade,0) + ISNULL(MidtermGrade,0) + ISNULL(FinalExamGrade,0)
                                  - (HoursAbsentTotal * 0.25)) < 0
                              THEN 0
                              ELSE (ISNULL(Quiz1,0) + ISNULL(Quiz2,0) + ISNULL(ProjectGrade,0)
                                  + ISNULL(AssignmentGrade,0) + ISNULL(MidtermGrade,0) + ISNULL(FinalExamGrade,0)
                                  - (HoursAbsentTotal * 0.25))
                          END AS DECIMAL(8,2)) PERSISTED,

    /* At-risk policy:
       1) failing grade (<60), OR
       2) too many absences (>=8 hours; course-specific threshold shown in view)
    */
    AtRisk            AS CAST(CASE WHEN (
                            CASE
                              WHEN (ISNULL(Quiz1,0) + ISNULL(Quiz2,0) + ISNULL(ProjectGrade,0)
                                  + ISNULL(AssignmentGrade,0) + ISNULL(MidtermGrade,0) + ISNULL(FinalExamGrade,0)
                                  - (HoursAbsentTotal * 0.25)) < 0
                              THEN 0
                              ELSE (ISNULL(Quiz1,0) + ISNULL(Quiz2,0) + ISNULL(ProjectGrade,0)
                                  + ISNULL(AssignmentGrade,0) + ISNULL(MidtermGrade,0) + ISNULL(FinalExamGrade,0)
                                  - (HoursAbsentTotal * 0.25))
                            END
                          ) < 60 OR HoursAbsentTotal >= 8 THEN 1 ELSE 0 END AS BIT) PERSISTED,

    UpdatedAt         DATETIME2(0) NOT NULL CONSTRAINT DF_Enrollments_UpdatedAt DEFAULT (SYSUTCDATETIME()),

    CONSTRAINT UQ_Enrollments UNIQUE (StudentID, CourseID),
    CONSTRAINT FK_Enrollments_Students FOREIGN KEY (StudentID) REFERENCES dbo.Students(StudentID),
    CONSTRAINT FK_Enrollments_Courses  FOREIGN KEY (CourseID)  REFERENCES dbo.Courses(CourseID)
);
GO

/* ---------- Biometric profiles ---------- */
CREATE TABLE dbo.StudentFaceEmbeddings
(
    EmbeddingID   BIGINT IDENTITY(1,1) PRIMARY KEY,
    StudentID     INT NOT NULL,
    ModelName     NVARCHAR(40) NOT NULL,  -- hog-128 / insightface-512
    EmbeddingData VARBINARY(MAX) NOT NULL,
    IsPrimary     BIT NOT NULL CONSTRAINT DF_Embeddings_IsPrimary DEFAULT (1),
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_Embeddings_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_Embeddings_Students FOREIGN KEY (StudentID) REFERENCES dbo.Students(StudentID)
);
GO

CREATE UNIQUE INDEX UX_Embeddings_Primary
ON dbo.StudentFaceEmbeddings (StudentID, ModelName)
WHERE IsPrimary = 1;
GO

/* ---------- Sessions and attendance ---------- */
CREATE TABLE dbo.ClassSessions
(
    SessionID   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ClassSessions PRIMARY KEY DEFAULT (NEWSEQUENTIALID()),
    CourseID    INT NOT NULL,
    StartedAt   DATETIME2(0) NOT NULL CONSTRAINT DF_ClassSessions_StartedAt DEFAULT (SYSUTCDATETIME()),
    EndedAt     DATETIME2(0) NULL,
    Status      NVARCHAR(20) NOT NULL CONSTRAINT DF_ClassSessions_Status DEFAULT (N'active'),
    CreatedAt   DATETIME2(0) NOT NULL CONSTRAINT DF_ClassSessions_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_ClassSessions_Status CHECK (Status IN (N'active', N'finalized')),
    CONSTRAINT FK_ClassSessions_Course FOREIGN KEY (CourseID) REFERENCES dbo.Courses(CourseID)
);
GO

CREATE TABLE dbo.SessionRecognitions
(
    RecognitionID BIGINT IDENTITY(1,1) PRIMARY KEY,
    SessionID     UNIQUEIDENTIFIER NOT NULL,
    StudentID     INT NULL,
    RecognizedAt  DATETIME2(0) NOT NULL CONSTRAINT DF_SessionRecognitions_Time DEFAULT (SYSUTCDATETIME()),
    Confidence    DECIMAL(6,4) NULL,
    EngineMode    NVARCHAR(12) NOT NULL, -- cpu/gpu
    Notes         NVARCHAR(200) NULL,
    CONSTRAINT FK_SessionRecognitions_Session FOREIGN KEY (SessionID) REFERENCES dbo.ClassSessions(SessionID),
    CONSTRAINT FK_SessionRecognitions_Student FOREIGN KEY (StudentID) REFERENCES dbo.Students(StudentID)
);
GO

CREATE INDEX IX_SessionRecognitions_SessionTime
ON dbo.SessionRecognitions (SessionID, RecognizedAt DESC);
GO

CREATE TABLE dbo.SessionAttendance
(
    SessionID            UNIQUEIDENTIFIER NOT NULL,
    StudentID            INT NOT NULL,
    FirstSeenAt          DATETIME2(0) NULL,
    LastSeenAt           DATETIME2(0) NULL,
    IsPresent            BIT NOT NULL CONSTRAINT DF_SessionAttendance_IsPresent DEFAULT (0),
    IsLate               BIT NOT NULL CONSTRAINT DF_SessionAttendance_IsLate DEFAULT (0),
    ArrivalDelayMinutes  INT NULL,
    PRIMARY KEY (SessionID, StudentID),
    CONSTRAINT FK_SessionAttendance_Session FOREIGN KEY (SessionID) REFERENCES dbo.ClassSessions(SessionID),
    CONSTRAINT FK_SessionAttendance_Student FOREIGN KEY (StudentID) REFERENCES dbo.Students(StudentID)
);
GO

CREATE TABLE dbo.SessionHourLog
(
    SessionID   UNIQUEIDENTIFIER NOT NULL,
    StudentID   INT NOT NULL,
    HourIndex   INT NOT NULL,
    HourStart   DATETIME2(0) NOT NULL,
    IsPresent   BIT NOT NULL CONSTRAINT DF_SessionHourLog_IsPresent DEFAULT (0),
    Source      NVARCHAR(20) NOT NULL CONSTRAINT DF_SessionHourLog_Source DEFAULT (N'system'),
    PRIMARY KEY (SessionID, StudentID, HourIndex),
    CONSTRAINT FK_SessionHourLog_Session FOREIGN KEY (SessionID) REFERENCES dbo.ClassSessions(SessionID),
    CONSTRAINT FK_SessionHourLog_Student FOREIGN KEY (StudentID) REFERENCES dbo.Students(StudentID)
);
GO

CREATE TABLE dbo.EmailDispatchLog
(
    EmailLogID      BIGINT IDENTITY(1,1) PRIMARY KEY,
    SessionID       UNIQUEIDENTIFIER NOT NULL,
    StudentID       INT NOT NULL,
    RecipientEmail  NVARCHAR(255) NOT NULL,
    SubjectLine     NVARCHAR(200) NOT NULL,
    SentAt          DATETIME2(0) NOT NULL CONSTRAINT DF_EmailDispatchLog_SentAt DEFAULT (SYSUTCDATETIME()),
    Status          NVARCHAR(20) NOT NULL,
    ErrorMessage    NVARCHAR(MAX) NULL,
    CONSTRAINT FK_EmailDispatchLog_Session FOREIGN KEY (SessionID) REFERENCES dbo.ClassSessions(SessionID),
    CONSTRAINT FK_EmailDispatchLog_Student FOREIGN KEY (StudentID) REFERENCES dbo.Students(StudentID)
);
GO

/* ---------- Procedures ---------- */
CREATE PROCEDURE dbo.sp_StartSession
    @CourseID  INT,
    @StartedAt DATETIME2(0) = NULL,
    @SessionID UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    SET @StartedAt = ISNULL(@StartedAt, SYSUTCDATETIME());
    SET @SessionID = NEWSEQUENTIALID();

    INSERT INTO dbo.ClassSessions (SessionID, CourseID, StartedAt, Status)
    VALUES (@SessionID, @CourseID, @StartedAt, N'active');
END
GO

CREATE PROCEDURE dbo.sp_UpsertAttendanceOnRecognition
    @SessionID    UNIQUEIDENTIFIER,
    @StudentID    INT,
    @RecognizedAt DATETIME2(0) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @SessionStart DATETIME2(0);
    DECLARE @GraceMinutes INT;
    DECLARE @CourseID INT;
    DECLARE @DelayMinutes INT;
    DECLARE @HourIndex INT;
    DECLARE @HourStart DATETIME2(0);

    SET @RecognizedAt = ISNULL(@RecognizedAt, SYSUTCDATETIME());

    SELECT
        @SessionStart = cs.StartedAt,
        @CourseID = cs.CourseID,
        @GraceMinutes = c.LateGraceMinutes
    FROM dbo.ClassSessions cs
    INNER JOIN dbo.Courses c ON c.CourseID = cs.CourseID
    WHERE cs.SessionID = @SessionID;

    IF @SessionStart IS NULL
        RETURN;

    SET @DelayMinutes = DATEDIFF(MINUTE, @SessionStart, @RecognizedAt);
    IF @DelayMinutes < 0 SET @DelayMinutes = 0;

    SET @HourIndex = @DelayMinutes / 60;
    SET @HourStart = DATEADD(HOUR, @HourIndex, @SessionStart);

    MERGE dbo.SessionAttendance AS target
    USING (SELECT @SessionID AS SessionID, @StudentID AS StudentID) AS src
    ON target.SessionID = src.SessionID AND target.StudentID = src.StudentID
    WHEN MATCHED THEN
        UPDATE SET
            FirstSeenAt = CASE
                            WHEN target.FirstSeenAt IS NULL THEN @RecognizedAt
                            WHEN @RecognizedAt < target.FirstSeenAt THEN @RecognizedAt
                            ELSE target.FirstSeenAt
                          END,
            LastSeenAt = CASE
                            WHEN target.LastSeenAt IS NULL THEN @RecognizedAt
                            WHEN @RecognizedAt > target.LastSeenAt THEN @RecognizedAt
                            ELSE target.LastSeenAt
                         END,
            IsPresent = 1,
            IsLate = CASE
                        WHEN target.FirstSeenAt IS NULL AND @DelayMinutes > @GraceMinutes THEN 1
                        ELSE target.IsLate
                     END,
            ArrivalDelayMinutes = CASE
                                    WHEN target.FirstSeenAt IS NULL THEN @DelayMinutes
                                    ELSE target.ArrivalDelayMinutes
                                  END
    WHEN NOT MATCHED THEN
        INSERT (SessionID, StudentID, FirstSeenAt, LastSeenAt, IsPresent, IsLate, ArrivalDelayMinutes)
        VALUES (
            @SessionID,
            @StudentID,
            @RecognizedAt,
            @RecognizedAt,
            1,
            CASE WHEN @DelayMinutes > @GraceMinutes THEN 1 ELSE 0 END,
            @DelayMinutes
        );

    MERGE dbo.SessionHourLog AS target
    USING (
        SELECT
            @SessionID AS SessionID,
            @StudentID AS StudentID,
            @HourIndex AS HourIndex,
            @HourStart AS HourStart
    ) AS src
    ON target.SessionID = src.SessionID
       AND target.StudentID = src.StudentID
       AND target.HourIndex = src.HourIndex
    WHEN MATCHED THEN
        UPDATE SET IsPresent = 1, Source = N'recognizer'
    WHEN NOT MATCHED THEN
        INSERT (SessionID, StudentID, HourIndex, HourStart, IsPresent, Source)
        VALUES (src.SessionID, src.StudentID, src.HourIndex, src.HourStart, 1, N'recognizer');
END
GO

CREATE PROCEDURE dbo.sp_FinalizeSession
    @SessionID UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Status NVARCHAR(20);
    DECLARE @CourseID INT;
    DECLARE @StartAt DATETIME2(0);
    DECLARE @EndAt DATETIME2(0);
    DECLARE @DurationMinutes INT;
    DECLARE @TotalHours INT;

    SELECT
        @Status = Status,
        @CourseID = CourseID,
        @StartAt = StartedAt,
        @EndAt = EndedAt
    FROM dbo.ClassSessions
    WHERE SessionID = @SessionID;

    IF @CourseID IS NULL
        RETURN;

    IF @Status = N'finalized'
        RETURN;

    SET @EndAt = ISNULL(@EndAt, SYSUTCDATETIME());

    UPDATE dbo.ClassSessions
    SET EndedAt = @EndAt,
        Status = N'finalized'
    WHERE SessionID = @SessionID;

    SET @DurationMinutes = DATEDIFF(MINUTE, @StartAt, @EndAt);
    IF @DurationMinutes <= 0 SET @DurationMinutes = 1;

    SET @TotalHours = CEILING(@DurationMinutes / 60.0);
    IF @TotalHours < 1 SET @TotalHours = 1;

    INSERT INTO dbo.SessionAttendance (SessionID, StudentID, IsPresent, IsLate, ArrivalDelayMinutes)
    SELECT
        @SessionID,
        e.StudentID,
        0,
        0,
        NULL
    FROM dbo.Enrollments e
    LEFT JOIN dbo.SessionAttendance sa
        ON sa.SessionID = @SessionID AND sa.StudentID = e.StudentID
    WHERE e.CourseID = @CourseID
      AND sa.SessionID IS NULL;

    ;WITH HourSeries AS
    (
        SELECT 0 AS HourIndex
        UNION ALL
        SELECT HourIndex + 1
        FROM HourSeries
        WHERE HourIndex + 1 < @TotalHours
    )
    INSERT INTO dbo.SessionHourLog (SessionID, StudentID, HourIndex, HourStart, IsPresent, Source)
    SELECT
        @SessionID,
        e.StudentID,
        h.HourIndex,
        DATEADD(HOUR, h.HourIndex, @StartAt) AS HourStart,
        0,
        N'system'
    FROM dbo.Enrollments e
    CROSS JOIN HourSeries h
    LEFT JOIN dbo.SessionHourLog hl
        ON hl.SessionID = @SessionID
       AND hl.StudentID = e.StudentID
       AND hl.HourIndex = h.HourIndex
    WHERE e.CourseID = @CourseID
      AND hl.SessionID IS NULL
    OPTION (MAXRECURSION 512);

    ;WITH SessionAbsence AS
    (
        SELECT
            hl.StudentID,
            SUM(CASE WHEN hl.IsPresent = 0 THEN 1 ELSE 0 END) AS AbsentHours
        FROM dbo.SessionHourLog hl
        WHERE hl.SessionID = @SessionID
        GROUP BY hl.StudentID
    )
    UPDATE e
    SET
        e.HoursAbsentTotal = e.HoursAbsentTotal + ISNULL(sa.AbsentHours, 0),
        e.UpdatedAt = SYSUTCDATETIME()
    FROM dbo.Enrollments e
    INNER JOIN SessionAbsence sa
        ON sa.StudentID = e.StudentID
    WHERE e.CourseID = @CourseID;
END
GO

/* ---------- Reporting view ---------- */
CREATE VIEW dbo.vw_Gradebook
AS
SELECT
    c.CourseID,
    c.CourseCode,
    c.CourseName,
    s.StudentID,
    s.StudentCode,
    s.FullName,
    s.Email,
    e.Quiz1,
    e.Quiz2,
    e.ProjectGrade,
    e.AssignmentGrade,
    e.MidtermGrade,
    e.FinalExamGrade,
    e.HoursAbsentTotal,
    e.AttendancePenalty,
    e.RawTotal,
    e.AdjustedTotal,
    e.AtRisk,
    CAST(CASE
            WHEN e.AdjustedTotal < 60 OR e.HoursAbsentTotal >= c.MaxAllowedAbsentHours THEN 1
            ELSE 0
         END AS BIT) AS AtRiskByPolicy,
    e.UpdatedAt
FROM dbo.Enrollments e
INNER JOIN dbo.Students s ON s.StudentID = e.StudentID
INNER JOIN dbo.Courses c ON c.CourseID = e.CourseID;
GO

/* ---------- Helpful indexes ---------- */
CREATE INDEX IX_Enrollments_CourseID ON dbo.Enrollments (CourseID);
CREATE INDEX IX_SessionAttendance_Session ON dbo.SessionAttendance (SessionID, IsPresent);
CREATE INDEX IX_SessionHourLog_Session ON dbo.SessionHourLog (SessionID, HourIndex);
GO

/* ---------- Starter seed data ---------- */
INSERT INTO dbo.Courses (CourseCode, CourseName, ScheduledStartTime, LateGraceMinutes, MaxAllowedAbsentHours)
VALUES
    (N'CS101', N'Distributed AI Systems', '09:00:00', 10, 8),
    (N'CS102', N'Applied Machine Vision', '13:00:00', 10, 8);
GO
