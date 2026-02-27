# nostalge-client

A responsive PWA for browsing your Last.fm music library, powered by a self-hosted PocketBase backend.

Built with React, TypeScript, Vite, Tailwind CSS, and shadcn/ui.

## Prerequisites

- The [music-cms-mvp](https://github.com/mclachlanr/music-cms-mvp) backend running on your local network (PocketBase + sync service)
- Node.js 18+
- Your PocketBase instance must have port `8090` exposed and public read access enabled on all collections

## Setup

Clone the repo and install dependencies:

```bash
git clone https://github.com/mclachlanr/nostalge-client.git
cd nostalge-client
npm install
```

Create a `.env` file pointing to your PocketBase instance. Replace the IP with your server's local IP address:

```bash
echo 'VITE_POCKETBASE_URL=http://192.168.86.141:8095' > .env
```

To find your server's IP, run `hostname -I` on the machine running PocketBase.

## Verifying the backend

Before starting the client, confirm PocketBase is reachable and has data.

### 1. Health check

```bash
curl http://192.168.86.141:8095/api/health
```

You should get back:

```json
{"code":200,"message":"API is healthy."}
```

If this fails, check that port `8095` is mapped in your `docker-compose.yml`:

```yaml
pocketbase:
  ports:
    - "8095:8090"
```

Then restart your containers with `sudo docker compose up -d`.

### 2. Enable public read access

The PWA reads data without authentication, so all collections need public read rules. SSH into your server and run:

```bash
cd /volume1/docker/music-cms
export $(grep -v '^#' .env | xargs)

TOKEN=$(curl -s -X POST http://localhost:8095/api/admins/auth-with-password \
  -H "Content-Type: application/json" \
  -d '{"identity":"'"$POCKETBASE_ADMIN_EMAIL"'","password":"'"$POCKETBASE_ADMIN_PASSWORD"'"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

for col in artists albums tracks scrobbles sync_jobs; do
  curl -s -X PATCH "http://localhost:8095/api/collections/$col" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"listRule":"","viewRule":""}' > /dev/null
  echo "$col: public read enabled"
done
```

### 3. Check collections have data

```bash
# Artists (should return paginated results)
curl -s "http://192.168.86.141:8095/api/collections/artists/records?perPage=1" | python3 -m json.tool

# Albums
curl -s "http://192.168.86.141:8095/api/collections/albums/records?perPage=1" | python3 -m json.tool

# Tracks
curl -s "http://192.168.86.141:8095/api/collections/tracks/records?perPage=1" | python3 -m json.tool
```

Each response should include a `totalItems` count and at least one record in the `items` array. If you get a 403 error, public read access hasn't been enabled — see the backend repo for the setup script.

### 4. Check CORS

Open a browser console on any page and run:

```javascript
fetch('http://192.168.86.141:8095/api/health')
  .then(r => r.json())
  .then(console.log)
  .catch(console.error)
```

If you see a CORS error, you may need to adjust PocketBase's allowed origins. By default PocketBase allows all origins, so this should work out of the box.

## Running the dev server

```bash
npm run dev
```

This starts Vite on `http://localhost:5173`. To access from other devices on your network (e.g. testing on your phone):

```bash
npm run dev -- --host
```

This exposes the dev server on your local IP, e.g. `http://192.168.86.141:5173`.

## Verifying the app

Once the dev server is running:

1. Open the app in your browser — you should see the Artists grid populated with images and play counts
2. Try searching for an artist by name
3. Tap an artist to see their detail page with albums, bio, and tags
4. Navigate to the Albums and Activity tabs
5. On mobile, check that the bottom navigation works and the layout is responsive

### Troubleshooting

| Problem | Fix |
|---|---|
| Blank page, no data | Open browser DevTools → Network tab. Check for failed requests to your PocketBase URL. Verify `.env` has the correct IP. |
| `ERR_CONNECTION_REFUSED` | PocketBase isn't running or port 8095 isn't exposed. Run `sudo docker compose ps` to check container status. |
| `ERR_NAME_NOT_RESOLVED` | You're using a hostname that can't be resolved. Use the IP address directly. |
| Data loads but images are broken | Album/artist images come from Last.fm CDN. Check your network connection. Missing images will show a placeholder. |
| 403 "Only admins can perform this action" | Public read access not enabled. Run the public read script in step 2 above. |
| CORS errors in console | Shouldn't happen with default PocketBase config. Check that you're using `http://` not `https://` for local connections. |

## Building for production

```bash
npm run build
```

The built files go to `dist/`. For GitHub Pages deployment, the repo includes a GitHub Actions workflow that builds and deploys on push to `main`.

## Project structure

```
src/
├── components/     # Reusable UI components
├── lib/            # PocketBase client, utilities
├── pages/          # Route pages (Artists, Albums, Activity, etc.)
└── App.tsx         # Router and layout
```

## Stack

- **React 18** + TypeScript
- **Vite** with vite-plugin-pwa
- **Tailwind CSS** + **shadcn/ui**
- **PocketBase JS SDK** 0.21.5
