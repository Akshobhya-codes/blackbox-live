"""BlackBox brain service.

Hosts the two Python-only sponsor integrations behind a small HTTP API that the
Node application calls:

  * Cognee  - the persistent case graph. Cases, participants, interviews,
              claims, contradictions and sources are ingested as connected
              memory and queried back during reconstruction.
  * Strands - the agent layer. Each investigative role is a Strands agent with
              its own tools and a Pydantic-validated structured output.

Both are optional. If a package or credential is missing the endpoint reports
mode="demo" (or "unavailable") and the Node side degrades visibly rather than
pretending the integration ran. Nothing here ever fabricates a citation.

Run:  uvicorn app:app --port 8077
"""

from __future__ import annotations

import asyncio
import inspect
import os
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel, Field

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

app = FastAPI(title="BlackBox Brain", version="1.0.0")

# Cognee needs an LLM key for entity extraction; it accepts LLM_API_KEY.
if os.getenv("OPENAI_API_KEY") and not os.getenv("LLM_API_KEY"):
    os.environ["LLM_API_KEY"] = os.environ["OPENAI_API_KEY"]
os.environ.setdefault("TELEMETRY_DISABLED", "true")

Mode = Literal["live", "demo", "unavailable"]


# ---------------------------------------------------------------------------
# Cognee
# ---------------------------------------------------------------------------
class CogneeAdapter:
    """Wraps whichever Cognee API surface is actually installed.

    Cognee 1.x exposes remember/recall/forget; earlier builds expose
    add/cognify/search. Rather than guessing, the adapter inspects the module
    at import time and binds to what is present.
    """

    def __init__(self) -> None:
        self.module: Any = None
        self.storage: str = ""
        self.style: str = "none"
        self.error: str | None = None
        self._lock = asyncio.Lock()
        self._ingested: set[str] = set()

        if not os.getenv("LLM_API_KEY"):
            self.error = "no LLM_API_KEY / OPENAI_API_KEY for graph extraction"
            return
        try:
            import cognee  # type: ignore

            # Cognee defaults its vector store to a directory inside
            # site-packages. Under a OneDrive-synced project path containing
            # spaces, LanceDB cannot persist its temp files there and every
            # cognify call dies with an opaque IO error. Relocate the store to
            # a short, unsynced path before anything touches it.
            storage = os.getenv(
                "COGNEE_STORAGE_DIR",
                os.path.join(os.path.expanduser("~"), ".blackbox-cognee"),
            )
            os.makedirs(os.path.join(storage, "data"), exist_ok=True)
            os.makedirs(os.path.join(storage, "system"), exist_ok=True)
            cognee.config.data_root_directory(os.path.join(storage, "data"))
            cognee.config.system_root_directory(os.path.join(storage, "system"))
            self.storage = storage

            self.module = cognee
            if hasattr(cognee, "remember") and hasattr(cognee, "recall"):
                self.style = "remember"
            elif hasattr(cognee, "add") and hasattr(cognee, "cognify"):
                self.style = "add_cognify"
            else:
                self.error = "installed cognee exposes neither remember/recall nor add/cognify"
        except Exception as exc:  # pragma: no cover - import environment dependent
            self.error = f"{type(exc).__name__}: {exc}"

    @property
    def mode(self) -> Mode:
        if self.module and self.style != "none":
            return "live"
        return "unavailable"

    def detail(self) -> str:
        if self.mode == "live":
            return f"cognee {self.style} API, store at {self.storage}"
        return self.error or "cognee not installed"

    @staticmethod
    async def _maybe_await(value: Any) -> Any:
        if inspect.isawaitable(value):
            return await value
        return value

    async def ingest(self, dataset: str, documents: list[str]) -> dict[str, Any]:
        if self.mode != "live":
            return {"ok": False, "mode": self.mode, "detail": self.detail()}

        async with self._lock:
            try:
                if self.style == "remember":
                    for doc in documents:
                        await self._maybe_await(self.module.remember(doc))
                else:
                    await self._maybe_await(self.module.add(documents, dataset_name=dataset))
                    await self._maybe_await(self.module.cognify(datasets=[dataset]))
                self._ingested.add(dataset)
                return {"ok": True, "mode": "live", "documents": len(documents)}
            except Exception as exc:
                return {
                    "ok": False,
                    "mode": "live",
                    "detail": f"ingest failed: {type(exc).__name__}: {exc}",
                }

    async def recall(self, dataset: str, query: str) -> dict[str, Any]:
        if self.mode != "live":
            return {"ok": False, "mode": self.mode, "detail": self.detail(), "results": []}

        try:
            if self.style == "remember":
                raw = await self._maybe_await(self.module.recall(query_text=query))
            else:
                raw = await self._maybe_await(self.module.search(query_text=query))
            results = raw if isinstance(raw, list) else [raw]
            return {
                "ok": True,
                "mode": "live",
                "results": [str(r)[:1200] for r in results][:12],
            }
        except Exception as exc:
            return {
                "ok": False,
                "mode": "live",
                "detail": f"recall failed: {type(exc).__name__}: {exc}",
                "results": [],
            }


# ---------------------------------------------------------------------------
# Strands
# ---------------------------------------------------------------------------
class ReportOut(BaseModel):
    summary: str = Field(description="Plain-language account of what can and cannot be established")
    established: list[str] = Field(description="Facts corroborated by two or more independent sources")
    disputed: list[str] = Field(description="Points where accounts are incompatible")
    unresolved: list[str] = Field(description="Questions no source currently answers")
    recommended_next_action: str = Field(description="The single highest-value next investigative step")
    confidence: int = Field(description="0-100 confidence in the reconstruction, not in any person")
    confidence_basis: str = Field(description="Why that number, in one sentence")


class StrandsAdapter:
    """Creates Strands agents bound to an available model provider."""

    def __init__(self) -> None:
        self.available = False
        self.error: str | None = None
        self.model: Any = None
        self.provider = "none"

        try:
            from strands import Agent  # noqa: F401

            self.available = True
        except Exception as exc:
            self.error = f"strands not installed: {type(exc).__name__}"
            return

        key = os.getenv("OPENAI_API_KEY")
        if not key:
            self.available = False
            self.error = "strands installed but no OPENAI_API_KEY for a model provider"
            return

        try:
            from strands.models.openai import OpenAIModel  # type: ignore

            self.model = OpenAIModel(
                client_args={"api_key": key},
                model_id=os.getenv("OPENAI_MODEL", "gpt-4o"),
            )
            self.provider = f"openai:{os.getenv('OPENAI_MODEL', 'gpt-4o')}"
        except Exception as exc:
            self.available = False
            self.error = f"no usable Strands model provider: {type(exc).__name__}: {exc}"

    @property
    def mode(self) -> Mode:
        return "live" if self.available else "unavailable"

    def detail(self) -> str:
        return f"strands agents on {self.provider}" if self.available else (self.error or "unavailable")

    async def report(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.available:
            return {"ok": False, "mode": self.mode, "detail": self.detail()}

        from strands import Agent

        agent = Agent(
            model=self.model,
            system_prompt=(
                "You are the Report Agent inside BlackBox, an incident reconstruction system "
                "used by investigators.\n\n"
                "ABSOLUTE RULES:\n"
                "- Never state who is at fault and never suggest anyone is lying. An "
                "inconsistent account is not a dishonest one.\n"
                "- Distinguish facts, claims, inferences and unknowns in your wording.\n"
                "- Only use material present in the payload. Never invent a source, a "
                "quotation, or a detail nobody reported.\n"
                "- 'Established' means corroborated by two or more independent sources, not "
                "proven true.\n"
                "- Confidence is confidence in the reconstruction, never in a person's honesty. "
                "Explain the number.\n"
                "- The recommended next action must be something an investigator can actually do."
            ),
        )
        try:
            result = await asyncio.to_thread(
                agent,
                "Produce the reconstruction report for this case:\n\n"
                + _compact(payload),
                structured_output_model=ReportOut,
            )
            out = getattr(result, "structured_output", None)
            if out is None:
                return {"ok": False, "mode": "live", "detail": "no structured output returned"}
            return {"ok": True, "mode": "live", "provider": self.provider, "report": out.model_dump()}
        except Exception as exc:
            return {"ok": False, "mode": "live", "detail": f"{type(exc).__name__}: {exc}"}


def _compact(payload: dict[str, Any], limit: int = 14000) -> str:
    import json

    text = json.dumps(payload, indent=2, default=str)
    return text[:limit]


cognee_adapter = CogneeAdapter()
strands_adapter = StrandsAdapter()


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
class IngestBody(BaseModel):
    dataset: str
    documents: list[str]


class RecallBody(BaseModel):
    dataset: str
    query: str


class ReportBody(BaseModel):
    payload: dict[str, Any]


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "cognee": {"mode": cognee_adapter.mode, "detail": cognee_adapter.detail()},
        "strands": {"mode": strands_adapter.mode, "detail": strands_adapter.detail()},
    }


@app.post("/memory/ingest")
async def memory_ingest(body: IngestBody) -> dict[str, Any]:
    return await cognee_adapter.ingest(body.dataset, body.documents)


@app.post("/memory/recall")
async def memory_recall(body: RecallBody) -> dict[str, Any]:
    return await cognee_adapter.recall(body.dataset, body.query)


@app.post("/agents/report")
async def agents_report(body: ReportBody) -> dict[str, Any]:
    return await strands_adapter.report(body.payload)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("BRAIN_PORT", "8077")))
