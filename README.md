# Vercel Cloudinary Search Function

This project provides a small Vercel serverless function that proxies search requests to the Cloudinary Search API and returns a safe JSON list suitable for embedding on static pages (e.g., a Squarespace page).

Environment variables required (set in Vercel project settings):

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Endpoint: `GET` or `POST` to `/api/search` with params:

- `q` — search text
- `next_cursor` — optional cursor for pagination

Example curl:

```bash
curl -G 'https://your-vercel-deploy.vercel.app/api/search' --data-urlencode 'q=cat'
```

Response format:

```json
{
  "results": [ { "asset_id":"...", "public_id":"...", "secure_url":"..." } ],
  "next_cursor": "...",
  "total_count": 10
}
```
