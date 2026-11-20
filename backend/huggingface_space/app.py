"""Hugging Face Space entry point (Gradio SDK).

Serves the SmartAttend REST API under /api/* and a small status page at /.
There is deliberately NO photo upload on this page: attendance photos are only accepted
from the live camera in the web app, through the API.
"""
import os

# Gradio on Spaces otherwise starts a separate Node "SSR" server that grabs port 7860.
os.environ.setdefault("GRADIO_SSR_MODE", "false")

# ZeroGPU hardware: Hugging Face shuts the Space down unless the `spaces` package is imported
# (before gradio) and at least one @spaces.GPU function exists at start-up. Face recognition
# here runs on CPU, so this function is never called; on CPU hardware it is a plain no-op.
try:
    import spaces
except ImportError:  # not on Hugging Face
    spaces = None

if spaces is not None:
    @spaces.GPU(duration=5)
    def _zerogpu_keepalive() -> str:
        return "ok"

import gradio as gr  # noqa: E402
import uvicorn  # noqa: E402

from app import config  # noqa: E402
from app.main import STATUS, app as api  # noqa: E402


def status():
    missing = [k for k, v in config.REQUIRED_SECRETS.items() if not v]
    return {
        "api": "running",
        "face_models": STATUS["models"],
        "database": STATUS["database"],
        "demo_seed": STATUS["seed"] if config.SEED_DEMO else "off",
        "missing_secrets": missing or "none",
        "allowed_origins": config.ALLOWED_ORIGINS,
    }


with gr.Blocks(title="SmartAttend API") as ui:
    gr.Markdown(
        "# SmartAttend API\n"
        "Backend for live classroom attendance with face recognition. "
        "Teachers use the web app; this page only shows whether the service is healthy."
    )
    out = gr.JSON(label="Status")
    gr.Button("Refresh").click(status, outputs=out)
    ui.load(status, outputs=out)

app = gr.mount_gradio_app(api, ui, path="/", ssr_mode=False)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "7860")))
