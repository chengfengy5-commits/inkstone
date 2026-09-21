import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const syncState = vi.hoisted(() => {
  let serverCursor = 0
  const notesState = {
    cursor: 0,
    pull: vi.fn(async () => {
      notesState.cursor = serverCursor
    }),
    replayPending: vi.fn(async () => {}),
    setOnline: vi.fn(),
    flush: vi.fn(async () => {}),
  }
  return {
    notesState,
    setServerCursor(value: number) {
      serverCursor = value
    },
    broadcastPost: vi.fn(),
    broadcastClose: vi.fn(),
  }
})

vi.mock('./api', () => ({ CLIENT_ID: 'polling-client' }))
vi.mock('./db', () => ({
  createBroadcast: () => ({
    post: syncState.broadcastPost,
    close: syncState.broadcastClose,
  }),
}))
vi.mock('../store/notes', () => ({
  useNotes: Object.assign(vi.fn(), { getState: () => syncState.notesState }),
  acknowledgeOutboxBaseAdvanced: vi.fn(),
  acknowledgeOutboxResult: vi.fn(),
}))
vi.mock('../store/session', () => ({
  useSession: Object.assign(vi.fn(), { getState: () => ({}) }),
}))

import { SyncEngine } from './sync'

describe('SyncEngine polling fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncState.notesState.cursor = 0
    syncState.setServerCursor(0)
    syncState.notesState.pull.mockClear()
    syncState.notesState.replayPending.mockClear()
    syncState.broadcastPost.mockClear()
    syncState.broadcastClose.mockClear()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('observes a second-session change by polling when realtime push is disabled', async () => {
    const engine = new SyncEngine(false, 5_000)
    engine.start()

    await vi.advanceTimersByTimeAsync(261)
    expect(syncState.notesState.pull).not.toHaveBeenCalled()

    syncState.setServerCursor(7)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(syncState.notesState.pull).toHaveBeenCalledTimes(1)
    expect(syncState.notesState.cursor).toBe(7)
    expect(syncState.notesState.replayPending).toHaveBeenCalledTimes(1)

    engine.dispose()
    expect(syncState.broadcastClose).toHaveBeenCalledTimes(1)
  })
})
