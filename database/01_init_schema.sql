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
IF OBJECT_ID(N'dbo.Professors', N'U') IS NOT NULL DROP TABLE dbo.Professors;
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
    IsActive          BIT NOT NULL CONSTRAINT DF_Students_IsActive DEFAULT (1),
    EnrollmentStatus  NVARCHAR(20) NOT NULL CONSTRAINT DF_Students_EnrollmentStatus DEFAULT (N'pending'),
    CreatedAt         DATETIME2(0) NOT NULL CONSTRAINT DF_Students_CreatedAt DEFAULT (SYSUTCDATETIME())
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

/* ---------- Professors (predefined accounts) ---------- */
CREATE TABLE dbo.Professors
(
    ProfessorID   INT IDENTITY(1,1) PRIMARY KEY,
    Username      NVARCHAR(50) NOT NULL UNIQUE,
    PasswordHash  NVARCHAR(128) NOT NULL,
    FullName      NVARCHAR(120) NOT NULL,
    CourseID      INT NOT NULL,
    IsActive      BIT NOT NULL CONSTRAINT DF_Professors_IsActive DEFAULT (1),
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_Professors_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_Professors_Course FOREIGN KEY (CourseID) REFERENCES dbo.Courses(CourseID)
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

    /* Auto penalty: -1 per absent hour, capped at 5 */
    AttendancePenalty AS CAST(CASE WHEN HoursAbsentTotal >= 5 THEN 5.0 ELSE HoursAbsentTotal END AS DECIMAL(8,2)) PERSISTED,

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
                                  - CASE WHEN HoursAbsentTotal >= 5 THEN 5.0 ELSE HoursAbsentTotal END) < 0
                              THEN 0
                              ELSE (ISNULL(Quiz1,0) + ISNULL(Quiz2,0) + ISNULL(ProjectGrade,0)
                                  + ISNULL(AssignmentGrade,0) + ISNULL(MidtermGrade,0) + ISNULL(FinalExamGrade,0)
                                  - CASE WHEN HoursAbsentTotal >= 5 THEN 5.0 ELSE HoursAbsentTotal END)
                          END AS DECIMAL(8,2)) PERSISTED,

    /* At-risk policy:
       1) failing grade (<60), OR
       2) too many absences (>=4 hours; course-specific threshold shown in view)
    */
    AtRisk            AS CAST(CASE WHEN (
                            CASE
                              WHEN (ISNULL(Quiz1,0) + ISNULL(Quiz2,0) + ISNULL(ProjectGrade,0)
                                  + ISNULL(AssignmentGrade,0) + ISNULL(MidtermGrade,0) + ISNULL(FinalExamGrade,0)
                                  - CASE WHEN HoursAbsentTotal >= 5 THEN 5.0 ELSE HoursAbsentTotal END) < 0
                              THEN 0
                              ELSE (ISNULL(Quiz1,0) + ISNULL(Quiz2,0) + ISNULL(ProjectGrade,0)
                                  + ISNULL(AssignmentGrade,0) + ISNULL(MidtermGrade,0) + ISNULL(FinalExamGrade,0)
                                  - CASE WHEN HoursAbsentTotal >= 5 THEN 5.0 ELSE HoursAbsentTotal END)
                            END
                          ) < 60 OR HoursAbsentTotal >= 4 THEN 1 ELSE 0 END AS BIT) PERSISTED,

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
    PoseLabel     NVARCHAR(30) NOT NULL CONSTRAINT DF_Embeddings_PoseLabel DEFAULT (N'front'),
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_Embeddings_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_Embeddings_Students FOREIGN KEY (StudentID) REFERENCES dbo.Students(StudentID)
);
GO

CREATE UNIQUE INDEX UX_Embeddings_Primary
ON dbo.StudentFaceEmbeddings (StudentID, ModelName, PoseLabel)
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
    SET @SessionID = NEWID();

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
    DECLARE @MinutesIntoHour INT;
    DECLARE @WithinGrace BIT;

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
    -- Minutes into the CURRENT hour — resets to 0 at each hour boundary.
    SET @MinutesIntoHour = DATEDIFF(MINUTE, @HourStart, @RecognizedAt);
    SET @WithinGrace = CASE WHEN @MinutesIntoHour <= @GraceMinutes THEN 1 ELSE 0 END;

    MERGE dbo.SessionAttendance AS target
    USING (SELECT @SessionID AS SessionID, @StudentID AS StudentID) AS src
    ON target.SessionID = src.SessionID AND target.StudentID = src.StudentID
    WHEN MATCHED THEN
        UPDATE SET
            FirstSeenAt = CASE
                            WHEN target.FirstSeenAt IS NULL AND @WithinGrace = 1 THEN @RecognizedAt
                            WHEN target.FirstSeenAt IS NULL THEN target.FirstSeenAt
                            WHEN @RecognizedAt < target.FirstSeenAt THEN @RecognizedAt
                            ELSE target.FirstSeenAt
                          END,
            LastSeenAt = CASE
                            WHEN target.LastSeenAt IS NULL THEN @RecognizedAt
                            WHEN @RecognizedAt > target.LastSeenAt THEN @RecognizedAt
                            ELSE target.LastSeenAt
                         END,
            -- Once present, stay present. Otherwise only upgrade if within this hour's grace window.
            IsPresent = CASE
                            WHEN target.IsPresent = 1 THEN 1
                            WHEN @WithinGrace = 1 THEN 1
                            ELSE 0
                        END,
            IsLate = CASE
                        WHEN target.FirstSeenAt IS NULL AND @WithinGrace = 0 THEN 1
                        ELSE target.IsLate
                     END,
            ArrivalDelayMinutes = CASE
                                    WHEN target.FirstSeenAt IS NULL AND @WithinGrace = 1 THEN @DelayMinutes
                                    ELSE target.ArrivalDelayMinutes
                                  END
    WHEN NOT MATCHED THEN
        INSERT (SessionID, StudentID, FirstSeenAt, LastSeenAt, IsPresent, IsLate, ArrivalDelayMinutes)
        VALUES (
            @SessionID,
            @StudentID,
            CASE WHEN @WithinGrace = 1 THEN @RecognizedAt ELSE NULL END,
            @RecognizedAt,
            @WithinGrace,
            CASE WHEN @WithinGrace = 0 THEN 1 ELSE 0 END,
            @DelayMinutes
        );

    -- Only log the student as present for this hour if within the grace window.
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
        UPDATE SET
            IsPresent = CASE WHEN @WithinGrace = 1 THEN 1 ELSE IsPresent END,
            Source = CASE WHEN @WithinGrace = 1 THEN N'recognizer' ELSE Source END
    WHEN NOT MATCHED THEN
        INSERT (SessionID, StudentID, HourIndex, HourStart, IsPresent, Source)
        VALUES (src.SessionID, src.StudentID, src.HourIndex, src.HourStart, @WithinGrace, N'recognizer');
END
GO

CREATE PROCEDURE dbo.sp_FinalizeSession
    @SessionID UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Status      NVARCHAR(20);
    DECLARE @CourseID    INT;
    DECLARE @StartAt     DATETIME2(0);
    DECLARE @EndAt       DATETIME2(0);
    DECLARE @DurationMinutes INT;
    DECLARE @TotalHours  INT;
    DECLARE @GraceMinutes INT;

    SELECT
        @Status   = cs.Status,
        @CourseID = cs.CourseID,
        @StartAt  = cs.StartedAt,
        @EndAt    = cs.EndedAt,
        @GraceMinutes = c.LateGraceMinutes
    FROM dbo.ClassSessions cs
    INNER JOIN dbo.Courses c ON c.CourseID = cs.CourseID
    WHERE cs.SessionID = @SessionID;

    IF @CourseID IS NULL RETURN;
    IF @Status = N'finalized' RETURN;

    SET @EndAt = ISNULL(@EndAt, SYSUTCDATETIME());

    UPDATE dbo.ClassSessions
    SET EndedAt = @EndAt, Status = N'finalized'
    WHERE SessionID = @SessionID;

    SET @DurationMinutes = DATEDIFF(MINUTE, @StartAt, @EndAt);
    IF @DurationMinutes <= 0 SET @DurationMinutes = 1;
    SET @TotalHours = CEILING(@DurationMinutes / 60.0);
    IF @TotalHours < 1 SET @TotalHours = 1;

    /* Ensure every enrolled student has a SessionAttendance row */
    INSERT INTO dbo.SessionAttendance (SessionID, StudentID, IsPresent, IsLate, ArrivalDelayMinutes)
    SELECT @SessionID, e.StudentID, 0, 0, NULL
    FROM dbo.Enrollments e
    LEFT JOIN dbo.SessionAttendance sa
        ON sa.SessionID = @SessionID AND sa.StudentID = e.StudentID
    WHERE e.CourseID = @CourseID
      AND sa.SessionID IS NULL;

    /* Fill SessionHourLog (audit trail — absent entries only for missing slots) */
    ;WITH HourSeries AS
    (
        SELECT 0 AS HourIndex
        UNION ALL
        SELECT HourIndex + 1 FROM HourSeries WHERE HourIndex + 1 < @TotalHours
    )
    INSERT INTO dbo.SessionHourLog (SessionID, StudentID, HourIndex, HourStart, IsPresent, Source)
    SELECT @SessionID, e.StudentID, h.HourIndex,
           DATEADD(HOUR, h.HourIndex, @StartAt), 0, N'system'
    FROM dbo.Enrollments e
    CROSS JOIN HourSeries h
    LEFT JOIN dbo.SessionHourLog hl
        ON hl.SessionID = @SessionID
       AND hl.StudentID = e.StudentID
       AND hl.HourIndex = h.HourIndex
    WHERE e.CourseID = @CourseID
      AND hl.SessionID IS NULL
    OPTION (MAXRECURSION 512);

    /*
        Compute per-hour absence weight using FirstSeenAt + persistence fix:
          - NULL (never arrived)               → 1.0 per hour
          - arrived before this hour started   → 0.0 (already present)
          - arrived within grace window        → 0.5 (Late)
          - arrived after grace window         → 1.0 (Absent)
    */
    ;WITH HourSeries AS
    (
        SELECT 0 AS HourIndex
        UNION ALL
        SELECT HourIndex + 1 FROM HourSeries WHERE HourIndex + 1 < @TotalHours
    ),
    StudentHourWeights AS
    (
        SELECT
            e.StudentID,
            CAST(
                CASE
                    WHEN sa.FirstSeenAt IS NULL
                        THEN 1.0
                    WHEN sa.FirstSeenAt <= DATEADD(HOUR, h.HourIndex, @StartAt)
                        THEN 0.0
                    WHEN sa.FirstSeenAt <= DATEADD(MINUTE, @GraceMinutes,
                                              DATEADD(HOUR, h.HourIndex, @StartAt))
                        THEN 0.5
                    ELSE 1.0
                END
            AS DECIMAL(3,1)) AS AbsenceWeight
        FROM dbo.Enrollments e
        CROSS JOIN HourSeries h
        LEFT JOIN dbo.SessionAttendance sa
            ON sa.SessionID = @SessionID AND sa.StudentID = e.StudentID
        WHERE e.CourseID = @CourseID
    ),
    StudentTotals AS
    (
        SELECT StudentID, SUM(AbsenceWeight) AS TotalAbsentWeight
        FROM StudentHourWeights
        GROUP BY StudentID
    )
    UPDATE e
    SET e.HoursAbsentTotal = e.HoursAbsentTotal + ISNULL(st.TotalAbsentWeight, 0),
        e.UpdatedAt = SYSUTCDATETIME()
    FROM dbo.Enrollments e
    INNER JOIN StudentTotals st ON st.StudentID = e.StudentID
    WHERE e.CourseID = @CourseID
    OPTION (MAXRECURSION 512);
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

-- 5 courses (matches demo mode)
INSERT INTO dbo.Courses (CourseCode, CourseName, ScheduledStartTime, LateGraceMinutes, MaxAllowedAbsentHours)
VALUES
    (N'CS201', N'Database Systems',                    '09:00:00', 10, 4),
    (N'CS202', N'Data Structure and Algorithms',       '10:30:00', 10, 4),
    (N'CS203', N'Computer Networks',                   '13:00:00', 10, 4),
    (N'CS204', N'Engineering Analysis',                '14:30:00', 10, 4),
    (N'CS205', N'Software Requirement and Analysis',   '16:00:00', 10, 4);
GO

-- 6 professors with bcrypt-hashed passwords (rounds=12)
-- mr.halgurd  / sXtLC8K7KkK2VzLz7D
-- dr.saman    / CepEdyR181lZSZHhUP
-- mr.jafar    / zVmgdH7Lv0gQrzgESW
-- mr.awder    / pZZOIjldVUjZ8l1vV0
-- mrs.sakar   / DftGKz3DUpLkF5rxdY
-- dr.ahmed    / admin123
INSERT INTO dbo.Professors (Username, PasswordHash, FullName, CourseID)
VALUES
    (N'mr.halgurd', N'$2b$12$VN0GOOFbjaJada92iE2u0ON47F32g0suXu1/8gyP3k.mkHXduoclW', N'Mr. Halgurd Rasul',   1),
    (N'dr.saman',   N'$2b$12$QCiafOKwPz3C5lrnb.9sMeWaOKb.FdRIVDNYZ7/X/ZZrTozVeyrSi', N'Dr. Saman Mohammad',  2),
    (N'mr.jafar',   N'$2b$12$45a6axITY0s6A0IbhZq81.A7qg4hTtyORbIGPmTmK9Zd7iZ8crpbm', N'Mr. Jafar Majidpoor', 3),
    (N'mr.awder',   N'$2b$12$eyEfStgoVIBQE1Jp5hAF.uZkitWoHuLD9XVwVFFB7K0OKgD5CX9FG', N'Mr. Awder Sardar',    4),
    (N'mrs.sakar',  N'$2b$12$0WHIo2Ja3PS9vwUqM7ZqZ..hqJYqk52ZrIhJufdbIB3dGiGrz5.Nm', N'Mrs. Sakar Omar',     5),
    (N'dr.ahmed',   N'$2b$12$5Mg4pQNLRAxfmx6EyvFEYubmdz.ZGTX581yE2pmmT7.t.0nccX.We', N'Dr. Ahmed Hassan',    1);
GO

-- 5 students
INSERT INTO dbo.Students (StudentCode, FullName, Email)
VALUES
    (N'S001', N'Redeen Sirwan',  N'redeen.611224020@uor.edu.krd'),
    (N'S002', N'Rebin Hussain',  N'rebin.611224019@uor.edu.krd'),
    (N'S003', N'Drwd Samal',     N'drwd.611224013@uor.edu.krd'),
    (N'S004', N'Arsh Khasraw',   N'arsh.611224002@uor.edu.krd'),
    (N'S005', N'Abdulla Sleman', N'abdulla.611224030@uor.edu.krd');
GO

-- Enroll all 5 students in all 5 courses with seeded grades (random.Random(20260325))
INSERT INTO dbo.Enrollments (StudentID, CourseID, Quiz1, Quiz2, ProjectGrade, AssignmentGrade, MidtermGrade, FinalExamGrade, HoursAbsentTotal)
VALUES
    -- Redeen Sirwan (StudentID 1)
    (1, 1,  6.29,  4.62,  8.66,  6.85, 14.56, 38.58, 0.0),
    (1, 2,  4.35,  6.94, 13.68,  5.73, 21.45, 46.04, 1.4),
    (1, 3,  9.25,  7.28, 13.09,  9.22, 18.12, 45.68, 0.8),
    (1, 4,  7.34,  7.79, 13.45,  6.25, 21.20, 31.80, 0.5),
    (1, 5,  5.61,  5.14, 10.36,  4.86, 18.93, 37.97, 1.2),
    -- Rebin Hussain (StudentID 2)
    (2, 1,  4.29,  6.72, 12.00,  6.83, 17.28, 34.53, 2.0),
    (2, 2,  6.61,  7.49, 13.72,  8.70, 12.92, 44.58, 1.4),
    (2, 3,  6.00,  8.01, 13.89,  9.02, 15.20, 46.14, 0.6),
    (2, 4,  9.02,  6.48, 12.68,  5.19, 13.36, 43.61, 1.2),
    (2, 5,  5.41,  7.26, 13.24,  7.52, 17.32, 32.80, 0.9),
    -- Drwd Samal (StudentID 3)
    (3, 1,  4.48,  5.81, 13.98,  7.93, 18.46, 40.00, 1.9),
    (3, 2,  5.84,  5.58,  9.97,  4.46, 22.90, 32.48, 0.6),
    (3, 3,  4.22,  8.61, 14.13,  6.50, 19.68, 41.06, 0.5),
    (3, 4,  5.91,  9.33,  9.06,  5.16, 14.26, 39.77, 0.9),
    (3, 5,  8.21,  7.13, 11.37,  6.88, 13.78, 34.84, 0.6),
    -- Arsh Khasraw (StudentID 4)
    (4, 1,  5.57,  4.89, 14.35,  5.00, 22.36, 39.69, 0.1),
    (4, 2,  7.85,  7.28,  8.17,  6.33, 22.25, 31.10, 1.5),
    (4, 3,  8.87,  7.24, 14.00,  9.38, 17.44, 31.62, 0.9),
    (4, 4,  5.90,  9.43, 12.66,  4.59, 17.95, 28.96, 0.8),
    (4, 5,  8.17,  6.00, 13.13,  9.35, 23.79, 30.76, 1.4),
    -- Abdulla Sleman (StudentID 5)
    (5, 1,  6.44,  6.49, 12.00,  6.47, 16.32, 41.84, 1.8),
    (5, 2,  7.13,  5.95,  9.95,  9.27, 21.35, 34.55, 1.3),
    (5, 3,  7.27,  6.07,  9.72,  5.54, 18.69, 31.02, 0.6),
    (5, 4,  8.31,  6.13, 11.72,  9.45, 21.68, 42.71, 1.2),
    (5, 5,  4.77,  6.79, 10.71,  7.77, 18.32, 39.92, 0.6);
GO
