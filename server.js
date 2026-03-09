import Fastify from "fastify"
import { Server } from "socket.io"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import fastifyStatic from "@fastify/static"
import path from "path"
import { fileURLToPath } from "url"
import { v4 as uuidv4 } from "uuid"

dotenv.config()

const fastify = Fastify({ logger: true })
const io = new Server(fastify.server, { cors: { origin: "*" } })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseUrl || !supabaseKey) {
  fastify.log.error("SUPABASE_URL or SUPABASE_KEY is missing")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROWS = 4
const COLS = 5
const SIZE = ROWS * COLS
const MAX_CARDS = Number(process.env.MAX_CARDS || 5000)

let events = []
let eventNames = []
let cards = []
let eventIndex = new Map()
let players = new Map()
let playersByCard = new Map()
let triggered = []
let triggeredSet = new Set()
let winners = {
  one: new Set(),
  two: new Set(),
  three: new Set(),
  full: new Set()
}
let gameVersion = 1

function isAdmin(req) {
  const adminKey = process.env.ADMIN_KEY
  const providedKey = req.headers["x-admin-key"]
  return Boolean(adminKey) && providedKey === adminKey
}

function normalizeCategory(value) {
  if (typeof value !== "string") return "general"
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 40)
  return normalized || "general"
}

async function requireAdmin(req, reply) {
  if (!isAdmin(req)) {
    reply.code(403).send({ error: "forbidden" })
    return reply
  }
}

function serializeWinners() {
  return {
    one: [...winners.one],
    two: [...winners.two],
    three: [...winners.three],
    full: [...winners.full]
  }
}

function serializeState() {
  return {
    gameVersion,
    triggered,
    winners: serializeWinners()
  }
}

function pickUniqueEvents(source, size) {
  const pool = [...source]

  // Fisher-Yates partial shuffle to avoid sorting random arrays repeatedly.
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i))
    const tmp = pool[i]
    pool[i] = pool[j]
    pool[j] = tmp
  }

  return pool.slice(0, size)
}

function resetGameState() {
  players = new Map()
  playersByCard = new Map()
  triggered = []
  triggeredSet = new Set()
  winners = {
    one: new Set(),
    two: new Set(),
    three: new Set(),
    full: new Set()
  }
  gameVersion += 1
}

function clearRoundProgress() {
  triggered = []
  triggeredSet = new Set()
  winners = {
    one: new Set(),
    two: new Set(),
    three: new Set(),
    full: new Set()
  }
}

function generateCards() {
  cards = []
  eventIndex = new Map()

  if (eventNames.length < SIZE) {
    fastify.log.warn(
      { events: eventNames.length, required: SIZE },
      "Not enough events to generate bingo cards"
    )
    return
  }

  for (let i = 0; i < MAX_CARDS; i++) {
    const card = pickUniqueEvents(eventNames, SIZE)
    cards.push(card)

    for (const eventName of card) {
      if (!eventIndex.has(eventName)) {
        eventIndex.set(eventName, [])
      }
      eventIndex.get(eventName).push(i)
    }
  }

  resetGameState()
}

function countLines(card) {
  let lines = 0

  for (let r = 0; r < ROWS; r++) {
    const rowStart = r * COLS
    let fullRow = true

    for (let c = 0; c < COLS; c++) {
      if (!triggeredSet.has(card[rowStart + c])) {
        fullRow = false
        break
      }
    }

    if (fullRow) lines++
  }

  return lines
}

function checkCard(cardIndex) {
  const card = cards[cardIndex]
  if (!card) return

  const lines = countLines(card)
  const cardTokens = playersByCard.get(cardIndex)
  if (!cardTokens || cardTokens.size === 0) return

  for (const token of cardTokens) {
    if (lines >= 1) winners.one.add(token)
    if (lines >= 2) winners.two.add(token)
    if (lines >= 3) winners.three.add(token)
    if (lines >= 4) winners.full.add(token)
  }
}

function recomputeWinners() {
  winners = {
    one: new Set(),
    two: new Set(),
    three: new Set(),
    full: new Set()
  }

  for (const cardIndex of playersByCard.keys()) {
    checkCard(cardIndex)
  }
}

function setEventTriggered(eventName, active) {
  if (active) {
    if (triggeredSet.has(eventName)) return false
    triggeredSet.add(eventName)
    triggered.push(eventName)
    return true
  }

  if (!triggeredSet.has(eventName)) return false
  triggeredSet.delete(eventName)
  triggered = triggered.filter((name) => name !== eventName)
  recomputeWinners()
  return true
}

function attachPlayerToCard(token, cardIndex) {
  if (!playersByCard.has(cardIndex)) {
    playersByCard.set(cardIndex, new Set())
  }
  playersByCard.get(cardIndex).add(token)
}

function ensurePlayer(token) {
  if (players.has(token)) return players.get(token)

  const cardIndex = Math.floor(Math.random() * cards.length)
  const player = { cardIndex }
  players.set(token, player)
  attachPlayerToCard(token, cardIndex)
  return player
}

async function loadEvents() {
  const { data, error } = await supabase.from("events").select("*").order("id")

  if (error) {
    fastify.log.error({ error }, "Error loading events")
    return false
  }

  events = data
    .map((e) => ({
      id: e.id,
      name: typeof e.name === "string" ? e.name.trim() : "",
      category: normalizeCategory(e.category),
      created_at: e.created_at
    }))
    .filter((e) => e.name)

  eventNames = events.map((e) => e.name)
  fastify.log.info({ events: eventNames.length }, "Events loaded")

  generateCards()
  fastify.log.info({ cards: cards.length }, "Cards generated")
  return true
}

io.on("connection", (socket) => {
  let token = socket.handshake.auth?.token
  if (!token) token = uuidv4()

  if (cards.length === 0) {
    socket.emit("error", "no_cards_generated")
    return
  }

  const player = ensurePlayer(token)

  socket.emit("token", token)
  socket.emit("card", cards[player.cardIndex])
  socket.emit("state", serializeState())
})

fastify.get("/api/health", async () => {
  return {
    status: "ok",
    players: players.size,
    cards: cards.length,
    events: eventNames.length
  }
})

function getDebugState() {
  return {
    gameVersion,
    rows: ROWS,
    cols: COLS,
    maxCards: MAX_CARDS,
    events: eventNames.length,
    cards: cards.length,
    players: players.size,
    triggered: triggered.length,
    winners: {
      one: winners.one.size,
      two: winners.two.size,
      three: winners.three.size,
      full: winners.full.size
    }
  }
}

fastify.get("/api/admin/debug", { preHandler: requireAdmin }, async () => {
  return getDebugState()
})

fastify.get("/api/admin/events", { preHandler: requireAdmin }, async () => {
  const byCategory = {}
  for (const event of events) {
    byCategory[event.category] = (byCategory[event.category] || 0) + 1
  }

  return {
    total: events.length,
    triggered: triggered.length,
    byCategory,
    events: events.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      created_at: row.created_at,
      triggered: triggeredSet.has(row.name)
    }))
  }
})

fastify.post("/api/admin/reload", { preHandler: requireAdmin }, async () => {
  const ok = await loadEvents()
  if (!ok) {
    return {
      ok: false,
      error: "reload_failed"
    }
  }
  return {
    ok: true,
    debug: getDebugState()
  }
})

fastify.post("/api/admin/reset-round", { preHandler: requireAdmin }, async () => {
  clearRoundProgress()
  io.emit("state", serializeState())
  return { ok: true }
})

fastify.post("/api/admin/events", { preHandler: requireAdmin }, async (req, reply) => {
  const name = req.body?.name
  const category = normalizeCategory(req.body?.category)
  if (typeof name !== "string") {
    reply.code(400)
    return { ok: false, error: "invalid_name" }
  }

  const normalizedName = name.trim()
  if (!normalizedName || normalizedName.length > 120) {
    reply.code(400)
    return { ok: false, error: "invalid_name" }
  }

  if (events.some((e) => e.name.toLowerCase() === normalizedName.toLowerCase())) {
    reply.code(409)
    return { ok: false, error: "duplicate_name" }
  }

  const { error } = await supabase
    .from("events")
    .insert([{ name: normalizedName, category }])
  if (error) {
    fastify.log.error({ error }, "Error creating event")
    reply.code(500)
    return { ok: false, error: "create_failed" }
  }

  const ok = await loadEvents()
  if (!ok) {
    reply.code(500)
    return { ok: false, error: "reload_failed" }
  }

  io.emit("state", serializeState())
  return { ok: true, gameReset: true }
})

fastify.patch("/api/admin/events/:id", { preHandler: requireAdmin }, async (req, reply) => {
  const id = Number(req.params?.id)
  if (!Number.isInteger(id) || id <= 0) {
    reply.code(400)
    return { ok: false, error: "invalid_id" }
  }

  const updates = {}

  if (typeof req.body?.name === "string") {
    const normalizedName = req.body.name.trim()
    if (!normalizedName || normalizedName.length > 120) {
      reply.code(400)
      return { ok: false, error: "invalid_name" }
    }

    if (events.some((e) => e.id !== id && e.name.toLowerCase() === normalizedName.toLowerCase())) {
      reply.code(409)
      return { ok: false, error: "duplicate_name" }
    }

    updates.name = normalizedName
  }

  if (typeof req.body?.category === "string") {
    updates.category = normalizeCategory(req.body.category)
  }

  if (Object.keys(updates).length === 0) {
    reply.code(400)
    return { ok: false, error: "no_update" }
  }

  const { data, error } = await supabase
    .from("events")
    .update(updates)
    .eq("id", id)
    .select("id")

  if (error) {
    fastify.log.error({ error }, "Error updating event")
    reply.code(500)
    return { ok: false, error: "update_failed" }
  }

  if (!data || data.length === 0) {
    reply.code(404)
    return { ok: false, error: "not_found" }
  }

  const ok = await loadEvents()
  if (!ok) {
    reply.code(500)
    return { ok: false, error: "reload_failed" }
  }

  io.emit("state", serializeState())
  return { ok: true, gameReset: true }
})

async function handleTrigger(req, reply) {

  const event = req.body?.event
  if (typeof event !== "string") {
    reply.code(400)
    return { ok: false, error: "invalid_event" }
  }

  const normalizedEvent = event.trim()
  if (!normalizedEvent || !eventIndex.has(normalizedEvent)) {
    reply.code(400)
    return { ok: false, error: "unknown_event" }
  }

  const changed = setEventTriggered(normalizedEvent, true)
  if (!changed) {
    return { ok: true, duplicated: true }
  }

  const affectedCards = eventIndex.get(normalizedEvent) || []
  for (const cardIndex of affectedCards) {
    checkCard(cardIndex)
  }

  io.emit("state", serializeState())
  return { ok: true }
}

fastify.post("/api/admin/trigger", { preHandler: requireAdmin }, handleTrigger)

fastify.post("/api/admin/events/:id/toggle", { preHandler: requireAdmin }, async (req, reply) => {
  const id = Number(req.params?.id)
  if (!Number.isInteger(id) || id <= 0) {
    reply.code(400)
    return { ok: false, error: "invalid_id" }
  }

  if (typeof req.body?.active !== "boolean") {
    reply.code(400)
    return { ok: false, error: "invalid_active" }
  }

  const eventRow = events.find((event) => event.id === id)
  if (!eventRow) {
    reply.code(404)
    return { ok: false, error: "not_found" }
  }

  const changed = setEventTriggered(eventRow.name, req.body.active)
  if (!changed) {
    return { ok: true, unchanged: true }
  }

  if (req.body.active) {
    const affectedCards = eventIndex.get(eventRow.name) || []
    for (const cardIndex of affectedCards) {
      checkCard(cardIndex)
    }
  }

  io.emit("state", serializeState())
  return { ok: true, state: serializeState() }
})

// Backward compatibility for existing frontend.
fastify.get("/api/debug", { preHandler: requireAdmin }, async () => getDebugState())
fastify.post("/api/trigger", { preHandler: requireAdmin }, handleTrigger)

fastify.register(fastifyStatic, {
  root: path.join(__dirname, "dist"),
  prefix: "/",
  wildcard: false
})

fastify.get("/*", (req, reply) => {
  reply.sendFile("index.html")
})

const start = async () => {
  try {
    await loadEvents()

    const port = Number(process.env.PORT || 3000)
    await fastify.listen({ port, host: "0.0.0.0" })
    fastify.log.info({ port }, "Server listening")
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
