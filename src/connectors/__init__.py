"""Channel connectors.

Each connector normalizes a platform's content into `Post` objects and exposes a
synchronous `poll()` that returns only items newer than its persisted cursor.
"""

from .base import BaseConnector, ConnectorUnavailable
from .telegram_connector import TelegramConnector
from .reddit_connector import RedditConnector
from .x_connector import XConnector
from .linkedin_connector import LinkedInConnector
from .whatsapp_connector import WhatsAppConnector
from .quora_connector import QuoraConnector
from .n8n_connector import N8nConnector
from .brightdata_connector import BrightDataConnector
from .apify_connector import ApifyConnector
from .demo_connector import DemoConnector

# Registry used by the orchestrator to instantiate enabled channels.
CONNECTOR_REGISTRY = {
    "telegram": TelegramConnector,
    "reddit": RedditConnector,
    "x": XConnector,
    "linkedin": LinkedInConnector,
    "whatsapp": WhatsAppConnector,
    "quora": QuoraConnector,
}

__all__ = [
    "BaseConnector",
    "ConnectorUnavailable",
    "CONNECTOR_REGISTRY",
    "TelegramConnector",
    "RedditConnector",
    "XConnector",
    "LinkedInConnector",
    "WhatsAppConnector",
    "QuoraConnector",
    "N8nConnector",
    "BrightDataConnector",
    "ApifyConnector",
    "DemoConnector",
]
