import { AlertTriangle, BookOpenCheck, Brain, CircleDot, FlaskConical, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Empty } from '../../components/feedback'
import { Modal } from '../../components/overlay'
import { t, useLocale, type MessageKey } from '../../lib/i18n'
import { useNotes } from '../../store/notes'
import { useUi } from '../../store/ui'
import { buildLearningReviewQueue, formatLocalDate, parseLearningReviewMetadata, type LearningReviewItem, type ReviewDueKind, updateLearningReviewMetadata } from './learning-review'
import { buildLearningWorkbench, LEARNING_LANES, type LearningLane, type LearningWorkbenchItem } from './learning-workbench'
import { replaceLearningStatus, type SupportedLearningLane } from './learning-status'

const LANE_PRESENTATION: Record<LearningLane, { label: MessageKey; description: MessageKey; icon: ReactNode; tone: string }> = {
  practice: {
    label: 'learning.lane_practice',
    description: 'learning.lane_practice_description',
    icon: <FlaskConical size={15} />,
    tone: 'text-[var(--warning)]',
  },
  learning: {
    label: 'learning.lane_learning',
    description: 'learning.lane_learning_description',
    icon: <CircleDot size={15} />,
    tone: 'text-[var(--accent)]',
  },
  review: {
    label: 'learning.lane_review',
    description: 'learning.lane_review_description',
    icon: <RefreshCw size={15} />,
    tone: 'text-[var(--success)]',
  },
  mastered: {
    label: 'learning.lane_mastered',
    description: 'learning.lane_mastered_description',
    icon: <Brain size={15} />,
    tone: 'text-[var(--text-secondary)]',
  },
  attention: {
    label: 'learning.lane_attention',
    description: 'learning.lane_attention_description',
    icon: <AlertTriangle size={15} />,
    tone: 'text-[var(--danger)]',
  },
}

const SUPPORTED_LANES = LEARNING_LANES.filter((lane): lane is SupportedLearningLane => lane !== 'attention')

const REVIEW_DUE_LABELS: Record<ReviewDueKind, MessageKey> = {
  overdue: 'learning.review_overdue',
  today: 'learning.review_today',
  upcoming: 'learning.review_upcoming',
  unscheduled: 'learning.review_unscheduled',
  invalid: 'learning.review_invalid',
}

export function LearningWorkbenchPanel({ onClose }: { onClose: () => void }) {
  const locale = useLocale()
  const notes = useNotes((state) => state.notes)
  const contents = useNotes((state) => state.contents)
  const openNote = useNotes((state) => state.openNote)
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set())
  const model = useMemo(() => buildLearningWorkbench(Object.values(notes)), [notes])
  const today = formatLocalDate()
  const reviewQueue = useMemo(() => buildLearningReviewQueue(model.lanes.review, contents, today), [contents, model.lanes.review, today])
  const missingReviewIds = useMemo(() => model.lanes.review
    .filter((item) => contents[item.note.id] === undefined)
    .map((item) => item.note.id), [contents, model.lanes.review])
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }), [locale])

  useEffect(() => {
    for (const id of missingReviewIds) void openNote(id, { navigate: false })
  }, [missingReviewIds.join('|'), openNote])

  const selectNote = (item: LearningWorkbenchItem) => {
    onClose()
    void openNote(item.note.id)
  }

  const changeStatus = async (item: LearningWorkbenchItem, lane: SupportedLearningLane) => {
    if (!item.needsAttention && item.lane === lane) return
    setUpdatingIds((ids) => new Set(ids).add(item.note.id))
    try {
      await openNote(item.note.id, { navigate: false })
      const state = useNotes.getState()
      const content = state.contents[item.note.id]
      if (content === undefined) {
        useUi.getState().toast({ title: t('learning.status_update_failed'), tone: 'danger' })
        return
      }
      const next = updateLearningReviewMetadata(replaceLearningStatus(content, lane), { lastStudied: today })
      state.editContent(item.note.id, next)
    } catch {
      useUi.getState().toast({ title: t('learning.status_update_failed'), tone: 'danger' })
    } finally {
      setUpdatingIds((ids) => {
        const next = new Set(ids)
        next.delete(item.note.id)
        return next
      })
    }
  }

  const changeReviewDate = async (item: LearningWorkbenchItem, reviewDate: string) => {
    if (!reviewDate) return
    setUpdatingIds((ids) => new Set(ids).add(item.note.id))
    try {
      await openNote(item.note.id, { navigate: false })
      const state = useNotes.getState()
      const content = state.contents[item.note.id]
      if (content === undefined) {
        useUi.getState().toast({ title: t('learning.review_date_update_failed'), tone: 'danger' })
        return
      }
      state.editContent(item.note.id, updateLearningReviewMetadata(content, { reviewDate, lastStudied: today }))
    } catch {
      useUi.getState().toast({ title: t('learning.review_date_update_failed'), tone: 'danger' })
    } finally {
      setUpdatingIds((ids) => {
        const next = new Set(ids)
        next.delete(item.note.id)
        return next
      })
    }
  }

  return <Modal
    open
    onClose={onClose}
    width={1180}
    title={<span className="inline-flex items-center gap-2"><BookOpenCheck size={17} />{t('learning.title')}</span>}
    description={t('learning.description')}
    className="md:max-h-[calc(var(--app-viewport-height,100dvh)-64px)]"
  >
    {model.total === 0 ? <Empty
      compact
      art="notes"
      title={t('learning.empty_title')}
      description={t('learning.empty_description')}
    /> : <>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[var(--r-lg)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2.5">
        <span className="text-[12px] text-[var(--text-tertiary)]">{t('learning.total')}</span>
        <strong className="text-[17px] tabular-nums text-[var(--text-primary)]">{model.total}</strong>
        <span className="ml-auto text-[11px] text-[var(--text-quaternary)]">{t('learning.status_hint')}</span>
      </div>

      {model.lanes.review.length > 0 && <ReviewQueue
        queue={reviewQueue}
        loadingCount={missingReviewIds.length}
        onSelect={selectNote}
      />}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {LEARNING_LANES.map((lane) => {
          const presentation = LANE_PRESENTATION[lane]
          const items = model.lanes[lane]
          return <section key={lane} aria-labelledby={`learning-lane-${lane}`} className="min-w-0 rounded-[var(--r-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)]">
            <header className="border-b border-[var(--border-subtle)] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className={presentation.tone}>{presentation.icon}</span>
                <h3 id={`learning-lane-${lane}`} className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{t(presentation.label)}</h3>
                <span className="rounded-full bg-[var(--bg-inset)] px-2 py-0.5 text-[10.5px] tabular-nums text-[var(--text-tertiary)]">{items.length}</span>
              </div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--text-quaternary)]">{t(presentation.description)}</p>
            </header>

            <div className="space-y-1 p-1.5">
              {items.length === 0 ? <p className="px-2 py-5 text-center text-[11px] text-[var(--text-quaternary)]">{t('learning.lane_empty')}</p> : items.map((item) => <article key={item.note.id} className="overflow-hidden rounded-[var(--r-md)] border border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]">
                <button
                  type="button"
                  onClick={() => selectNote(item)}
                  aria-label={t('learning.open_note', { title: item.note.title })}
                  className="group block min-h-11 w-full px-2 pt-2 pb-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-ring)]"
                >
                  <span className="line-clamp-2 break-words text-[11.5px] leading-[1.45] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">{item.note.title}</span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-[9.5px] text-[var(--text-quaternary)]">
                    <span>{dateFormatter.format(item.note.updatedAt)}</span>
                    {item.needsAttention && <span className="truncate text-[var(--danger)]">{item.statusTags.join(' / ')}</span>}
                  </span>
                </button>
                <div className="px-1.5 pb-1.5">
                  <select
                    value={item.needsAttention ? '' : item.lane}
                    disabled={updatingIds.has(item.note.id)}
                    aria-label={t('learning.change_status', { title: item.note.title })}
                    onChange={(event) => void changeStatus(item, event.target.value as SupportedLearningLane)}
                    className="min-h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-[10.5px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
                  >
                    {item.needsAttention && <option value="" disabled>{t('learning.choose_status')}</option>}
                    {SUPPORTED_LANES.map((statusLane) => <option key={statusLane} value={statusLane}>{t(LANE_PRESENTATION[statusLane].label)}</option>)}
                  </select>
                  {lane === 'review' && <label className="mt-1.5 block text-[10px] text-[var(--text-quaternary)]">
                    <span className="sr-only">{t('learning.schedule_review', { title: item.note.title })}</span>
                    <input
                      type="date"
                      value={parseReviewDate(contents[item.note.id])}
                      disabled={updatingIds.has(item.note.id)}
                      aria-label={t('learning.schedule_review', { title: item.note.title })}
                      onChange={(event) => void changeReviewDate(item, event.target.value)}
                      className="min-h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-[10.5px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
                    />
                  </label>}
                </div>
              </article>)}
            </div>
          </section>
        })}
      </div>
    </>}
  </Modal>
}

function ReviewQueue({
  queue,
  loadingCount,
  onSelect,
}: {
  queue: ReturnType<typeof buildLearningReviewQueue>
  loadingCount: number
  onSelect: (item: LearningWorkbenchItem) => void
}) {
  const entries = (Object.keys(REVIEW_DUE_LABELS) as ReviewDueKind[])
    .flatMap((kind) => queue[kind])
  return <section className="mb-4 rounded-[var(--r-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3" aria-labelledby="learning-review-queue">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h3 id="learning-review-queue" className="text-[12.5px] font-semibold text-[var(--text-primary)]">{t('learning.review_queue')}</h3>
      {(Object.keys(REVIEW_DUE_LABELS) as ReviewDueKind[]).map((kind) => <span key={kind} className="rounded-full bg-[var(--bg-inset)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]">
        {t(REVIEW_DUE_LABELS[kind])} {queue[kind].length}
      </span>)}
      {loadingCount > 0 && <span className="text-[10px] text-[var(--text-quaternary)]">{t('learning.review_loading', { count: loadingCount })}</span>}
    </div>
    {entries.length > 0 && <div className="flex gap-2 overflow-x-auto pb-1">
      {entries.map((entry) => <ReviewQueueCard key={entry.item.note.id} entry={entry} onSelect={onSelect} />)}
    </div>}
  </section>
}

function ReviewQueueCard({ entry, onSelect }: { entry: LearningReviewItem; onSelect: (item: LearningWorkbenchItem) => void }) {
  const reason = entry.metadata.reviewDate
    ? `${t(REVIEW_DUE_LABELS[entry.due])} · ${entry.metadata.reviewDate}`
    : t(REVIEW_DUE_LABELS[entry.due])
  return <button
    type="button"
    onClick={() => onSelect(entry.item)}
    className="min-h-14 min-w-44 max-w-60 rounded-[var(--r-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-left hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
  >
    <span className="block truncate text-[11.5px] font-medium text-[var(--text-primary)]">{entry.item.note.title}</span>
    <span className="mt-1 block text-[10px] text-[var(--text-tertiary)]">{reason}</span>
  </button>
}

function parseReviewDate(content: string | undefined): string {
  if (!content) return ''
  return parseLearningReviewMetadata(content).reviewDate ?? ''
}
