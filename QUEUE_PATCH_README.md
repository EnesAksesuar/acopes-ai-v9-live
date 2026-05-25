# Queue Send Selected Patch

This patch adds an optional in-process queue for Send Selected without replacing the existing synchronous send flow.

## Enable

Set the server-side environment flag:

```env
USE_QUEUE_SEND_SELECTED=true
```

The frontend reads `GET /api/config` and uses `/api/send-selected-queue` only when `useQueueSend` is true. With the default `false`, it continues to use the existing synchronous send behavior through `/api/send-selected`.

## Endpoints

- `GET /api/config` returns `{ "useQueueSend": boolean }`.
- `POST /api/send-selected-queue` accepts the same body as Send Selected and returns `{ "ok": true, "job_id": "uuid", "status": "queued", "count": N }`.
- `GET /api/send-status?job_id=xxx` returns queued send progress.

## Worker

`workers/acopes-queue-worker.js` starts inside `server.js` after DB initialization and polls every 5 seconds. It processes pending job items through the existing send handler with one listing at a time.
