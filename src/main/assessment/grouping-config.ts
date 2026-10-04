export const GROUPING = {
  // OCR boxes enclose glyphs, not CSS line-height. Real 32px lines at 150% DPI
  // produced 27px glyph boxes and 21px gaps; 0.6 incorrectly split continuations.
  continuationGap: 0.9,
  continuationIndent: 1.5,
  verticalOverlap: 0.3,
  horizontalOverlap: 0.6,
  rowCenterTolerance: 0.5
} as const
