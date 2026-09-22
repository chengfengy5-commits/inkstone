import { AlertTriangle, BookOpenCheck, Brain, CircleDot, FlaskConical, RefreshCw } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Empty } from '../../components/feedback'
import { Modal } from '../../components/overlay'
import { t, useLocale, type MessageKey } from '../../lib/i18n'
import { useNotes } from '../../store/notes'
import { useUi } from '../../store/ui'
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

export function LearningWorkbenchPanel({ onClose }: { onClose: () => void }) {
  const locale = useLocale()
  const notes = useNotes((state) => state.notes)
  const openNote = useNotes((state) => state.openNote)
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set())
  const model = useMemo(() => buildLearningWorkbench(Object.values(notes)), [notes])
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }), [locale])

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
      state.editContent(item.note.id, replaceLearningStatus(content, lane))
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
        <span className="ml-auto text-[11px] text-[var(--text-quaternary)]">{t('learning.read_only_hint')}</span>
      </div>

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
                </div>
              </article>)}
            </div>
          </section>
        })}
      </div>
    </>}
  </Modal>
}
