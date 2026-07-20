import { parseFinalWaveRoles } from "../atlas/final-wave-role-parser"

export function getFinalWaveMarkerDiagnostics(content: string): readonly string[] {
  const result = parseFinalWaveRoles(content)
  return typeof result.status === "string" ? [] : result.status.invalid
}

export function buildFinalWaveMarkerWarning(diagnostics: readonly string[]): string {
  return [
    "",
    "Final Verification Wave role-marker diagnostics (advisory only):",
    ...diagnostics.map((diagnostic) => `- ${diagnostic}`),
    "Fix the marker before enforcing reviewer-role authentication.",
  ].join("\n")
}
