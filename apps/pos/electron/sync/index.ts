import type { SyncStatusSnapshot } from "@devsfleet/shared-types";
import type { BrowserWindow, IpcMain } from "electron";

/**
 * SYNC ENGINE — Phase 3.
 *
 * Scaffold only. The contract it must implement is already fixed in
 * `@devsfleet/shared-types/sync` — read that first; the shapes there are the
 * specification, not a suggestion.
 *
 * The loop, once built:
 *
 *   1. PUSH the outbox. Oldest sequence first, batched. Each item carries the
 *      `client_id` minted when it was created, so the server upserts on it and
 *      a retry after a timeout cannot double-book a sale. Only advance an item
 *      out of `pending` on an explicit server outcome — never on a timeout.
 *
 *   2. PULL by checkpoint. Send the stored high-water mark, apply the returned
 *      changes to the mirror tables, store the new checkpoint. Deletes arrive
 *      as tombstones. Keep paging while `hasMore`.
 *
 *   3. REFRESH the offline stock allocation from the pull response.
 *
 *   4. EMIT status to the renderer so the status bar reflects reality.
 *
 * Rules that are easy to get wrong and expensive to fix:
 *
 *   - Push before pull. Pulling first can overwrite the local stock figure that
 *     an unpushed sale was priced against.
 *   - Never clear an outbox row that the server rejected. It needs a human.
 *   - The mirror is disposable; the outbox is not. Never truncate both together.
 *   - A sale keeps the price that applied when it was rung up, even if the pull
 *     brings a newer one. The receipt in the customer's hand is the truth.
 */

let timer: NodeJS.Timeout | null = null;

const status: SyncStatusSnapshot = {
  online: false,
  lastPullAt: null,
  lastPushAt: null,
  lastCheckpoint: null,
  pendingPushCount: 0,
  failedPushCount: 0,
  syncing: false,
  lastError: null,
};

export function registerSyncHandlers(
  ipcMain: IpcMain,
  _getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("sync:status", () => status);

  ipcMain.handle("sync:now", async () => {
    // TODO(phase-3): push the outbox, then pull by checkpoint.
    return status;
  });

  // TODO(phase-3): start the interval loop on POS_SYNC_INTERVAL_MS, and add a
  // connectivity check that flips `online` by polling GET /health.
}

export function stopSyncEngine(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
