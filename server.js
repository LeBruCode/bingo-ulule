import Fastify from "fastify"
import { Server } from "socket.io"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import fastifyStatic from "@fastify/static"
import path from "path"
import { fileURLToPath } from "url"
import { v4 as uuidv4 } from "uuid"
import crypto from "crypto"

dotenv.config()

const fastify = Fastify({ logger: true })
const io = new Server(fastify.server, {
  cors: { origin: "*" },
  transports: ["websocket"],
  allowUpgrades: false
})

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseUrl || !supabaseKey) {
  fastify.log.error("SUPABASE_URL or SUPABASE_KEY is missing")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function parseBoardNumber(input, fallback) {
  const value = Number(input)
  if (!Number.isInteger(value) || value < 2 || value > 8) return fallback
  return value
}

let ROWS = parseBoardNumber(process.env.BINGO_ROWS, 4)
let COLS = parseBoardNumber(process.env.BINGO_COLS, 5)
const MAX_CARDS = Number(process.env.MAX_CARDS || 5000)

let events = []
let eventNames = []
let cards = []
let eventIndex = new Map()
let cardRowHits = []
let cardLineCounts = []
let players = new Map()
let playersByCard = new Map()
let triggered = []
let triggeredSet = new Set()
let winners = Array.from({ length: ROWS }, () => new Set())
let rewardedTokens = new Set()
let currentTargetTier = 1
let raffleEntriesByTier = Array.from({ length: ROWS }, () => new Map())
let raffleWinnerByTier = Array.from({ length: ROWS }, () => null)
let raffleWonEmails = new Set()
let raffleEntrySeq = 1
let activationSequence = 0
let activationLog = []
let activationCountByEvent = new Map()
let gameVersion = 1
let isBootstrapped = false
let bootstrapError = null
let bootstrapPromise = null
const MAX_ACTIVATION_LOG = Number(process.env.MAX_ACTIVATION_LOG || 5000)
const ADMIN_SESSION_COOKIE = "bingo_admin_session"
const ADMIN_SESSION_TTL_SECONDS = Number(process.env.ADMIN_SESSION_TTL_SECONDS || 60 * 60 * 12)
const adminSessions = new Map()
const ULULE_API_BASE = process.env.ULULE_API_BASE || "https://api.ulule.com/v1"
const ULULE_API_KEY = process.env.ULULE_API_KEY || ""
const ULULE_PROJECT_ID = process.env.ULULE_PROJECT_ID || ""
const ULULE_MIN_CONTRIBUTION_CENTS = Number(process.env.ULULE_MIN_CONTRIBUTION_CENTS || 1000)
const ULULE_EMAIL_CACHE_TTL_MS = Number(process.env.ULULE_EMAIL_CACHE_TTL_MS || 5 * 60 * 1000)
const ululeEligibilityCache = new Map()
let progressStatsCache = null
let progressStatsDirty = true

function boardSize() {
  return ROWS * COLS
}

function createWinnerTiers() {
  return Array.from({ length: ROWS }, () => new Set())
}

function createRaffleStore() {
  return {
    entriesByTier: Array.from({ length: ROWS }, () => new Map()),
    winnerByTier: Array.from({ length: ROWS }, () => null)
  }
}

function initCardProgress() {
  cardRowHits = Array.from({ length: cards.length }, () => Array(ROWS).fill(0))
  cardLineCounts = Array(cards.length).fill(0)
}

function serializeBoardConfig() {
  return {
    rows: ROWS,
    cols: COLS,
    size: boardSize(),
    maxCards: MAX_CARDS
  }
}

function isAdmin(req) {
  return hasValidAdminSession(req)
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {}
  const out = {}
  for (const rawPart of cookieHeader.split(";")) {
    const part = rawPart.trim()
    if (!part) continue
    const eqIndex = part.indexOf("=")
    if (eqIndex <= 0) continue
    const key = part.slice(0, eqIndex).trim()
    const value = part.slice(eqIndex + 1).trim()
    out[key] = decodeURIComponent(value)
  }
  return out
}

function getAdminSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie)
  return cookies[ADMIN_SESSION_COOKIE] || ""
}

function cleanupExpiredAdminSessions() {
  const now = Date.now()
  for (const [token, expiresAt] of adminSessions.entries()) {
    if (expiresAt <= now) adminSessions.delete(token)
  }
}

function hasValidAdminSession(req) {
  cleanupExpiredAdminSessions()
  const token = getAdminSessionToken(req)
  if (!token) return false
  const expiresAt = adminSessions.get(token)
  if (!expiresAt || expiresAt <= Date.now()) {
    adminSessions.delete(token)
    return false
  }
  return true
}

function createAdminSessionToken() {
  const token = crypto.randomBytes(32).toString("hex")
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000
  adminSessions.set(token, expiresAt)
  return token
}

function clearAdminSession(req) {
  const token = getAdminSessionToken(req)
  if (token) adminSessions.delete(token)
}

function shouldUseSecureCookie(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase()
  if (forwardedProto.includes("https")) return true
  const host = String(req.headers.host || "")
  return !host.startsWith("localhost") && !host.startsWith("127.0.0.1")
}

function buildAdminCookie(token, req) {
  const secureFlag = shouldUseSecureCookie(req) ? "; Secure" : ""
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`
}

function buildAdminCookieClear(req) {
  const secureFlag = shouldUseSecureCookie(req) ? "; Secure" : ""
  return `${ADMIN_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secureFlag}`
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

fastify.post("/api/admin/login", async (req, reply) => {
  const adminKey = process.env.ADMIN_KEY
  const provided = typeof req.body?.adminKey === "string" ? req.body.adminKey.trim() : ""
  if (!adminKey || provided !== adminKey) {
    reply.code(403)
    return { ok: false, error: "forbidden" }
  }

  const token = createAdminSessionToken()
  reply.header("set-cookie", buildAdminCookie(token, req))
  return { ok: true }
})

fastify.post("/api/admin/logout", async (req, reply) => {
  clearAdminSession(req)
  reply.header("set-cookie", buildAdminCookieClear(req))
  return { ok: true }
})

function serializeWinners() {
  const byLine = {}
  winners.forEach((set, index) => {
    byLine[`line_${index + 1}`] = [...set]
  })

  const full = byLine[`line_${ROWS}`] || []
  return {
    byLine,
    full,
    one: byLine.line_1 || [],
    two: byLine.line_2 || [],
    three: byLine.line_3 || []
  }
}

function serializeWinnerCounts() {
  const byLine = {}
  winners.forEach((set, index) => {
    byLine[`line_${index + 1}`] = set.size
  })

  return {
    byLine,
    full: winners[ROWS - 1]?.size || 0,
    one: winners[0]?.size || 0,
    two: winners[1]?.size || 0,
    three: winners[2]?.size || 0
  }
}

function serializeState() {
  return {
    gameVersion,
    board: serializeBoardConfig(),
    phase: {
      targetTier: currentTargetTier,
      targetLabel:
        currentTargetTier === ROWS ? `Carton plein (${ROWS} lignes)` : `${currentTargetTier} ligne${currentTargetTier > 1 ? "s" : ""}`,
      locked: (winners[currentTargetTier - 1]?.size || 0) > 0
    },
    stats: {
      eventsTotal: eventNames.length,
      players: players.size
    },
    triggered,
    winners: serializeWinners()
  }
}

function markProgressStatsDirty() {
  progressStatsDirty = true
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

function shuffleArray(source) {
  const copy = [...source]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }
  return copy
}

function resetGameState() {
  players = new Map()
  playersByCard = new Map()
  triggered = []
  triggeredSet = new Set()
  winners = createWinnerTiers()
  rewardedTokens = new Set()
  currentTargetTier = 1
  const raffleStore = createRaffleStore()
  raffleEntriesByTier = raffleStore.entriesByTier
  raffleWinnerByTier = raffleStore.winnerByTier
  raffleWonEmails = new Set()
  raffleEntrySeq = 1
  activationSequence = 0
  activationLog = []
  activationCountByEvent = new Map()
  markProgressStatsDirty()
  gameVersion += 1
}

function clearRoundProgress() {
  triggered = []
  triggeredSet = new Set()
  winners = createWinnerTiers()
  rewardedTokens = new Set()
  currentTargetTier = 1
  const raffleStore = createRaffleStore()
  raffleEntriesByTier = raffleStore.entriesByTier
  raffleWinnerByTier = raffleStore.winnerByTier
  raffleWonEmails = new Set()
  raffleEntrySeq = 1
  activationSequence = 0
  activationLog = []
  activationCountByEvent = new Map()
  markProgressStatsDirty()
}

function generateCards() {
  const requiredSize = boardSize()
  const mandatoryEventNames = events.filter((event) => event.is_mandatory).map((event) => event.name)
  const optionalEventNames = events.filter((event) => !event.is_mandatory).map((event) => event.name)

  if (mandatoryEventNames.length > requiredSize) {
    fastify.log.warn(
      { mandatory: mandatoryEventNames.length, required: requiredSize },
      "Too many mandatory events for current board size"
    )
    return false
  }

  if (eventNames.length < requiredSize) {
    fastify.log.warn(
      { events: eventNames.length, required: requiredSize },
      "Not enough events to generate bingo cards"
    )
    return false
  }

  const optionalNeeded = requiredSize - mandatoryEventNames.length
  if (optionalEventNames.length < optionalNeeded) {
    fastify.log.warn(
      { optional: optionalEventNames.length, optionalNeeded },
      "Not enough optional events to complete each card"
    )
    return false
  }

  const nextCards = []
  const nextEventIndex = new Map()

  for (let i = 0; i < MAX_CARDS; i++) {
    const optionalPicked = optionalNeeded > 0 ? pickUniqueEvents(optionalEventNames, optionalNeeded) : []
    const card = shuffleArray([...mandatoryEventNames, ...optionalPicked])
    nextCards.push(card)

    for (let position = 0; position < card.length; position++) {
      const eventName = card[position]
      const rowIndex = Math.floor(position / COLS)
      const encodedImpact = i * ROWS + rowIndex
      if (!nextEventIndex.has(eventName)) {
        nextEventIndex.set(eventName, [])
      }
      nextEventIndex.get(eventName).push(encodedImpact)
    }
  }

  cards = nextCards
  eventIndex = nextEventIndex
  initCardProgress()
  resetGameState()
  return true
}

function applyEventImpact(eventName, delta, evaluateCards = true) {
  const impacts = eventIndex.get(eventName) || []
  for (const encodedImpact of impacts) {
    const cardIndex = Math.floor(encodedImpact / ROWS)
    const rowIndex = encodedImpact % ROWS

    const before = cardRowHits[cardIndex][rowIndex]
    const after = before + delta
    cardRowHits[cardIndex][rowIndex] = after

    if (delta > 0 && before === COLS - 1) {
      cardLineCounts[cardIndex]++
    }
    if (delta < 0 && before === COLS) {
      cardLineCounts[cardIndex]--
    }

    if (evaluateCards) {
      checkCard(cardIndex)
    }
  }
}

function rebuildCardProgressFromTriggered() {
  initCardProgress()
  for (const eventName of triggered) {
    applyEventImpact(eventName, 1, false)
  }
}

function checkCard(cardIndex) {
  const card = cards[cardIndex]
  if (!card) return

  const lines = cardLineCounts[cardIndex] || 0
  const tier = currentTargetTier
  const currentTierWinners = winners[tier - 1]
  if (!currentTierWinners || currentTierWinners.size > 0) return
  const cardTokens = playersByCard.get(cardIndex)
  if (!cardTokens || cardTokens.size === 0) return

  for (const token of cardTokens) {
    if (rewardedTokens.has(token)) continue
    if (lines >= tier) {
      currentTierWinners.add(token)
      rewardedTokens.add(token)
      break
    }
  }
}

function recomputeWinners() {
  const preservedWinners = winners.map((set) => new Set(set))
  winners = createWinnerTiers()
  rewardedTokens = new Set()

  for (let tier = 1; tier <= ROWS; tier++) {
    if (tier >= currentTargetTier) continue
    const preserved = preservedWinners[tier - 1]
    if (!preserved || preserved.size === 0) continue
    const winnerToken = preserved.values().next().value
    if (!winnerToken) continue
    winners[tier - 1].add(winnerToken)
    rewardedTokens.add(winnerToken)
  }

  for (const cardIndex of playersByCard.keys()) {
    checkCard(cardIndex)
  }
}

function evaluateCurrentTierAcrossCards() {
  for (const cardIndex of playersByCard.keys()) {
    checkCard(cardIndex)
    if ((winners[currentTargetTier - 1]?.size || 0) > 0) break
  }
}

function recordActivation(eventName) {
  activationSequence += 1
  const count = (activationCountByEvent.get(eventName) || 0) + 1
  activationCountByEvent.set(eventName, count)

  activationLog.push({
    order: activationSequence,
    event: eventName,
    activation_count: count,
    activated_at: new Date().toISOString()
  })

  if (activationLog.length > MAX_ACTIVATION_LOG) {
    activationLog = activationLog.slice(activationLog.length - MAX_ACTIVATION_LOG)
  }
}

function setEventTriggered(eventName, active) {
  if (active) {
    if (triggeredSet.has(eventName)) return false
    triggeredSet.add(eventName)
    triggered.push(eventName)
    recordActivation(eventName)
    applyEventImpact(eventName, 1, true)
    markProgressStatsDirty()
    return true
  }

  if (!triggeredSet.has(eventName)) return false
  triggeredSet.delete(eventName)
  triggered = triggered.filter((name) => name !== eventName)
  rebuildCardProgressFromTriggered()
  recomputeWinners()
  markProgressStatsDirty()
  return true
}

function attachPlayerToCard(token, cardIndex) {
  if (!playersByCard.has(cardIndex)) {
    playersByCard.set(cardIndex, new Set())
  }
  playersByCard.get(cardIndex).add(token)
  markProgressStatsDirty()
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
      is_mandatory: Boolean(e.is_mandatory),
      created_at: e.created_at
    }))
    .filter((e) => e.name)

  eventNames = events.map((e) => e.name)
  fastify.log.info({ events: eventNames.length }, "Events loaded")

  const generated = generateCards()
  if (!generated) {
    return false
  }
  fastify.log.info({ cards: cards.length }, "Cards generated")
  return true
}

async function bootstrapGameData() {
  if (bootstrapPromise) return bootstrapPromise

  bootstrapPromise = (async () => {
    const ok = await loadEvents()
    isBootstrapped = Boolean(ok && cards.length > 0)
    bootstrapError = isBootstrapped ? null : "bootstrap_failed"
    if (isBootstrapped) {
      refreshConnectedPlayers()
      io.emit("state", serializeState())
    }
    return ok
  })().finally(() => {
    bootstrapPromise = null
  })

  return bootstrapPromise
}

io.on("connection", (socket) => {
  const role = socket.handshake.auth?.role
  if (role === "overlay") {
    const expectedOverlayKey = process.env.OVERLAY_KEY
    const providedOverlayKey = socket.handshake.auth?.overlayKey
    if (expectedOverlayKey && providedOverlayKey !== expectedOverlayKey) {
      socket.emit("error", "forbidden_overlay")
      socket.disconnect(true)
      return
    }

    socket.emit("state", serializeState())
    return
  }

  let token = socket.handshake.auth?.token
  if (!token) token = uuidv4()
  socket.data.token = token

  if (cards.length === 0) {
    socket.emit("error", "no_cards_generated")
    return
  }

  const player = ensurePlayer(token)

  socket.emit("token", token)
  socket.emit("card", cards[player.cardIndex])
  socket.emit("state", serializeState())
})

function refreshConnectedPlayers() {
  for (const socket of io.sockets.sockets.values()) {
    const token = socket.data?.token
    if (!token) continue
    const player = ensurePlayer(token)
    socket.emit("card", cards[player.cardIndex])
    socket.emit("state", serializeState())
  }
}

fastify.get("/api/health", async () => {
  return {
    status: "ok",
    board: serializeBoardConfig(),
    ready: isBootstrapped,
    bootstrapping: Boolean(bootstrapPromise),
    bootstrapError,
    players: players.size,
    cards: cards.length,
    events: eventNames.length
  }
})

function getDebugState() {
  const mandatory = events.filter((event) => event.is_mandatory).length
  return {
    gameVersion,
    ...serializeBoardConfig(),
    events: eventNames.length,
    mandatory,
    cards: cards.length,
    players: players.size,
    triggered: triggered.length,
    activationCount: activationSequence,
    targetTier: currentTargetTier,
    targetLabel:
      currentTargetTier === ROWS ? `Carton plein (${ROWS} lignes)` : `${currentTargetTier} ligne${currentTargetTier > 1 ? "s" : ""}`,
    tierLocked: (winners[currentTargetTier - 1]?.size || 0) > 0,
    raffle: serializeRaffleSummary(),
    progressByLine: getProgressStatsByLine(),
    winners: serializeWinnerCounts()
  }
}

function normalizeRaffleEmail(value) {
  if (typeof value !== "string") return ""
  return value.trim().toLowerCase()
}

function parseOrderTotalCents(order) {
  const raw =
    order?.order_total ??
    order?.orderTotal ??
    order?.total ??
    order?.amount_total ??
    order?.amount
  const value = Number(raw)
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function hasOrderReward(order) {
  const items = Array.isArray(order?.items) ? order.items : []
  return items.some((item) => Boolean(item?.reward_id || item?.reward?.id))
}

function findOrderEmail(order) {
  const direct = order?.user?.email || order?.email || order?.backer_email
  if (typeof direct === "string" && direct.trim()) return direct.trim().toLowerCase()
  return ""
}

function parseNextQueryFromMeta(meta) {
  if (!meta?.next || typeof meta.next !== "string") return ""
  return meta.next
}

async function fetchUluleOrdersByStatus(status) {
  const endpointBase = `${ULULE_API_BASE}/projects/${ULULE_PROJECT_ID}/orders`
  let nextQuery = `?status=${encodeURIComponent(status)}&limit=20&show_anonymous=true`
  const orders = []

  for (let page = 0; page < 20 && nextQuery; page++) {
    const response = await fetch(`${endpointBase}${nextQuery}`, {
      headers: {
        Authorization: `APIKey ${ULULE_API_KEY}`,
        Accept: "application/json"
      }
    })

    if (!response.ok) {
      throw new Error(`ulule_${response.status}`)
    }

    const payload = await response.json().catch(() => ({}))
    const pageOrders = Array.isArray(payload?.orders) ? payload.orders : []
    orders.push(...pageOrders)
    nextQuery = parseNextQueryFromMeta(payload?.meta)
  }

  return orders
}

async function checkUluleEligibility(email) {
  const normalizedEmail = normalizeRaffleEmail(email)
  if (!normalizedEmail) return { ok: false, error: "invalid_email" }
  if (!ULULE_API_KEY || !ULULE_PROJECT_ID) return { ok: false, error: "ulule_not_configured" }

  const cached = ululeEligibilityCache.get(normalizedEmail)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  try {
    const [doneOrders, completedOrders] = await Promise.all([
      fetchUluleOrdersByStatus("payment-done"),
      fetchUluleOrdersByStatus("payment-completed")
    ])
    const allOrders = [...doneOrders, ...completedOrders]
    const matchingOrders = allOrders.filter((order) => findOrderEmail(order) === normalizedEmail)

    const qualifyingOrder = matchingOrders.find((order) => {
      const totalCents = parseOrderTotalCents(order)
      return hasOrderReward(order) || totalCents >= ULULE_MIN_CONTRIBUTION_CENTS
    })

    const result = qualifyingOrder
      ? {
          ok: true,
          eligible: true,
          hasReward: hasOrderReward(qualifyingOrder),
          orderTotalCents: parseOrderTotalCents(qualifyingOrder)
        }
      : { ok: true, eligible: false }

    ululeEligibilityCache.set(normalizedEmail, {
      value: result,
      expiresAt: Date.now() + ULULE_EMAIL_CACHE_TTL_MS
    })
    return result
  } catch (error) {
    fastify.log.error({ error, email: normalizedEmail }, "Ulule eligibility check failed")
    return { ok: false, error: "ulule_check_failed" }
  }
}

function parseTierInput(rawTier) {
  const tier = Number(rawTier || currentTargetTier)
  if (!Number.isInteger(tier) || tier < 1 || tier > ROWS) return null
  return tier
}

function serializeRaffleTier(tier) {
  const tierIndex = tier - 1
  const entriesMap = raffleEntriesByTier[tierIndex] || new Map()
  const entries = [...entriesMap.values()].map((entry) => ({
    id: entry.id,
    email: entry.email,
    ulule: entry.ulule || null,
    source: entry.source,
    createdAt: entry.createdAt
  }))
  const winner = raffleWinnerByTier[tierIndex]
  return {
    tier,
    label: tier === ROWS ? `Carton plein (${tier} lignes)` : `${tier} ligne${tier > 1 ? "s" : ""}`,
    entriesCount: entries.length,
    entries,
    winner
  }
}

function serializeRaffleSummary() {
  const byTier = {}
  for (let tier = 1; tier <= ROWS; tier++) {
    const tierData = serializeRaffleTier(tier)
    byTier[`line_${tier}`] = {
      entriesCount: tierData.entriesCount,
      winner: tierData.winner
    }
  }
  return {
    currentTier: currentTargetTier,
    byTier
  }
}

function addRaffleEntry({ tier, email, source = "manual", ulule = null }) {
  const tierIndex = tier - 1
  const entriesMap = raffleEntriesByTier[tierIndex]
  const normalizedEmail = normalizeRaffleEmail(email)
  if (!normalizedEmail) return { ok: false, error: "invalid_email" }

  if (raffleWonEmails.has(normalizedEmail)) {
    return { ok: false, error: "already_won" }
  }

  for (const existing of entriesMap.values()) {
    if (existing.email === normalizedEmail) {
      return { ok: true, duplicated: true, entry: existing }
    }
  }

  const entry = {
    id: `r${raffleEntrySeq++}`,
    email: normalizedEmail,
    ulule,
    source,
    createdAt: new Date().toISOString()
  }
  entriesMap.set(entry.id, entry)
  return { ok: true, entry }
}

function getProgressStatsByLine() {
  if (!progressStatsDirty && progressStatsCache) return progressStatsCache

  const byLine = {}
  for (let tier = 1; tier <= ROWS; tier++) {
    byLine[`line_${tier}`] = {
      oneAway: 0,
      missingBuckets: {}
    }
  }

  for (const [cardIndex, tokens] of playersByCard.entries()) {
    const playerCount = tokens?.size || 0
    if (!playerCount) continue

    const rowHits = cardRowHits[cardIndex]
    if (!rowHits) continue

    const missingByRow = rowHits.map((hits) => Math.max(0, COLS - hits)).sort((a, b) => a - b)
    let cumulativeMissing = 0

    for (let tier = 1; tier <= ROWS; tier++) {
      cumulativeMissing += missingByRow[tier - 1] || 0
      const key = `line_${tier}`
      const tierStats = byLine[key]
      const bucketKey = cumulativeMissing >= 7 ? "7+" : String(cumulativeMissing)
      tierStats.missingBuckets[bucketKey] = (tierStats.missingBuckets[bucketKey] || 0) + playerCount
      if (cumulativeMissing === 1) tierStats.oneAway += playerCount
    }
  }

  progressStatsCache = byLine
  progressStatsDirty = false
  return byLine
}

function serializeAdminEvents() {
  const activeOrder = new Map(triggered.map((name, index) => [name, index + 1]))
  return events.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    is_mandatory: row.is_mandatory,
    created_at: row.created_at,
    triggered: triggeredSet.has(row.name),
    trigger_order: activeOrder.get(row.name) || null,
    activation_count: activationCountByEvent.get(row.name) || 0
  }))
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
    activationCount: activationSequence,
    events: serializeAdminEvents()
  }
})

fastify.get("/api/admin/bootstrap", { preHandler: requireAdmin }, async () => {
  const byCategory = {}
  for (const event of events) {
    byCategory[event.category] = (byCategory[event.category] || 0) + 1
  }

  return {
    ready: isBootstrapped,
    bootstrapping: Boolean(bootstrapPromise),
    bootstrapError,
    debug: getDebugState(),
    events: {
      total: events.length,
      triggered: triggered.length,
      byCategory,
      activationCount: activationSequence,
      events: serializeAdminEvents(),
      activationLog: activationLog.slice(-200)
    }
  }
})

fastify.get("/api/admin/activation-log", { preHandler: requireAdmin }, async (req, reply) => {
  const limit = Number(req.query?.limit || 200)
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) {
    reply.code(400)
    return { ok: false, error: "invalid_limit" }
  }

  return {
    ok: true,
    total: activationSequence,
    activeTriggered: triggered.length,
    items: activationLog.slice(-limit)
  }
})

fastify.post("/api/admin/reload", { preHandler: requireAdmin }, async () => {
  const ok = await bootstrapGameData()
  if (!ok) {
    return {
      ok: false,
      error: "reload_failed"
    }
  }
  refreshConnectedPlayers()
  return {
    ok: true,
    debug: getDebugState()
  }
})

fastify.patch("/api/admin/board", { preHandler: requireAdmin }, async (req, reply) => {
  const nextRows = Number(req.body?.rows)
  const nextCols = Number(req.body?.cols)

  if (
    !Number.isInteger(nextRows) ||
    !Number.isInteger(nextCols) ||
    nextRows < 2 ||
    nextCols < 2 ||
    nextRows > 8 ||
    nextCols > 8
  ) {
    reply.code(400)
    return { ok: false, error: "invalid_board_size" }
  }

  const mandatoryCount = events.filter((event) => event.is_mandatory).length
  if (mandatoryCount > nextRows * nextCols) {
    reply.code(400)
    return {
      ok: false,
      error: "mandatory_too_many",
      mandatory: mandatoryCount,
      maxAllowed: nextRows * nextCols
    }
  }

  if (eventNames.length < nextRows * nextCols) {
    reply.code(400)
    return { ok: false, error: "not_enough_events", required: nextRows * nextCols, available: eventNames.length }
  }

  ROWS = nextRows
  COLS = nextCols
  currentTargetTier = Math.min(currentTargetTier, ROWS)
  const generated = generateCards()
  if (!generated) {
    reply.code(400)
    return { ok: false, error: "board_generation_failed" }
  }
  refreshConnectedPlayers()

  return { ok: true, board: serializeBoardConfig(), gameVersion }
})

fastify.post("/api/admin/target-tier", { preHandler: requireAdmin }, async (req, reply) => {
  const tier = Number(req.body?.tier)
  if (!Number.isInteger(tier) || tier < 1 || tier > ROWS) {
    reply.code(400)
    return { ok: false, error: "invalid_tier", min: 1, max: ROWS }
  }

  if (tier < currentTargetTier) {
    reply.code(400)
    return { ok: false, error: "cannot_decrease_tier", current: currentTargetTier }
  }

  if (tier === currentTargetTier) {
    return { ok: true, debug: getDebugState(), unchanged: true }
  }

  currentTargetTier = tier
  recomputeWinners()
  evaluateCurrentTierAcrossCards()
  io.emit("state", serializeState())
  return { ok: true, debug: getDebugState() }
})

fastify.get("/api/admin/raffle", { preHandler: requireAdmin }, async (req, reply) => {
  const tier = parseTierInput(req.query?.tier)
  if (!tier) {
    reply.code(400)
    return { ok: false, error: "invalid_tier", min: 1, max: ROWS }
  }
  return { ok: true, ...serializeRaffleTier(tier) }
})

fastify.post("/api/admin/raffle/enter", { preHandler: requireAdmin }, async (req, reply) => {
  const tier = parseTierInput(req.body?.tier)
  if (!tier) {
    reply.code(400)
    return { ok: false, error: "invalid_tier", min: 1, max: ROWS }
  }

  const ululeCheck = await checkUluleEligibility(req.body?.email)
  if (!ululeCheck.ok) {
    reply.code(500)
    return { ok: false, error: ululeCheck.error || "ulule_check_failed" }
  }
  if (!ululeCheck.eligible) {
    reply.code(400)
    return { ok: false, error: "not_ulule_eligible" }
  }

  const outcome = addRaffleEntry({
    tier,
    email: req.body?.email,
    source: "manual",
    ulule: {
      verifiedAt: new Date().toISOString(),
      hasReward: Boolean(ululeCheck.hasReward),
      orderTotalCents: Number(ululeCheck.orderTotalCents || 0)
    }
  })

  if (!outcome.ok) {
    reply.code(400)
    return outcome
  }

  return {
    ok: true,
    duplicated: Boolean(outcome.duplicated),
    entry: outcome.entry,
    raffle: serializeRaffleTier(tier)
  }
})

fastify.post("/api/admin/raffle/mock", { preHandler: requireAdmin }, async (req, reply) => {
  const tier = parseTierInput(req.body?.tier)
  if (!tier) {
    reply.code(400)
    return { ok: false, error: "invalid_tier", min: 1, max: ROWS }
  }

  const count = Number(req.body?.count || 10)
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    reply.code(400)
    return { ok: false, error: "invalid_count" }
  }

  let added = 0
  let attempts = 0
  while (added < count && attempts < count * 5) {
    attempts += 1
    const suffix = Math.floor(Math.random() * 1000000)
    const fakeEmail = `testeur.${tier}.${suffix}@demo.local`
    const outcome = addRaffleEntry({ tier, email: fakeEmail, source: "mock" })
    if (outcome.ok && !outcome.duplicated) added += 1
  }

  return {
    ok: true,
    added,
    raffle: serializeRaffleTier(tier)
  }
})

fastify.post("/api/admin/raffle/draw", { preHandler: requireAdmin }, async (req, reply) => {
  const tier = parseTierInput(req.body?.tier)
  if (!tier) {
    reply.code(400)
    return { ok: false, error: "invalid_tier", min: 1, max: ROWS }
  }
  const tierIndex = tier - 1
  const entries = [...(raffleEntriesByTier[tierIndex] || new Map()).values()]
  if (entries.length === 0) {
    reply.code(400)
    return { ok: false, error: "no_entries" }
  }

  if (raffleWinnerByTier[tierIndex]) {
    return { ok: true, alreadyDrawn: true, raffle: serializeRaffleTier(tier) }
  }

  const eligible = entries.filter((entry) => !raffleWonEmails.has(entry.email))
  if (eligible.length === 0) {
    reply.code(400)
    return { ok: false, error: "no_eligible_entries" }
  }

  const selected = eligible[Math.floor(Math.random() * eligible.length)]
  const winner = {
    id: selected.id,
    email: selected.email,
    selectedAt: new Date().toISOString()
  }
  raffleWinnerByTier[tierIndex] = winner
  raffleWonEmails.add(selected.email)

  return {
    ok: true,
    winner,
    raffle: serializeRaffleTier(tier)
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
  const isMandatory = Boolean(req.body?.is_mandatory)
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
    .insert([{ name: normalizedName, category, is_mandatory: isMandatory }])
  if (error) {
    fastify.log.error({ error }, "Error creating event")
    reply.code(500)
    return { ok: false, error: "create_failed", details: error.message }
  }

  const ok = await loadEvents()
  if (!ok) {
    reply.code(500)
    return { ok: false, error: "reload_failed" }
  }

  refreshConnectedPlayers()
  return { ok: true, gameReset: true }
})

fastify.patch("/api/admin/events/:id", { preHandler: requireAdmin }, async (req, reply) => {
  const id = Number(req.params?.id)
  if (!Number.isInteger(id) || id <= 0) {
    reply.code(400)
    return { ok: false, error: "invalid_id" }
  }

  const updates = {}
  const currentEvent = events.find((event) => event.id === id)
  if (!currentEvent) {
    reply.code(404)
    return { ok: false, error: "not_found" }
  }

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

  if (typeof req.body?.is_mandatory === "boolean") {
    updates.is_mandatory = req.body.is_mandatory
  }

  if (Object.keys(updates).length === 0) {
    reply.code(400)
    return { ok: false, error: "no_update" }
  }

  const needsCardRegeneration =
    Object.prototype.hasOwnProperty.call(updates, "name") ||
    Object.prototype.hasOwnProperty.call(updates, "is_mandatory")

  const { data, error } = await supabase
    .from("events")
    .update(updates)
    .eq("id", id)
    .select("id")

  if (error) {
    fastify.log.error({ error }, "Error updating event")
    reply.code(500)
    return { ok: false, error: "update_failed", details: error.message }
  }

  if (!data || data.length === 0) {
    reply.code(404)
    return { ok: false, error: "not_found" }
  }

  if (needsCardRegeneration) {
    const ok = await loadEvents()
    if (!ok) {
      reply.code(500)
      return { ok: false, error: "reload_failed" }
    }

    refreshConnectedPlayers()
    return { ok: true, gameReset: true }
  }

  // Category-only update: keep current round state and cards untouched.
  events = events.map((event) => (event.id === id ? { ...event, ...updates } : event))
  return { ok: true, gameReset: false }
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
    const port = Number(process.env.PORT || 3000)
    await fastify.listen({ port, host: "0.0.0.0" })
    fastify.log.info({ port }, "Server listening")

    // Non-blocking boot to reduce cold-start wait on first HTTP response.
    bootstrapGameData()
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
