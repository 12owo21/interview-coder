import type { AssessmentRegion } from '../../shared/assessment'

/** Extension point for semantic filtering. Currently preserve every OCR region and its ID. */
export function filterAssessmentOcrRegions(regions: AssessmentRegion[]): AssessmentRegion[] {
  return regions
}
