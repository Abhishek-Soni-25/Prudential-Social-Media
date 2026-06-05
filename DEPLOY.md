# Deploy to Google Cloud Run (repo → Cloud Build trigger → Cloud Run)

The whole app runs as **one container**: the Dockerfile builds the React dashboard and
serves it together with the FastAPI backend on a single port. So one Cloud Run service =
the full working app, exactly like local.

Files that make this work (already in the repo):
- `Dockerfile` — builds frontend, then serves SPA + API via uvicorn on `$PORT`.
- `cloudbuild.yaml` — builds the image and deploys to Cloud Run.
- `.dockerignore` — keeps secrets/junk out of the image.

---

## One-time setup

1. **Push the code** to your Git repo (GitHub or Cloud Source Repositories), including
   `Dockerfile`, `cloudbuild.yaml`, `.dockerignore`, and the logo at
   `frontend/public/prudential-logo.png`. (`.env` stays out — it's gitignored.)

2. **Enable APIs** (GCP Console → APIs, or `gcloud`):
   ```
   gcloud services enable cloudbuild.googleapis.com run.googleapis.com artifactregistry.googleapis.com
   ```

3. **Give Cloud Build permission to deploy.** Cloud Build → Settings → enable
   **Cloud Run Admin** and **Service Account User** for the Cloud Build service account.
   (CLI equivalent — replace PROJECT_NUMBER):
   ```
   gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com" --role="roles/run.admin"
   gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com" --role="roles/iam.serviceAccountUser"
   ```

---

## Create the trigger (the part you do in the console)

1. **Cloud Build → Triggers → Connect Repository** → pick your repo + branch.
2. **Create Trigger:**
   - Event: **Push to a branch** (e.g. `main`)
   - Configuration: **Cloud Build configuration file** → `/cloudbuild.yaml`
3. **Advanced → Substitution variables** — add:
   - `_GROQ_API_KEY` = your Groq key (the one in your `.env`)
   - *(optional)* `_REGION` = `asia-south1`, `_SERVICE` = `prudential-surveillance`
4. **Save**, then **Run** the trigger (or `git push`).

That's it. Cloud Build will: create the Artifact Registry repo (if needed) → build the
image → deploy to Cloud Run. When it finishes, open the **Service URL** shown in
Cloud Run — the dashboard loads and **Run Scan** works (live Reddit/LinkedIn via your n8n
webhook + Groq; the 4 demo channels run in the browser).

---

## Notes
- **Secret:** `GROQ_API_KEY` is injected as a Cloud Run env var from the `_GROQ_API_KEY`
  substitution — it is **not** committed. (For stronger security, store it in Secret Manager
  and swap `--set-env-vars` for `--set-secrets` in `cloudbuild.yaml`.)
- **No frontend env needed:** the dashboard calls `/api/...` on the same origin, so it just
  works once deployed.
- **Region:** defaults to `asia-south1` (Mumbai). Change in `cloudbuild.yaml` or via the
  `_REGION` substitution.
- **Outbound calls** (Groq + the n8n webhook) work from Cloud Run by default; the service
  timeout is set to 300s to comfortably cover the n8n fetch.

## (Optional) one-shot deploy without a trigger
From your machine with `gcloud` installed:
```
gcloud run deploy prudential-surveillance --source . --region asia-south1 \
  --allow-unauthenticated --port 8080 --set-env-vars GROQ_API_KEY=YOUR_KEY
```
This uses the same `Dockerfile` and deploys in one command.
