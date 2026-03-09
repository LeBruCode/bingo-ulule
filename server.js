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

function isAdmin(req) {
  const adminKey = process.env.ADMIN_KEY
  const providedKey = req.headers["x-admin-key"]
  return Boolean(adminKey) && providedKey === adminKey
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
}

function generateCards() {
  cards = []
  eventIndex = new Map()

  if (events.length < SIZE) {
    fastify.log.warn(
      { events: events.length, required: SIZE },
      "Not enough events to generate bingo cards"
    )
    return
  }

  for (let i = 0; i < MAX_CARDS; i++) {
    const card = pickUniqueEvents(events, SIZE)
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
    return
  }

  events = data.map((e) => e.name).filter(Boolean)
  fastify.log.info({ events: events.length }, "Events loaded")

  generateCards()
  fastify.log.info({ cards: cards.length }, "Cards generated")
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
    events: events.length
  }
})

fastify.get("/api/debug", async (req, reply) => {
  if (!isAdmin(req)) {
    reply.code(403)
    return { error: "forbidden" }
  }

  return {
    events: events.length,
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
})

fastify.post("/api/trigger", async (req, reply) => {
  if (!isAdmin(req)) {
    reply.code(403)
    return { ok: false, error: "forbidden" }
  }

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

  if (triggeredSet.has(normalizedEvent)) {
    return { ok: true, duplicated: true }
  }

  triggered.push(normalizedEvent)
  triggeredSet.add(normalizedEvent)

  const affectedCards = eventIndex.get(normalizedEvent) || []
  for (const cardIndex of affectedCards) {
    checkCard(cardIndex)
  }

  io.emit("state", serializeState())
  return { ok: true }
})

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
