# COA Ultra Monitoring

Static dashboard + JSON-file API backend.

## Run Locally

Use Vercel dev so `/api/db` works:

```bash
npx vercel dev
```

Open the local URL shown in terminal.

## Default Admin

- Username: `kellie`
- Password: `kellie2004`

## Data Storage

- Database file: `data/db.json`
- API endpoint: `api/db.js` (`GET`/`POST`)

## Notes

- `localStorage` is no longer used.
- On Vercel production, filesystem is read-only; writes fall back to `/tmp` (best-effort, not permanent).
