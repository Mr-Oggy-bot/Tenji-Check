from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEV_SECRET = "dev-only-insecure-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_prefix="TC_", extra="ignore")

    database_url: str = ""  # empty = SQLite file inside data_dir; set a postgresql:// URL for PostgreSQL
    data_dir: Path = BACKEND_DIR / "data"
    secret_key: str = DEV_SECRET
    jwt_expiry_minutes: int = 12 * 60
    media_url_ttl_seconds: int = 15 * 60
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    max_upload_mb: float = 10.0
    min_image_width: int = 320
    min_image_height: int = 240
    blur_min_variance: float = 60.0
    exposure_min_mean: float = 0.12
    exposure_max_mean: float = 0.90

    # Vision models. Tile weights are optional: without them the classical baseline segmenter runs.
    tile_model_path: str = ""
    obstacle_enabled: bool = True
    obstacle_model: str = "yolov8s-worldv2.pt"
    obstacle_confidence: float = 0.15
    inference_on_upload: bool = True
    surface_quality: str = "accurate"  # live planner surface model: fast (SegFormer-b0) | accurate (SegFormer-b2)
    live_max_concurrent: int = 2

    # Optional vision-LLM second opinion via GitHub Models. Server-side only; never sent to the browser.
    github_models_token: str = ""
    github_models_model: str = "openai/gpt-4.1-mini"

    osm_enabled: bool = True
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    osm_timeout_seconds: float = 20.0

    public_rate_limit_per_minute: int = 10
    duplicate_radius_m: float = 30.0
    duplicate_window_days: int = 30
    seed_demo: bool = True

    @property
    def db_url(self) -> str:
        if self.database_url:
            return self.database_url
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{(self.data_dir / 'tenjicheck.db').resolve().as_posix()}"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def models_dir(self) -> Path:
        return BACKEND_DIR / "models"

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
