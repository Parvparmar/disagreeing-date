# Opinionated face inference service

This separate Python service is located at `services/face-inference`. It verifies the user's Supabase access token, checks their face-learning opt-in, downloads the requested image from that user's Storage folder, extracts a face vector, and stores it in the private recommendation tables. It never returns a face vector to the browser.

## Local run with Docker

1. Apply the face recommendation migration and `supabase/migrations/20261122200000_demo_face_learning.sql` to the same Supabase project. The latter enables learning only for existing profiles marked `is_demo`; it creates no accounts.
2. Copy `.env.example` to `.env` in this folder and enter the project URL, publishable key, server-only secret key, allowed frontend origins, and a long random `FACE_BACKFILL_TOKEN`. Keep `.env` private and out of git.
3. From the repository root, build and run the service:

   ```powershell
   docker build -t opinionated-face-inference ./services/face-inference
   docker run --gpus all --name opinionated-face-inference --env-file ./services/face-inference/.env -p 8000:8000 opinionated-face-inference
   ```

4. Check `http://localhost:8000/health`. In the frontend `.env`, set:

   ```text
   VITE_FACE_FEATURE_SERVICE_URL=http://localhost:8000
   ```

   Restart Vite after changing `.env`. In Profile, turn on **Learn my photo preferences**, then upload a profile photo. The option must be enabled before upload for that photo to be indexed.

5. After the service is running, process the already-uploaded photos of enabled demo profiles once. Send the backfill token in the header; the endpoint only selects existing `is_demo` profiles whose consent is enabled:

   ```powershell
   Invoke-RestMethod -Method Post -Uri http://localhost:8000/v1/admin/demo-photos/backfill -Headers @{ "X-Backfill-Token" = "YOUR_FACE_BACKFILL_TOKEN" }
   ```

   For a hosted service, use its HTTPS URL. Configure `FACE_BACKFILL_TOKEN` in the service environment first, then redeploy. Photos that contain no detectable face are reported as failed and can be reviewed individually.

## Hosted container deployment

Create a Docker web service from this repository in your container host:

- Docker build context: `services/face-inference`
- Dockerfile: `services/face-inference/Dockerfile`
- GPU: NVIDIA CUDA 12.8 and cuDNN 9; configure the host to pass through an NVIDIA GPU
- Exposed port: `8000` (the service also honors the host's `PORT` variable)
- Health check path: `/health`
- Environment variables: copy the entries from `.env.example`; use the production frontend's exact HTTPS origin in `FRONTEND_ORIGINS`

After the host provides an HTTPS service URL, set `VITE_FACE_FEATURE_SERVICE_URL` on the frontend host to that origin and rebuild the frontend. Keep `SUPABASE_SECRET_KEY` only in the face service's server environment. The model pack downloads on the first photo request and is cached under `/opt/face-home/.insightface`; use a persistent volume at `/opt/face-home` if the host replaces container storage on redeploy.
