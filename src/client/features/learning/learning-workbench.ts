import type { NoteSummary } from '@shared/types'

export const LEARNING_STATUS_PREFIX = `${String.fromCodePoint(0x5b66, 0x4e60, 0x72b6, 0x6001)}/`

export const LEARNING_LANES = [
  'practice',
  'learning',
  'review',
  'mastered',
  'attention',
] as const

export type LearningLane = typeof LEARNING_LANES[number]

export interface LearningWorkbenchItem {
  note: NoteSummary
  lane: LearningLane
  statusTags: string[]
  needsAttention: boolean
}

export interface LearningWorkbenchModel {
  total: number
  lanes: Record<LearningLane, LearningWorkbenchItem[]>
}

export const LEARNING_STATUS_TAGS = {
  practice: String.fromCodePoint(0x5f85, 0x5b9e, 0x8df5),
  learning: String.fromCodePoint(0x5b66, 0x4e60, 0x4e2d),
  review: String.fromCodePoint(0x5f85, 0x590d, 0x4e60),
  mastered: String.fromCodePoint(0x5df2, 0x638c, 0x63e1),
} as const

const LANE_BY_STATUS = new Map<string, LearningLane>(Object.entries(LEARNING_STATUS_TAGS).map(([lane, status]) => [status, lane as LearningLane]))

export function buildLearningWorkbench(notes: Iterable<NoteSummary>): LearningWorkbenchModel {
  const lanes: Record<LearningLane, LearningWorkbenchItem[]> = {
    practice: [],
    learning: [],
    review: [],
    mastered: [],
    attention: [],
  }

  for (const note of notes) {
    const item = classifyLearningNote(note)
    if (item) lanes[item.lane].push(item)
  }

  for (const lane of LEARNING_LANES) lanes[lane].sort(compareLearningItems)

  return {
    total: LEARNING_LANES.reduce((total, lane) => total + lanes[lane].length, 0),
    lanes,
  }
}

export function classifyLearningNote(note: NoteSummary): LearningWorkbenchItem | null {
  if (note.deletedAt !== null || note.isArchived) return null

  const statusTags = [...new Set(note.tags
    .filter((tag) => tag.startsWith(LEARNING_STATUS_PREFIX))
    .map((tag) => tag.slice(LEARNING_STATUS_PREFIX.length).trim())
    .filter(Boolean))]

  if (statusTags.length === 0) return null

  const supported = statusTags.map((status) => LANE_BY_STATUS.get(status)).filter((lane): lane is LearningLane => Boolean(lane))
  const needsAttention = supported.length !== 1 || supported.length !== statusTags.length
  const lane = needsAttention ? 'attention' : supported[0]!

  return { note, lane, statusTags, needsAttention }
}

function compareLearningItems(left: LearningWorkbenchItem, right: LearningWorkbenchItem): number {
  return right.note.updatedAt - left.note.updatedAt
    || left.note.title.localeCompare(right.note.title, 'zh-CN')
    || left.note.id.localeCompare(right.note.id)
}
