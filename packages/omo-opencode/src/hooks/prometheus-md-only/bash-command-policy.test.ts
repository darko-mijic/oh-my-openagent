import { describe, expect, test } from "bun:test"
import { isAllowedPrometheusBashCommand } from "./bash-command-policy"

describe("isAllowedPrometheusBashCommand", () => {
  test("#given node scaffold path with args #when checking #then allows", () => {
    // given
    const command = "node path/to/scaffold-plan.mjs foo --draft-only"

    // when
    const allowed = isAllowedPrometheusBashCommand(command)

    // then
    expect(allowed).toBe(true)
  })

  test("#given bun absolute scaffold path with clear flag #when checking #then allows", () => {
    // given
    const command = "bun /x/scaffold-plan.mjs slug --clear"

    // when
    const allowed = isAllowedPrometheusBashCommand(command)

    // then
    expect(allowed).toBe(true)
  })

  test("#given quoted windows-style scaffold path #when checking #then allows", () => {
    // given
    const command = `node "C:\\skills\\ulw-plan\\scripts\\scaffold-plan.mjs" my-slug --draft-only`

    // when
    const allowed = isAllowedPrometheusBashCommand(command)

    // then
    expect(allowed).toBe(true)
  })

  test("#given empty command #when checking #then denies", () => {
    // given
    const command = "   "

    // when
    const allowed = isAllowedPrometheusBashCommand(command)

    // then
    expect(allowed).toBe(false)
  })

  test("#given unrelated echo #when checking #then denies", () => {
    // given
    const command = "echo hi"

    // when
    const allowed = isAllowedPrometheusBashCommand(command)

    // then
    expect(allowed).toBe(false)
  })

  test("#given destructive rm #when checking #then denies", () => {
    // given
    const command = "rm -rf /"

    // when
    const allowed = isAllowedPrometheusBashCommand(command)

    // then
    expect(allowed).toBe(false)
  })

  test("#given scaffold chained with rm via semicolon #when checking #then denies", () => {
    // given
    const command = "node scaffold-plan.mjs; rm -rf /"

    // when
    const allowed = isAllowedPrometheusBashCommand(command)

    // then
    expect(allowed).toBe(false)
  })

  test("#given scaffold with command substitution #when checking #then denies", () => {
    // given
    const command = "node scaffold-plan.mjs $(rm -rf /)"

    // when
    const allowed = isAllowedPrometheusBashCommand(command)

    // then
    expect(allowed).toBe(false)
  })

  test("#given scaffold with pipe #when checking #then denies", () => {
    // given
    const command = "node scaffold-plan.mjs | cat"

    // when
    const allowed = isAllowedPrometheusBashCommand(command)

    // then
    expect(allowed).toBe(false)
  })

  test("#given scaffold with newline injection #when checking #then denies", () => {
    // given
    const command = "node scaffold-plan.mjs foo\nrm -rf /"

    // when
    const allowed = isAllowedPrometheusBashCommand(command)

    // then
    expect(allowed).toBe(false)
  })
})
