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

    smtp_host: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    smtp_from: str = os.getenv("SMTP_FROM", "Attendance Bot <no-reply@example.com>")
    smtp_use_tls: bool = _as_bool(os.getenv("SMTP_USE_TLS", "true"), True)
    smtp_dry_run: bool = _as_bool(os.getenv("SMTP_DRY_RUN", "true"), True)


settings = Settings()
