import type { TrackedTopLevelTaskRef } from "./types"

const TASK_SECTION_HEADER_PATTERN = /^##\s*1\.\s*TASK\s*$/i
const TODO_TASK_LINE_PATTERN = /^(?:.*?[-*]\s*\[\s*\]\s*)?(\d+)\.\s+(.+?)[`'"]?$/
const FINAL_WAVE_TASK_LINE_PATTERN = /^(?:.*?[-*]\s*\[\s*\]\s*)?(F\d+)\.\s+(.+?)[`'"]?$/i

export function parseTrackedTaskFromPrompt(prompt: string): TrackedTopLevelTaskRef | null {
  const lines = prompt.split(/\r?\n/)
  const taskHeaderIndex = lines.findIndex((line) => TASK_SECTION_HEADER_PATTERN.test(line.trim()))
  if (taskHeaderIndex < 0) {
    return null
  }

  const startIndex = taskHeaderIndex + 1
  const endIndex = Math.min(lines.length, startIndex + 5)
  for (let index = startIndex; index < endIndex; index += 1) {
    const candidate = lines[index]?.trim()
    if (!candidate) {
      continue
    }

    const finalWaveMatch = candidate.match(FINAL_WAVE_TASK_LINE_PATTERN)
    if (finalWaveMatch?.[1] && finalWaveMatch[2]) {
      const label = finalWaveMatch[1].toUpperCase()
      return {
        key: `final-wave:${label.toLowerCase()}`,
        label,
        title: finalWaveMatch[2].trim(),
      }
    }

    const todoMatch = candidate.match(TODO_TASK_LINE_PATTERN)
    if (todoMatch?.[1] && todoMatch[2]) {
      const label = todoMatch[1]
      return {
        key: `todo:${label}`,
        label,
        title: todoMatch[2].trim(),
      }
    }
  }

  return null
}
