import { existsSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"

export function getTrustedScaffoldRealpaths(): ReadonlySet<string> {
  const scaffoldPath = join(
    sharedSkillsRootPath(),
    "ulw-plan",
    "scripts",
    "scaffold-plan.mjs",
  )
  if (!existsSync(scaffoldPath)) {
    return new Set()
  }

  try {
    return new Set([realpathSync.native(scaffoldPath)])
  } catch (error) {
    if (error instanceof Error) {
      return new Set()
    }
    throw error
  }
}
