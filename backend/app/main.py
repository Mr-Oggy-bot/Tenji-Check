import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import auth, build, insights, inspect, issues, live, planner, recurring
from .config import DEV_SECRET, get_settings
from .db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("tenjicheck")


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="TenjiCheck API", version="0.1.0",
                  description="Pre-handover tactile paving screening. AI proposes; authorised humans decide.")
    app.add_middleware(CORSMiddleware, allow_origins=s.origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Request-ID"])

    @app.middleware("http")
    async def request_log(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        t0 = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        if not request.url.path.endswith("/file"):
            log.info("%s %s %s %d %.0fms", rid, request.method, request.url.path, response.status_code,
                     (time.perf_counter() - t0) * 1000)
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": {"code": "validation_error",
                                                                 "message": "; ".join(f"{e['field']}: {e['message']}" for e in errors),
                                                                 "errors": errors}})

    for r in (auth.router, inspect.router, issues.router, build.router, insights.router, live.router, planner.router, recurring.router):
        app.include_router(r, prefix="/api/v1")

    @app.get("/api/v1/health")
    def health():
        return {"status": "ok", "dev_secret_in_use": s.secret_key == DEV_SECRET}

    @app.on_event("startup")
    def startup():
        s.data_dir.mkdir(parents=True, exist_ok=True)
        init_db()
        if s.secret_key == DEV_SECRET:
            log.warning("Using the built-in development secret. Set TC_SECRET_KEY before any real deployment.")
        if s.seed_demo:
            from .seed import seed

            seed()

    return app


app = create_app()
