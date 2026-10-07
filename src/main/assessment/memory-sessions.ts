import type { AssessmentMemoryService } from './memory-service'
import type { AssessmentScoreMemoryService } from './score-memory-service'

/** Apply effective memory mode consistently on settings sync and before each request. */
export function configureAssessmentSessions(
  memory: AssessmentMemoryService,
  scores: AssessmentScoreMemoryService,
  config: { mostLeastEnabled?: boolean; memoryEnabled: boolean; personality: string }
): void {
  if (scores.configure(!!config.mostLeastEnabled, config.personality)) memory.reset()
  memory.configure(!config.mostLeastEnabled && config.memoryEnabled, config.personality)
}
