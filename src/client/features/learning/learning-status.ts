import { extractTags, replaceTagInContent } from '@shared/markdown-utils'
import { LEARNING_STATUS_PREFIX, LEARNING_STATUS_TAGS, type LearningLane } from './learning-workbench'

export type SupportedLearningLane = Exclude<LearningLane, 'attention'>

export function replaceLearningStatus(content: string, lane: SupportedLearningLane): string {
  const nextTag = `${LEARNING_STATUS_PREFIX}${LEARNING_STATUS_TAGS[lane]}`
  const currentTags = extractTags(content).filter((tag) => tag.startsWith(LEARNING_STATUS_PREFIX))
  if (currentTags.length === 1 && currentTags[0] === nextTag) return content

  let rewritten = content
  if (currentTags.includes(nextTag)) {
    for (const tag of currentTags) {
      if (tag !== nextTag) rewritten = replaceTagInContent(rewritten, tag, null)
    }
    return rewritten
  }

  const [first, ...rest] = currentTags
  if (first) {
    rewritten = replaceTagInContent(rewritten, first, nextTag)
    for (const tag of rest) rewritten = replaceTagInContent(rewritten, tag, null)
    return rewritten
  }

  const separator = rewritten.length === 0 ? '' : rewritten.endsWith('\n') ? '\n' : '\n\n'
  return `${rewritten}${separator}#${nextTag}`
}
