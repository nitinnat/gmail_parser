import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.log_buffer import log_buffer
from api.routers import sync, analytics, emails, actions, categories, alert_rules

# Attach in-process log capture to all gmail_parser loggers
logging.getLogger("gmail_parser").addHandler(log_buffer)
logging.getLogger("gmail_parser").setLevel(logging.INFO)

app = FastAPI(title="Gmail Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sync.router, prefix="/api/sync")
app.include_router(analytics.router, prefix="/api/analytics")
app.include_router(emails.router, prefix="/api/emails")
app.include_router(actions.router, prefix="/api/actions")
app.include_router(categories.router, prefix="/api/categories")
app.include_router(alert_rules.router, prefix="/api/alerts")
