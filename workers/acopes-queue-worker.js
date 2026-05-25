const POLL_INTERVAL_MS = 5000;

function asErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "Unknown queue worker error");
}

function refreshJobCounts(db, jobId) {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('done', 'failed') THEN 1 ELSE 0 END) AS processed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM send_job_items
    WHERE job_id = ?
  `).get(jobId);
  const total = Number(counts?.total || 0);
  const processed = Number(counts?.processed || 0);
  const failed = Number(counts?.failed || 0);
  db.prepare(`
    UPDATE send_jobs
    SET processed_items = ?, failed_items = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(processed, failed, jobId);
  return { total, processed, failed, sent: Math.max(0, processed - failed) };
}

function finishJobIfComplete(db, jobId, onJobComplete) {
  const counts = refreshJobCounts(db, jobId);
  if (counts.processed < counts.total) return false;
  const status = counts.total > 0 && counts.failed >= counts.total ? "failed" : "completed";
  db.prepare("UPDATE send_jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, jobId);
  console.log(`[QUEUE WORKER] job ${jobId} completed — ${counts.sent} sent, ${counts.failed} failed`);
  if (typeof onJobComplete === "function") onJobComplete(jobId);
  return true;
}

async function processJob(db, job, processItem, onJobComplete) {
  const items = db.prepare("SELECT id, job_id, listing_id FROM send_job_items WHERE job_id = ? AND status = 'pending' ORDER BY created_at ASC").all(job.id);
  console.log(`[QUEUE WORKER] processing job ${job.id} — ${items.length} items`);
  db.prepare("UPDATE send_jobs SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
  for (const item of items) {
    try {
      await processItem(job.id, item);
      db.prepare("UPDATE send_job_items SET status = 'done', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.id);
    } catch (error) {
      const message = asErrorMessage(error);
      console.log(`[QUEUE WORKER] job ${job.id} item ${item.listing_id} failed: ${message}`);
      db.prepare("UPDATE send_job_items SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(message, item.id);
    }
    refreshJobCounts(db, job.id);
  }
  finishJobIfComplete(db, job.id, onJobComplete);
}

export function startQueueWorker({ db, processItem, onJobComplete } = {}) {
  if (!db || typeof processItem !== "function") {
    throw new Error("Queue worker requires a database and processItem callback.");
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const jobs = db.prepare("SELECT id FROM send_jobs WHERE status = 'queued' ORDER BY created_at ASC").all();
      for (const job of jobs) {
        await processJob(db, job, processItem, onJobComplete);
      }
    } catch (error) {
      console.error("[QUEUE WORKER]", asErrorMessage(error));
    } finally {
      running = false;
    }
  };
  setInterval(tick, POLL_INTERVAL_MS);
  void tick();
}
