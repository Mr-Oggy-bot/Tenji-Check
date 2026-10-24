# Deploying TenjiCheck

## Hugging Face Space (free, Docker)

One container runs both servers. The backend (FastAPI, PyTorch models) listens on `127.0.0.1:8000`, and Next.js
listens on `:7860` and proxies `/api` to the backend. The models (SegFormer b0/b2 and YOLO-World with
TenjiCheck's prompts) are downloaded while the image builds. The first build takes about 15–25 minutes.

1. Create a Space at <https://huggingface.co/new-space> named `tenjicheck`, choose **Docker** → **Blank**, and
   **CPU basic** (free).
2. In the Space, open **Settings → Variables and secrets** and add these secrets:
   - `TC_SECRET_KEY`: a long random string. Without it, a new key is generated at every start and everyone is
     signed out.
   - `TC_GITHUB_MODELS_TOKEN` (optional): a GitHub token with `models:read`. It enables "Ask TenjiCheck" and the
     live view's second opinion.
3. Push the code. This needs a Hugging Face token with write access:

   ```sh
   HF_USER=<your-hf-name> HF_TOKEN=<hf-write-token> sh deploy/push_hf.sh
   ```

**What to expect**

- The site runs over HTTPS at `https://<your-hf-name>-tenjicheck.hf.space`, so the phone camera works.
- **Data is not persistent.** The free Space disk is wiped when the Space restarts or rebuilds. The demo data is
  seeded again, and anything users added is lost. For lasting data, add HF persistent storage and set
  `TC_DATA_DIR=/data`, or point `TC_DATABASE_URL` to PostgreSQL. Uploaded photos still need persistent storage.
- **Free Spaces sleep** after a period without visitors. The first visit after that takes a minute to wake it up.
- **Demo sign-ins are public.** The demo accounts (password `tenjicheck-demo`) are in the README, so anyone can
  sign in as a demo user. Set `TC_SEED_DEMO=false` and create real users for anything beyond a demo.
