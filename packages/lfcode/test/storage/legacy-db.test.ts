import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { init } from "#db"
import { mergeLegacyDatabases } from "../../src/storage/legacy-db"

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await fs.rm(dir, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 9) throw error
        await Bun.sleep(100)
      }
    }
  }
})

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-legacy-db-"))
  tempDirs.push(dir)
  return dir
}

function createSchema(dbPath: string, variant: "target" | "mimocode" | "opencode") {
  const db = init(dbPath)
  try {
    db.run(`
      create table project (
        id text primary key,
        worktree text not null,
        vcs text,
        name text,
        icon_url text,
        icon_color text,
        time_created integer not null,
        time_updated integer not null,
        time_initialized integer,
        sandboxes text not null,
        commands text
      );
    `)
    db.run(`
      create table session (
        id text primary key,
        project_id text not null,
        parent_id text,
        slug text not null,
        directory text not null,
        title text not null,
        version text not null,
        share_url text,
        summary_additions integer,
        summary_deletions integer,
        summary_files integer,
        summary_diffs text,
        revert text,
        permission text,
        interaction text,
        time_created integer not null,
        time_updated integer not null,
        time_compacting integer,
        time_archived integer,
        workspace_id text,
        context_from text,
        context_watermark text,
        last_checkpoint_message_id text
      );
    `)
    db.run(`
      create table message (
        id text primary key,
        session_id text not null,
        ${variant === "target" ? "agent_id text not null default 'main'," : ""}
        time_created integer not null,
        time_updated integer not null,
        data text not null
      );
    `)
    db.run(`
      create table part (
        id text primary key,
        message_id text not null,
        session_id text not null,
        time_created integer not null,
        time_updated integer not null,
        data text not null
      );
    `)
    db.run(`
      create table todo (
        session_id text not null,
        content text not null,
        status text not null,
        ${variant === "opencode" ? "priority text not null," : ""}
        position integer not null,
        time_created integer not null,
        time_updated integer not null,
        primary key (session_id, position)
      );
    `)
    db.run(
      variant === "opencode"
        ? `
          create table permission (
            id text primary key,
            project_id text not null,
            action text not null,
            resource text not null,
            time_created integer not null,
            time_updated integer not null
          );
        `
        : `
          create table permission (
            project_id text primary key,
            time_created integer not null,
            time_updated integer not null,
            data text not null
          );
        `,
    )
  } finally {
    ;(db.$client as { close?: () => void }).close?.()
  }
}

function seedLegacy(dbPath: string, prefix: string, withPermission: boolean) {
  const db = init(dbPath)
  try {
    db.run(`
      insert into project values (
        '${prefix}_proj',
        'C:\\\\${prefix}',
        'git',
        '${prefix} project',
        null,
        null,
        1,
        2,
        null,
        '[]',
        null
      );
    `)
    db.run(`
      insert into session values (
        '${prefix}_ses',
        '${prefix}_proj',
        null,
        '${prefix}-slug',
        'C:\\\\${prefix}',
        '${prefix} session',
        'v1',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        3,
        4,
        null,
        null,
        null,
        null,
        null,
        null
      );
    `)
    db.run(`
      insert into message (${prefix === "target" ? "id,session_id,agent_id,time_created,time_updated,data" : "id,session_id,time_created,time_updated,data"}) values (
        '${prefix}_msg',
        '${prefix}_ses',
        ${prefix === "target" ? "'assistant'," : ""}
        5,
        6,
        '{"role":"assistant"}'
      );
    `)
    db.run(`
      insert into part values (
        '${prefix}_part',
        '${prefix}_msg',
        '${prefix}_ses',
        7,
        8,
        '{"type":"text","text":"${prefix}"}'
      );
    `)
    db.run(
      prefix === "open"
        ? `
          insert into todo values (
            '${prefix}_ses',
            '${prefix} todo',
            'open',
            'medium',
            0,
            9,
            10
          );
        `
        : `
          insert into todo values (
            '${prefix}_ses',
            '${prefix} todo',
            'open',
            0,
            9,
            10
          );
        `,
    )
    if (withPermission) {
      db.run(`
        insert into permission values (
          '${prefix}_proj',
          11,
          12,
          '{"bash":"ask"}'
        );
      `)
    }
  } finally {
    ;(db.$client as { close?: () => void }).close?.()
  }
}

describe("mergeLegacyDatabases", () => {
  test("merges both legacy databases and stays idempotent", async () => {
    const dir = await tempDir()
    const targetPath = path.join(dir, "lfcode.db")
    const mimocodePath = path.join(dir, "mimocode.db")
    const opencodePath = path.join(dir, "opencode.db")

    createSchema(targetPath, "target")
    createSchema(mimocodePath, "mimocode")
    createSchema(opencodePath, "opencode")
    seedLegacy(mimocodePath, "mimo", true)
    seedLegacy(opencodePath, "open", false)

    const target = init(targetPath)
    try {
      mergeLegacyDatabases(target, targetPath, { cleanup: false })
      mergeLegacyDatabases(target, targetPath, { cleanup: false })

      const counts = (table: string) =>
        Number((target.$client as { query: (sqlText: string) => { all: () => Array<{ count: number }> } })
          .query(`select count(*) as count from ${table}`)
          .all()[0]?.count ?? 0)

      expect(counts("project")).toBe(2)
      expect(counts("session")).toBe(2)
      expect(counts("message")).toBe(2)
      expect(counts("part")).toBe(2)
      expect(counts("todo")).toBe(2)
      expect(counts("permission")).toBe(1)

      const messages = (target.$client as {
        query: (sqlText: string) => { all: () => Array<{ id: string; agent_id: string }> }
      })
        .query("select id, agent_id from message order by id")
        .all()
      expect(messages).toEqual([
        { id: "mimo_msg", agent_id: "main" },
        { id: "open_msg", agent_id: "main" },
      ])

      const permission = (target.$client as {
        query: (sqlText: string) => { all: () => Array<{ data: string }> }
      })
        .query("select data from permission")
        .all()
      expect(permission).toEqual([{ data: '{"bash":"ask"}' }])
    } finally {
      ;(target.$client as { close?: () => void }).close?.()
    }
  })

  test("merges the old xdg data root into the current lfcode database", async () => {
    const dir = await tempDir()
    const currentPath = path.join(dir, "lfcode.db")
    const legacyDir = path.join(dir, "legacy-xdg")
    const legacyPath = path.join(legacyDir, "lfcode.db")

    createSchema(currentPath, "target")
    await fs.mkdir(legacyDir, { recursive: true })
    createSchema(legacyPath, "mimocode")
    seedLegacy(legacyPath, "mimo", true)

    const target = init(currentPath)
    try {
      mergeLegacyDatabases(target, currentPath, { legacyDataDir: legacyDir })

      const count = (table: string) =>
        Number((target.$client as { query: (sqlText: string) => { all: () => Array<{ count: number }> } })
          .query(`select count(*) as count from ${table}`)
          .all()[0]?.count ?? 0)

      expect(count("project")).toBe(1)
      expect(count("session")).toBe(1)
    } finally {
      ;(target.$client as { close?: () => void }).close?.()
    }
  })

  test("does not reopen legacy sources after a completed merge", async () => {
    const dir = await tempDir()
    const currentPath = path.join(dir, "lfcode.db")
    const mimocodePath = path.join(dir, "mimocode.db")
    const opencodePath = path.join(dir, "opencode.db")

    createSchema(currentPath, "target")
    createSchema(mimocodePath, "mimocode")
    createSchema(opencodePath, "opencode")
    seedLegacy(mimocodePath, "mimo", true)
    seedLegacy(opencodePath, "open", false)

    const initial = init(currentPath)
    try {
      mergeLegacyDatabases(initial, currentPath, { cleanup: false })
    } finally {
      ;(initial.$client as { close?: () => void }).close?.()
    }

    const trimmed = init(currentPath)
    try {
      trimmed.run("delete from part where id = 'open_part'")
      trimmed.run("delete from message where id = 'open_msg'")
      trimmed.run("delete from todo where session_id = 'open_ses'")
      trimmed.run("delete from session where id = 'open_ses'")
      trimmed.run("delete from project where id = 'open_proj'")
    } finally {
      ;(trimmed.$client as { close?: () => void }).close?.()
    }

    const replayed = init(currentPath)
    try {
      mergeLegacyDatabases(replayed, currentPath, { cleanup: false })

      const counts = (table: string) =>
        Number((replayed.$client as { query: (sqlText: string) => { all: () => Array<{ count: number }> } })
          .query(`select count(*) as count from ${table}`)
          .all()[0]?.count ?? 0)

      expect(counts("project")).toBe(1)
      expect(counts("session")).toBe(1)
      expect(counts("message")).toBe(1)
      expect(counts("part")).toBe(1)
    } finally {
      ;(replayed.$client as { close?: () => void }).close?.()
    }
  })
})
