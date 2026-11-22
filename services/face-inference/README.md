# PaceMate face inference service

This separate Python service is located at `services/face-inference`. It verifies the user's Supabase access token, checks their face-learning opt-in, downloads the requested image from that user's Storage folder, extracts a face vector, and stores it in the private recommendation tables. It never returns a face vector to the browser.

## Local run with Docker

1. Apply `supabase/migrations/20261122180000_face_recommendations.sql` to the same Supabase project.
2. Copy `.env.example` to `.env` in this folder and enter the project URL, publishable key, server-only secret key, and allowed frontend origins. Keep `.env` private and out of git.
3. From the repository root, build and run the service:

   ```powershell
   docker build -t pacemate-face-inference ./services/face-inference
   docker run --name pacemate-face-inference --env-file ./services/face-inference/.env -p 8000:8000 pacemate-face-inference
   ```

4. Check `http://localhost:8000/health`. In the frontend `.env`, set:

   ```text
   VITE_FACE_FEATURE_SERVICE_URL=http://localhost:8000
   ```

   Restart Vite after changing `.env`. In Profile, turn on **Learn my photo preferences**, then upload a profile photo. The option must be enabled before upload for that photo to be indexed.

## Hosted container deployment

Create a Docker web service from this repository in your container host:

- Docker build context: `services/face-inference`
- Dockerfile: `services/face-inference/Dockerfile`
- Exposed port: `8000` (the service also honors the host's `PORT` variable)
- Health check path: `/health`
- Environment variables: copy the entries from `.env.example`; use the production frontend's exact HTTPS origin in `FRONTEND_ORIGINS`

After the host provides an HTTPS service URL, set `VITE_FACE_FEATURE_SERVICE_URL` on the frontend host to that origin and rebuild the frontend. Keep `SUPABASE_SECRET_KEY` only in the face service's server environment. The model pack downloads on the first photo request and is cached under `/opt/face-home/.insightface`; use a persistent volume at `/opt/face-home` if the host replaces container storage on redeploy.
