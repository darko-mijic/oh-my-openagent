import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"
import { isAllowedPrometheusBashCommand } from "./bash-command-policy"

const TRUSTED_SCRIPT = realpathSync.native(
  join(sharedSkillsRootPath(), "ulw-plan", "scripts", "scaffold-plan.mjs"),
)

const policyOptions = {
  trustedRealpaths: new Set([TRUSTED_SCRIPT]),
  resolveRealpath: realpathSync.native,
}

type CommandCase = {
  readonly name: string
  readonly command: string
}

describe("isAllowedPrometheusBashCommand", () => {
  let temporaryDirectory: string
  let trustedSymlink: string
  let outsideSymlink: string
  let maliciousPlant: string

  beforeAll(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "prometheus-bash-policy-"))
    const trustedLinkDirectory = join(temporaryDirectory, "trusted-link")
    const outsideDirectory = join(temporaryDirectory, "outside", "ulw-plan", "scripts")
    const plantedDirectory = join(temporaryDirectory, "plant", "ulw-plan", "scripts")
    mkdirSync(trustedLinkDirectory, { recursive: true })
    mkdirSync(outsideDirectory, { recursive: true })
    mkdirSync(plantedDirectory, { recursive: true })

    trustedSymlink = join(trustedLinkDirectory, "scaffold-plan.mjs")
    outsideSymlink = join(temporaryDirectory, "outside-link", "scaffold-plan.mjs")
    maliciousPlant = join(plantedDirectory, "scaffold-plan.mjs")
    const outsideScript = join(outsideDirectory, "scaffold-plan.mjs")
    mkdirSync(join(temporaryDirectory, "outside-link"), { recursive: true })
    writeFileSync(outsideScript, "// outside\n")
    writeFileSync(maliciousPlant, "// planted\n")
    symlinkSync(TRUSTED_SCRIPT, trustedSymlink, "file")
    symlinkSync(outsideScript, outsideSymlink, "file")
  })

  afterAll(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  describe("#given trusted scaffold commands", () => {
    test("#when node receives a quoted trusted path and valid flag #then allows", () => {
      // given
      const command = `node "${TRUSTED_SCRIPT}" my-slug --draft-only`

      // when
      const allowed = isAllowedPrometheusBashCommand(command, policyOptions)

      // then
      expect(allowed).toBe(true)
    })

    test("#when bun receives a trusted path and clear flag #then allows", () => {
      // given
      const command = `bun ${TRUSTED_SCRIPT} slug --clear`

      // when
      const allowed = isAllowedPrometheusBashCommand(command, policyOptions)

      // then
      expect(allowed).toBe(true)
    })

    test("#when node receives only a trusted path and slug #then allows", () => {
      // given
      const command = `node "${TRUSTED_SCRIPT}" my-slug`

      // when
      const allowed = isAllowedPrometheusBashCommand(command, policyOptions)

      // then
      expect(allowed).toBe(true)
    })

    test("#when script symlink resolves to trusted realpath #then allows", () => {
      // given
      const command = `node "${trustedSymlink}" linked-slug --review-required`

      // when
      const allowed = isAllowedPrometheusBashCommand(command, policyOptions)

      // then
      expect(allowed).toBe(true)
    })

    test("#when all remaining scaffold flags follow one valid slug #then allows", () => {
      // given
      const command = `node "${TRUSTED_SCRIPT}" slug --unclear --reset --force`

      // when
      const allowed = isAllowedPrometheusBashCommand(command, policyOptions)

      // then
      expect(allowed).toBe(true)
    })

    for (const runtime of ["NODE.EXE", "bun.exe"] as const) {
      test(`#when ${runtime} receives a trusted path and slug #then allows`, () => {
        // given
        const command = `${runtime} "${TRUSTED_SCRIPT}" windows-slug`

        // when
        const allowed = isAllowedPrometheusBashCommand(command, policyOptions)

        // then
        expect(allowed).toBe(true)
      })
    }
  })

  describe("#given untrusted or malformed commands", () => {
    const deniedCommands = (): readonly CommandCase[] => [
      { name: "absolute node runtime", command: `/usr/bin/node ${TRUSTED_SCRIPT} slug` },
      { name: "temporary node runtime", command: `/tmp/node ${TRUSTED_SCRIPT} slug` },
      { name: "relative node runtime", command: `./node ${TRUSTED_SCRIPT} slug` },
      { name: "relative bun runtime", command: `./bun ${TRUSTED_SCRIPT} slug` },
      {
        name: "quoted Windows runtime",
        command: `"C:\\Tools\\node.exe" "${TRUSTED_SCRIPT}" slug`,
      },
      { name: "env runtime wrapper", command: `/usr/bin/env node ${TRUSTED_SCRIPT} slug` },
      {
        name: "node eval before script",
        command: `node -e "require('fs').writeFileSync('/tmp/prom-deny-marker','EXECUTED')" ${TRUSTED_SCRIPT}`,
      },
      { name: "evil script before trusted path", command: `node /tmp/evil.js ${TRUSTED_SCRIPT}` },
      { name: "temporary scaffold filename", command: "node /tmp/scaffold-plan.mjs slug" },
      { name: "malicious suffix plant", command: `node "${maliciousPlant}" slug` },
      {
        name: "quote concatenation",
        command: `node "${TRUSTED_SCRIPT}"/../../../../tmp/evil.mjs slug`,
      },
      { name: "backslash quote concatenation", command: `node "${TRUSTED_SCRIPT}"\\ slug` },
      { name: "unbalanced quote", command: `node "${TRUSTED_SCRIPT} slug` },
      { name: "symlink resolving outside trust", command: `node "${outsideSymlink}" slug` },
      { name: "relative scaffold path", command: "node path/to/scaffold-plan.mjs slug" },
      { name: "bare scaffold path", command: "node scaffold-plan.mjs slug" },
      { name: "output redirect", command: `node ${TRUSTED_SCRIPT} slug > /tmp/out` },
      { name: "input redirect", command: `node ${TRUSTED_SCRIPT} slug < /etc/passwd` },
      { name: "background command", command: `node ${TRUSTED_SCRIPT} slug & true` },
      { name: "semicolon chain", command: `node ${TRUSTED_SCRIPT}; rm -rf /` },
      { name: "pipe chain", command: `node ${TRUSTED_SCRIPT} | cat` },
      { name: "and chain", command: `node ${TRUSTED_SCRIPT} slug && true` },
      { name: "or chain", command: `node ${TRUSTED_SCRIPT} slug || true` },
      { name: "backtick substitution", command: `node ${TRUSTED_SCRIPT} slug \`id\`` },
      { name: "command substitution", command: `node ${TRUSTED_SCRIPT} $(rm -rf /)` },
      { name: "newline injection", command: `node ${TRUSTED_SCRIPT} slug\nrm -rf /` },
      { name: "carriage return injection", command: `node ${TRUSTED_SCRIPT} slug\rrm -rf /` },
      { name: "node import flag", command: `node --import ./x.mjs ${TRUSTED_SCRIPT} slug` },
      { name: "bun run", command: `bun run ${TRUSTED_SCRIPT} slug` },
      { name: "dollar variable slug", command: `node ${TRUSTED_SCRIPT} $HOME` },
      { name: "braced dollar variable", command: `node ${TRUSTED_SCRIPT} \${HOME}/x` },
      { name: "dollar script token", command: `node $SCRIPT ${TRUSTED_SCRIPT}` },
      { name: "ANSI-C dollar quote", command: `node ${TRUSTED_SCRIPT} $'evil'` },
      { name: "positional dollar variable", command: `node ${TRUSTED_SCRIPT} $1` },
      { name: "argument-list dollar variable", command: `node ${TRUSTED_SCRIPT} $@` },
      { name: "process-id dollar variable", command: `node ${TRUSTED_SCRIPT} $$` },
      { name: "unknown flag", command: `node ${TRUSTED_SCRIPT} slug --evil-flag` },
      { name: "invalid slug", command: `node ${TRUSTED_SCRIPT} Bad_Slug` },
      { name: "extra argument", command: `node ${TRUSTED_SCRIPT} slug extra-arg` },
      { name: "script alone", command: "scaffold-plan.mjs" },
      { name: "echo command", command: "echo hi" },
      { name: "rm command", command: "rm -rf /" },
      { name: "empty command", command: "   " },
    ]

    for (const commandCase of deniedCommands()) {
      test(`#when checking ${commandCase.name} #then denies`, () => {
        // given
        const { command } = commandCase

        // when
        const allowed = isAllowedPrometheusBashCommand(command, policyOptions)

        // then
        expect(allowed).toBe(false)
      })
    }
  })

  test("#given malicious cwd lookalike #when using auto-discovered trust #then denies planted script", () => {
    // given
    const originalDirectory = process.cwd()
    const maliciousRepository = join(temporaryDirectory, "malicious-repository")
    const plantedScript = join(
      maliciousRepository,
      "packages",
      "shared-skills",
      "skills",
      "ulw-plan",
      "scripts",
      "scaffold-plan.mjs",
    )
    mkdirSync(dirname(plantedScript), { recursive: true })
    writeFileSync(plantedScript, "// cwd plant\n")
    process.chdir(maliciousRepository)
    try {
      // when
      const allowed = isAllowedPrometheusBashCommand(`node "${plantedScript}" slug`)

      // then
      expect(allowed).toBe(false)
    } finally {
      process.chdir(originalDirectory)
    }
  })
})
