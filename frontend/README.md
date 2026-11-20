# SmartAttend — web app (Next.js)

Deployed on **Vercel**. Talks to the backend API (Hugging Face Space) at `NEXT_PUBLIC_API_URL`.

```bash
npm install
npm run dev      # http://localhost:3000 (backend expected at http://localhost:8000 unless NEXT_PUBLIC_API_URL is set)
npm run build    # production build, same as Vercel runs
```

On Vercel: import this folder (Root Directory = `frontend`), set `NEXT_PUBLIC_API_URL`, deploy.
Then add the Vercel URL to the backend's `ALLOWED_ORIGINS` secret.
