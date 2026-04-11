import os
from dataclasses import dataclass
from typing import Optional, Tuple

from dotenv import load_dotenv

load_dotenv()


def _as_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_tuple(value: str) -> Tuple[str, ...]:
    if not value:
        return tuple()
    return tuple(part.strip() for part in value.split(",") if part.strip())


@dataclass(frozen=True)
class Settings:
    app_host: str = os.getenv("APP_HOST", "0.0.0.0")
    app_port: int = int(os.getenv("APP_PORT", "8000"))
    cors_origins: Tuple[str, ...] = _as_tuple(os.getenv("CORS_ORIGINS", "*"))

    sql_driver: str = os.getenv("SQL_DRIVER", "ODBC Driver 18 for SQL Server")
    sql_server: str = os.getenv("SQL_SERVER", "localhost")
    sql_port: int = int(os.getenv("SQL_PORT", "1433"))
    sql_database: str = os.getenv("SQL_DATABASE", "AttendanceAI")
    sql_user: str = os.getenv("SQL_USER", "sa")
    sql_password: str = os.getenv("SQL_PASSWORD", "YourStrong!Passw0rd")
    sql_trust_server_cert: bool = _as_bool(os.getenv("SQL_TRUST_SERVER_CERT", "yes"), True)
    sql_connection_string: str = os.getenv("SQL_CONNECTION_STRING", "")
    demo_mode: bool = _as_bool(os.getenv("DEMO_MODE", "true"), True)

    ai_mode: str = os.getenv("AI_MODE", "cpu").strip().lower()
    cpu_face_detect_model: str = os.getenv("CPU_FACE_DETECT_MODEL", "hog").strip().lower()
    cpu_distance_threshold: float = float(os.getenv("CPU_DISTANCE_THRESHOLD", "0.45"))
    gpu_cosine_threshold: float = float(os.getenv("GPU_COSINE_THRESHOLD", "0.55"))

    recognition_frame_stride: int = int(os.getenv("RECOGNITION_FRAME_STRIDE", "8"))
    recognition_event_cooldown_sec: int = int(os.getenv("RECOGNITION_EVENT_COOLDOWN_SEC", "20"))

    # Anti-spoofing
    antispoof_enabled: bool = _as_bool(os.getenv("ANTISPOOF_ENABLED", "false"), False)
    # Laplacian variance: real face ~200-800, phone screen ~80-200, print ~30-80.
    # Lowered from 120 — webcam compressed video has naturally lower variance than photos.
    antispoof_laplacian_threshold: float = float(os.getenv("ANTISPOOF_LAPLACIAN_THRESHOLD", "80.0"))
    # LBP histogram std is in 0.003-0.010 range (normalized 256-bin hist).
    antispoof_lbp_threshold: float = float(os.getenv("ANTISPOOF_LBP_THRESHOLD", "0.004"))
    antispoof_frequency_threshold: float = float(os.getenv("ANTISPOOF_FREQUENCY_THRESHOLD", "0.30"))
    # Combined threshold lowered from 0.52 — reduces false positives on real faces.
    antispoof_combined_threshold: float = float(os.getenv("ANTISPOOF_COMBINED_THRESHOLD", "0.40"))
    # Temporal embedding drift: real faces vary slightly each frame; static photos don't.
    # Window over which to collect embeddings before deciding.
    antispoof_temporal_window_sec: float = float(os.getenv("ANTISPOOF_TEMPORAL_WINDOW_SEC", "2.5"))
    # Minimum mean pairwise distance across the window to be considered live.
    # CPU (HOG 128-d L2): real face ≈ 0.02-0.10, static photo ≈ 0.001-0.005.
    antispoof_temporal_threshold_cpu: float = float(os.getenv("ANTISPOOF_TEMPORAL_THRESHOLD_CPU", "0.004"))
    # GPU (ArcFace 512-d cosine dist): real face ≈ 0.002-0.015, static photo ≈ 0.00005-0.0003.
    # Lowered from 0.0004 — a still person may have low natural drift; 0.00015 still rejects static photos.
    antispoof_temporal_threshold_gpu: float = float(os.getenv("ANTISPOOF_TEMPORAL_THRESHOLD_GPU", "0.00015"))

    # Enrollment
    enrollment_pose_distance_threshold: float = float(os.getenv("ENROLLMENT_POSE_DISTANCE_THRESHOLD", "0.15"))
    enrollment_required_poses: int = int(os.getenv("ENROLLMENT_REQUIRED_POSES", "5"))

    smtp_host: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    smtp_from: str = os.getenv("SMTP_FROM", "Attendance Bot <no-reply@example.com>")
    smtp_use_tls: bool = _as_bool(os.getenv("SMTP_USE_TLS", "true"), True)
    smtp_dry_run: bool = _as_bool(os.getenv("SMTP_DRY_RUN", "true"), True)

    # JWT — set JWT_SECRET_KEY in .env before deploying to production
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "CHANGE_ME_IN_PRODUCTION_USE_A_LONG_RANDOM_SECRET")
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))


settings = Settings()
