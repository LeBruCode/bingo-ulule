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
const ADMIN_SESSION_SECRET = String(process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_KEY || "change-me")
const ULULE_API_BASE = process.env.ULULE_API_BASE || "https://api.ulule.com/v1"
const ULULE_API_KEY = process.env.ULULE_API_KEY || ""
const ULULE_PROJECT_ID = process.env.ULULE_PROJECT_ID || ""
const ULULE_MIN_CONTRIBUTION_CENTS = 1000
const ULULE_LONG_CACHE_DAYS = 40
const ULULE_DELTA_HOURS = 4
const ULULE_SYNC_INTERVAL_LIVE_MS = 15000
const ULULE_SYNC_INTERVAL_IDLE_MS = 10 * 60 * 1000
const ULULE_SYNC_MAX_PAGES = 20
const ULULE_SYNC_AUTO_LIVE = true
let ululeContributionByEmail = new Map()
let ululeSyncTimer = null
const ululeSyncState = {
  liveMode: false,
  inProgress: false,
  lastSyncAt: null,
  lastError: null,
  lastDurationMs: 0,
  nextRunAt: null,
  lastReason: null,
  updatedOrders: 0
}
let progressStatsCache = null
let progressStatsDirty = true
let campaignEndAtMs = Number.isFinite(Date.parse(process.env.CAMPAIGN_END_AT || "")) ? Date.parse(process.env.CAMPAIGN_END_AT) : null
let liveStreamUrl = typeof process.env.LIVE_STREAM_URL === "string" ? process.env.LIVE_STREAM_URL.trim() : ""
let ululePageUrl = typeof process.env.ULULE_PAGE_URL === "string" ? process.env.ULULE_PAGE_URL.trim() : ""
let gameEnded = false
let gameFallbackActive = false
let runtimeStateStorageReady = false
let pendingRuntimeState = null
let runtimeStateSaveTimer = null
const DEFAULT_TEXT_CONTENT = {
  "brand.logo_src": "",
  "player.title": "Bingo Live",
  "player.subtitle": "Campagne en direct",
  "player.loading_card": "Chargement de la carte...",
  "player.game_ended_title": "Jeu termine",
  "player.game_ended_body": "Merci a tous pour votre participation.",
  "player.fallback_title": "Jeu indisponible",
  "player.fallback_body": "En raison de problemes techniques, nous ne sommes malheureusement pas en mesure de pouvoir vous proposer ce jeu. Nous vous remercions toutefois pour votre participation. A tres vite.",
  "player.no_cards_generated": "Initialisation du bingo en cours, reessaie dans quelques secondes.",
  "player.connection_error": "Connexion indisponible temporairement.",
  "player.countdown_label": "Fin de campagne dans",
  "player.countdown_ended": "Campagne terminée",
  "player.countdown_days": "Jours",
  "player.countdown_hours": "Heures",
  "player.countdown_minutes": "Minutes",
  "player.countdown_seconds": "Secondes",
  "player.join_live_button": "Rejoindre le live YouTube",
  "player.join_ulule_button": "Voir la page Ulule",
  "player.live_message": "",
  "player.mobile_shell_font_size": "1.125",
  "player.mobile_title_size": "2.15",
  "player.mobile_text_size": "1.18",
  "player.mobile_button_size": "1.14",
  "player.mobile_countdown_number_size": "2.22",
  "player.mobile_spotlight_size": "2.34",
  "player.mobile_progress_size": "1.16",
  "player.mobile_card_text_size": "1.42",
  "player.raffle_button": "Participer au tirage au sort",
  "player.raffle_registered_banner": "Ta participation au tirage au sort est bien prise en compte.",
  "player.raffle_registered_status": "Tu participes au tirage au sort.",
  "player.current_reward_label": "A gagner",
  "player.cell_validated_badge": "Validé",
  "player.progress_ready": "Eligible au tirage",
  "player.progress_closed": "Tirage termine",
  "player.progress_waiting_round": "En attente de cette manche",
  "player.progress_missing": "Il manque {missing} case{plural}",
  "player.qualified_banner": "Tu as complete {label}. Tu peux participer au tirage au sort.",
  "player.modal_title": "Participer au tirage",
  "player.modal_body": "Tu es qualifie pour {label}. Renseigne le prenom et l'adresse email utilisee pour ta contribution Ulule. Pour participer, cette contribution ou ce don doit etre d'au moins 10 EUR.",
  "player.modal_first_name": "Prenom",
  "player.modal_email": "Email utilise sur Ulule",
  "player.modal_close": "Fermer",
  "player.modal_submit": "Valider ma participation",
  "player.modal_submit_loading": "Verification...",
  "player.error_missing_fields": "Merci de remplir ton prenom et l'email utilise pour ta contribution Ulule.",
  "player.error_not_ulule_eligible": "Aucune contribution eligible n'a ete trouvee pour cet email sur Ulule. Verifie que l'email est correct, ou contribue avec cet email avec une contrepartie ou un don d'au moins 10 EUR.",
  "player.error_contribution_too_low": "Une contribution existe bien pour cet email sur Ulule, mais son montant est inferieur a 10 EUR. Pour participer au tirage, la contribution ou le don doit etre d'au moins 10 EUR.",
  "player.error_not_qualified": "Ta qualification n'est plus active pour ce palier.",
  "player.error_generic": "Erreur : {error}",
  "player.success_duplicate": "Email deja inscrit pour ce palier.",
  "player.success_validated": "Inscription au tirage validee.",
  "overlay.title": "Progression Bingo Live",
  "overlay.events": "Evenements : {current}/{total}",
  "overlay.players": "Joueurs : {count}",
  "overlay.tier_done": "Gagne",
  "overlay.tier_pending": "En attente",
  "overlay.next_tier": "Prochain palier : {label}",
  "overlay.all_done": "Tous les paliers sont gagnes",
  "reward.line_1": "",
  "reward.line_2": "",
  "reward.line_3": "",
  "reward.line_4": "",
  "reward.line_5": "",
  "reward.line_6": "",
  "reward.line_7": "",
  "reward.line_8": ""
}
let editableContent = { ...DEFAULT_TEXT_CONTENT }
let contentStorageReady = false

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

function signAdminSessionPayload(payload) {
  return crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payload).digest("hex")
}

function safeEqualStrings(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function hasValidAdminSession(req) {
  const token = getAdminSessionToken(req)
  if (!token) return false
  const [expiresAtRaw, signature] = token.split(".")
  if (!expiresAtRaw || !signature) return false
  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false
  const expectedSignature = signAdminSessionPayload(expiresAtRaw)
  return safeEqualStrings(signature, expectedSignature)
}

function createAdminSessionToken() {
  const expiresAt = String(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000)
  const signature = signAdminSessionPayload(expiresAt)
  return `${expiresAt}.${signature}`
}

function clearAdminSession() {}

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

fastify.post("/api/backend-bruno/login", async (req, reply) => {
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

fastify.post("/api/backend-bruno/logout", async (req, reply) => {
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
    game: {
      ended: gameEnded,
      fallbackActive: gameFallbackActive
    },
    campaign: serializeCampaign(),
    liveStream: serializeLiveStream(),
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

function serializeCampaign() {
  if (!campaignEndAtMs) return { endAt: null, remainingMs: null, isEnded: false }
  const now = Date.now()
  const remainingMs = Math.max(0, campaignEndAtMs - now)
  return {
    endAt: new Date(campaignEndAtMs).toISOString(),
    remainingMs,
    isEnded: remainingMs === 0
  }
}

function serializeLiveStream() {
  return {
    url: liveStreamUrl || null,
    ululeUrl: ululePageUrl || null
  }
}

function serializeContent() {
  return { ...DEFAULT_TEXT_CONTENT, ...editableContent }
}

function serializeBranding() {
  const content = serializeContent()
  return {
    logoSrc: typeof content["brand.logo_src"] === "string" && content["brand.logo_src"].trim() ? content["brand.logo_src"].trim() : null
  }
}

async function loadEditableContent() {
  const { data, error } = await supabase.from("app_content").select("content_key, content_value")
  if (error) {
    fastify.log.warn({ error }, "Content table unavailable, using defaults")
    editableContent = { ...DEFAULT_TEXT_CONTENT }
    contentStorageReady = false
    return false
  }

  const next = { ...DEFAULT_TEXT_CONTENT }
  for (const row of data || []) {
    if (typeof row.content_key !== "string") continue
    next[row.content_key] = typeof row.content_value === "string" ? row.content_value : ""
  }
  editableContent = next
  contentStorageReady = true
  return true
}

async function saveEditableContent(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return { ok: true, persisted: contentStorageReady }

  for (const entry of entries) {
    if (!entry || typeof entry.key !== "string") continue
    const key = entry.key.trim()
    if (!key) continue
    editableContent[key] = typeof entry.value === "string" ? entry.value : ""
  }

  const rows = entries
    .filter((entry) => entry && typeof entry.key === "string" && entry.key.trim())
    .map((entry) => ({
      content_key: entry.key.trim(),
      content_value: typeof entry.value === "string" ? entry.value : ""
    }))

  if (rows.length === 0) return { ok: true, persisted: contentStorageReady }

  const { error } = await supabase.from("app_content").upsert(rows, { onConflict: "content_key" })
  if (error) {
    fastify.log.warn({ error }, "Content save fallback to memory only")
    contentStorageReady = false
    return { ok: true, persisted: false, warning: "storage_unavailable" }
  }

  contentStorageReady = true
  return { ok: true, persisted: true }
}

function serializeRuntimeState() {
  return {
    rows: ROWS,
    cols: COLS,
    cards,
    campaignEndAtMs,
    liveStreamUrl,
    ululePageUrl,
    gameEnded,
    gameFallbackActive,
    currentTargetTier,
    winners: winners.map((set) => [...set]),
    rewardedTokens: [...rewardedTokens],
    playerAssignments: [...players.entries()].map(([token, player]) => ({
      token,
      cardIndex: player.cardIndex
    })),
    triggered,
    activationSequence,
    activationLog,
    activationCountByEvent: Object.fromEntries(activationCountByEvent.entries()),
    raffleEntrySeq,
    raffleWonEmails: [...raffleWonEmails],
    raffleEntriesByTier: raffleEntriesByTier.map((entriesMap) => [...entriesMap.values()]),
    raffleWinnerByTier
  }
}

function normalizeTriggeredEvents(input) {
  if (!Array.isArray(input)) return []
  return [...new Set(
    input
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value && eventNames.includes(value))
  )]
}

function normalizePlayerAssignments(input) {
  if (!Array.isArray(input)) return []
  return input
    .filter((row) => row && typeof row.token === "string" && Number.isInteger(Number(row.cardIndex)))
    .map((row) => ({
      token: row.token.slice(0, 120),
      cardIndex: Number(row.cardIndex)
    }))
    .filter((row) => row.token && row.cardIndex >= 0)
}

function normalizeWinnerSets(input) {
  if (!Array.isArray(input)) return createWinnerTiers()
  return Array.from({ length: ROWS }, (_, index) => {
    const raw = input[index]
    if (!Array.isArray(raw)) return new Set()
    return new Set(raw.filter((token) => typeof token === "string" && token))
  })
}

function normalizeRaffleEntries(input) {
  if (!Array.isArray(input)) return Array.from({ length: ROWS }, () => new Map())
  return Array.from({ length: ROWS }, (_, index) => {
    const rows = Array.isArray(input[index]) ? input[index] : []
    const map = new Map()
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || typeof row.email !== "string") continue
      map.set(row.id, {
        id: row.id,
        email: normalizeRaffleEmail(row.email),
        firstName: normalizeFirstName(row.firstName),
        lastInitial: normalizeLastInitial(row.lastInitial),
        playerToken: typeof row.playerToken === "string" ? row.playerToken.slice(0, 120) : "",
        ulule: row.ulule && typeof row.ulule === "object" ? row.ulule : null,
        source: typeof row.source === "string" ? row.source : "player",
        createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString()
      })
    }
    return map
  })
}

function canRestorePersistedCards(stateValue) {
  const persistedCards = stateValue?.cards
  if (!Array.isArray(persistedCards) || persistedCards.length === 0) return false
  const expectedSize = boardSize()
  const eventSet = new Set(eventNames)
  return persistedCards.every((card) =>
    Array.isArray(card) &&
    card.length === expectedSize &&
    card.every((eventName) => typeof eventName === "string" && eventSet.has(eventName))
  )
}

function setCardsFromSnapshot(snapshotCards) {
  const nextCards = snapshotCards.map((card) => [...card])
  const nextEventIndex = new Map()
  for (let cardIndex = 0; cardIndex < nextCards.length; cardIndex++) {
    const card = nextCards[cardIndex]
    for (let position = 0; position < card.length; position++) {
      const eventName = card[position]
      const rowIndex = Math.floor(position / COLS)
      const encodedImpact = cardIndex * ROWS + rowIndex
      if (!nextEventIndex.has(eventName)) nextEventIndex.set(eventName, [])
      nextEventIndex.get(eventName).push(encodedImpact)
    }
  }
  cards = nextCards
  eventIndex = nextEventIndex
  initCardProgress()
  resetGameState()
}

async function saveRuntimeState() {
  if (runtimeStateSaveTimer) {
    clearTimeout(runtimeStateSaveTimer)
    runtimeStateSaveTimer = null
  }
  const payload = serializeRuntimeState()
  const { error } = await supabase.from("app_state").upsert([
    {
      state_key: "runtime",
      state_value: payload
    }
  ], { onConflict: "state_key" })

  if (error) {
    fastify.log.warn({ error }, "Runtime state save failed")
    runtimeStateStorageReady = false
    return { ok: false, error: "runtime_state_save_failed" }
  }

  runtimeStateStorageReady = true
  return { ok: true }
}

function scheduleRuntimeStateSave(delayMs = 250) {
  if (runtimeStateSaveTimer) clearTimeout(runtimeStateSaveTimer)
  runtimeStateSaveTimer = setTimeout(() => {
    saveRuntimeState().catch((error) => {
      fastify.log.warn({ error }, "Deferred runtime state save failed")
    })
  }, delayMs)
}

async function loadRuntimeState() {
  const { data, error } = await supabase
    .from("app_state")
    .select("state_value")
    .eq("state_key", "runtime")
    .maybeSingle()

  if (error) {
    fastify.log.warn({ error }, "Runtime state table unavailable, using in-memory state")
    runtimeStateStorageReady = false
    return false
  }

  runtimeStateStorageReady = true
  const stateValue = data?.state_value
  if (!stateValue || typeof stateValue !== "object") return true
  pendingRuntimeState = stateValue

  const nextRows = parseBoardNumber(stateValue.rows, ROWS)
  const nextCols = parseBoardNumber(stateValue.cols, COLS)
  ROWS = nextRows
  COLS = nextCols

  campaignEndAtMs = Number.isFinite(Number(stateValue.campaignEndAtMs)) ? Number(stateValue.campaignEndAtMs) : null
  liveStreamUrl = typeof stateValue.liveStreamUrl === "string" ? stateValue.liveStreamUrl.trim() : ""
  ululePageUrl = typeof stateValue.ululePageUrl === "string" ? stateValue.ululePageUrl.trim() : ""
  gameEnded = Boolean(stateValue.gameEnded)
  gameFallbackActive = Boolean(stateValue.gameFallbackActive)

  return true
}

function applyPendingRuntimeState() {
  const stateValue = pendingRuntimeState
  pendingRuntimeState = null

  if (!stateValue || typeof stateValue !== "object") return

  currentTargetTier = Number.isInteger(Number(stateValue.currentTargetTier)) ? Math.min(Math.max(1, Number(stateValue.currentTargetTier)), ROWS) : 1

  const nextTriggered = normalizeTriggeredEvents(stateValue.triggered)
  triggered = nextTriggered
  triggeredSet = new Set(nextTriggered)

  activationSequence = Number.isInteger(Number(stateValue.activationSequence)) ? Math.max(0, Number(stateValue.activationSequence)) : 0
  activationLog = Array.isArray(stateValue.activationLog)
    ? stateValue.activationLog
        .filter((item) => item && typeof item.event === "string" && triggeredSet.has(item.event))
        .slice(-MAX_ACTIVATION_LOG)
    : []

  const rawCounts = stateValue.activationCountByEvent && typeof stateValue.activationCountByEvent === "object"
    ? stateValue.activationCountByEvent
    : {}
  activationCountByEvent = new Map(
    Object.entries(rawCounts)
      .filter(([eventName, count]) => eventNames.includes(eventName) && Number.isFinite(Number(count)))
      .map(([eventName, count]) => [eventName, Math.max(0, Number(count))])
  )

  players = new Map()
  playersByCard = new Map()
  for (const row of normalizePlayerAssignments(stateValue.playerAssignments)) {
    if (row.cardIndex >= cards.length) continue
    players.set(row.token, { cardIndex: row.cardIndex })
    attachPlayerToCard(row.token, row.cardIndex)
  }

  winners = normalizeWinnerSets(stateValue.winners)
  rewardedTokens = new Set(
    Array.isArray(stateValue.rewardedTokens)
      ? stateValue.rewardedTokens.filter((token) => typeof token === "string" && token)
      : []
  )

  raffleEntriesByTier = normalizeRaffleEntries(stateValue.raffleEntriesByTier)
  raffleWinnerByTier = Array.from({ length: ROWS }, (_, index) => {
    const row = Array.isArray(stateValue.raffleWinnerByTier) ? stateValue.raffleWinnerByTier[index] : null
    if (!row || typeof row.id !== "string" || typeof row.email !== "string") return null
    return {
      id: row.id,
      email: normalizeRaffleEmail(row.email),
      selectedAt: typeof row.selectedAt === "string" ? row.selectedAt : new Date().toISOString()
    }
  })
  raffleWonEmails = new Set(
    Array.isArray(stateValue.raffleWonEmails)
      ? stateValue.raffleWonEmails.map((email) => normalizeRaffleEmail(email)).filter(Boolean)
      : []
  )
  raffleEntrySeq = Number.isInteger(Number(stateValue.raffleEntrySeq)) ? Math.max(1, Number(stateValue.raffleEntrySeq)) : 1
}

function restoreRuntimeProgress() {
  applyPendingRuntimeState()
  rebuildCardProgressFromTriggered()
  if (winners.every((set) => set.size === 0) && rewardedTokens.size === 0) {
    recomputeWinners()
    evaluateCurrentTierAcrossCards()
  }
  markProgressStatsDirty()
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
  scheduleRuntimeStateSave()
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

  if (canRestorePersistedCards(pendingRuntimeState)) {
    setCardsFromSnapshot(pendingRuntimeState.cards)
    fastify.log.info({ cards: cards.length }, "Cards restored from persisted runtime state")
    return true
  }

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
    await loadRuntimeState()
    const ok = await loadEvents()
    isBootstrapped = Boolean(ok && cards.length > 0)
    bootstrapError = isBootstrapped ? null : "bootstrap_failed"
    if (isBootstrapped) {
      restoreRuntimeProgress()
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

    socket.emit("content", serializeContent())
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

  socket.emit("content", serializeContent())
  socket.emit("token", token)
  socket.emit("card", cards[player.cardIndex])
  socket.emit("player-meta", serializePlayerMeta(token))
  socket.emit("state", serializeState())
})

function refreshConnectedPlayers() {
  for (const socket of io.sockets.sockets.values()) {
    const token = socket.data?.token
    if (!token) continue
    const player = ensurePlayer(token)
    socket.emit("card", cards[player.cardIndex])
    socket.emit("player-meta", serializePlayerMeta(token))
    socket.emit("state", serializeState())
  }
}

function emitPlayerMetaForToken(playerToken) {
  if (typeof playerToken !== "string" || !playerToken) return
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.token !== playerToken) continue
    socket.emit("player-meta", serializePlayerMeta(playerToken))
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
    gameEnded,
    gameFallbackActive,
    runtimeStateStorageReady,
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
    campaign: serializeCampaign(),
    liveStream: serializeLiveStream(),
    ulule: getUluleStatus(),
    raffle: serializeRaffleSummary(),
    progressByLine: getProgressStatsByLine(),
    winners: serializeWinnerCounts()
  }
}

function normalizeRaffleEmail(value) {
  if (typeof value !== "string") return ""
  return value.trim().toLowerCase()
}

function isUluleConfigured() {
  return Boolean(ULULE_API_KEY && ULULE_PROJECT_ID)
}

function parseMoneyToCents(raw) {
  if (raw === null || raw === undefined || raw === "") return 0

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return 0
    if (!Number.isInteger(raw)) return Math.max(0, Math.round(raw * 100))
    if (raw < 1000) return Math.max(0, raw * 100)
    return Math.max(0, Math.round(raw))
  }

  if (typeof raw === "string") {
    const normalized = raw.trim().replace(",", ".")
    if (!normalized) return 0
    if (normalized.includes(".")) {
      const value = Number(normalized)
      return Number.isFinite(value) ? Math.max(0, Math.round(value * 100)) : 0
    }
    const value = Number(normalized)
    if (!Number.isFinite(value)) return 0
    if (value < 1000) return Math.max(0, Math.round(value * 100))
    return Math.max(0, Math.round(value))
  }

  return 0
}

function parseOrderTotalCents(order) {
  const raw =
    order?.order_total ??
    order?.orderTotal ??
    order?.total ??
    order?.amount_total ??
    order?.amount
  return parseMoneyToCents(raw)
}

function hasOrderReward(order) {
  const items = Array.isArray(order?.items) ? order.items : []
  return items.some((item) => Boolean(item?.reward_id || item?.reward?.id))
}

function parseItemAmountCents(item) {
  const raw =
    item?.price ??
    item?.amount ??
    item?.unit_price ??
    item?.reward?.price ??
    item?.reward?.amount
  return parseMoneyToCents(raw)
}

function hasEligibleReward(order) {
  const items = Array.isArray(order?.items) ? order.items : []
  return items.some((item) => {
    const amountCents = parseItemAmountCents(item)
    const hasReward = Boolean(item?.reward_id || item?.reward?.id || item?.reward?.name || item?.reward?.title)
    return hasReward && amountCents >= ULULE_MIN_CONTRIBUTION_CENTS
  })
}

function findOrderEmail(order) {
  const direct = order?.user?.email || order?.email || order?.backer_email
  if (typeof direct === "string" && direct.trim()) return direct.trim().toLowerCase()
  return ""
}

function normalizeHumanName(value) {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, 80)
}

function firstLetter(value) {
  const normalized = normalizeHumanName(value)
  return normalized ? normalized[0].toUpperCase() : ""
}

function normalizeLastInitial(value) {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  return trimmed[0].toUpperCase()
}

function normalizeCountry(value) {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, 80)
}

function normalizeCity(value) {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, 80)
}

function normalizePostalCode(value) {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, 20)
}

function deriveDepartmentCode(postalCode) {
  const digits = String(postalCode || "").replace(/\D+/g, "")
  if (digits.length < 5) return ""
  if (digits.startsWith("97") || digits.startsWith("98")) return digits.slice(0, 3)
  return digits.slice(0, 2)
}

function extractOrderIdentity(order) {
  const user = order?.user || {}
  const shipping = order?.shipping_address || order?.shippingAddress || {}
  const billing = order?.billing_address || order?.billingAddress || {}

  const firstName =
    normalizeHumanName(shipping?.first_name) ||
    normalizeHumanName(shipping?.firstName) ||
    normalizeHumanName(billing?.first_name) ||
    normalizeHumanName(billing?.firstName) ||
    normalizeHumanName(user?.first_name) ||
    normalizeHumanName(user?.firstName) ||
    normalizeHumanName(order?.first_name) ||
    normalizeHumanName(order?.firstName) ||
    ""

  const lastName =
    normalizeHumanName(shipping?.last_name) ||
    normalizeHumanName(shipping?.lastName) ||
    normalizeHumanName(billing?.last_name) ||
    normalizeHumanName(billing?.lastName) ||
    normalizeHumanName(user?.last_name) ||
    normalizeHumanName(user?.lastName) ||
    normalizeHumanName(order?.last_name) ||
    normalizeHumanName(order?.lastName) ||
    ""

  return {
    firstName,
    lastInitial: firstLetter(lastName)
  }
}

function extractOrderLocation(order) {
  const user = order?.user || {}
  const shipping = order?.shipping_address || order?.shippingAddress || {}
  const billing = order?.billing_address || order?.billingAddress || {}

  const city =
    normalizeCity(shipping?.city) ||
    normalizeCity(billing?.city) ||
    normalizeCity(user?.city) ||
    ""

  const country =
    normalizeCountry(shipping?.country) ||
    normalizeCountry(billing?.country) ||
    normalizeCountry(user?.country) ||
    ""

  const postalCode =
    normalizePostalCode(shipping?.postal_code) ||
    normalizePostalCode(shipping?.postalCode) ||
    normalizePostalCode(shipping?.zip) ||
    normalizePostalCode(billing?.postal_code) ||
    normalizePostalCode(billing?.postalCode) ||
    normalizePostalCode(billing?.zip) ||
    normalizePostalCode(user?.postal_code) ||
    normalizePostalCode(user?.postalCode) ||
    normalizePostalCode(user?.zip) ||
    ""

  return {
    city,
    country,
    departmentCode: deriveDepartmentCode(postalCode)
  }
}

function parseOrderTimestampMs(order) {
  const candidates = [
    order?.payment_completed_at,
    order?.payment_done_at,
    order?.paid_at,
    order?.updated_at,
    order?.created_at
  ]
  for (const candidate of candidates) {
    const value = Date.parse(String(candidate || ""))
    if (Number.isFinite(value)) return value
  }
  return Date.now()
}

function parseNextLink(meta) {
  const next = meta?.next
  if (typeof next !== "string" || !next.trim()) return ""
  return next.trim()
}

function buildUluleStatusUrl(status) {
  return `${ULULE_API_BASE}/projects/${ULULE_PROJECT_ID}/orders?status=${encodeURIComponent(status)}&limit=20&show_anonymous=true`
}

function upsertUluleEligible(order, nowMs) {
  const email = findOrderEmail(order)
  if (!email) return false

  const totalCents = parseOrderTotalCents(order)
  const eligibleReward = hasEligibleReward(order)
  const hasReward = hasOrderReward(order)
  const eligibleByTotal = totalCents >= ULULE_MIN_CONTRIBUTION_CENTS
  const eligible = eligibleByTotal || eligibleReward

  const orderTime = parseOrderTimestampMs(order)
  const identity = extractOrderIdentity(order)
  const location = extractOrderLocation(order)
  const existing = ululeContributionByEmail.get(email)
  const eligibilityReason = eligible
    ? "eligible"
    : totalCents > 0 || hasReward
      ? "amount_below_minimum"
      : "unknown"
  const next = existing
    ? {
        ...existing,
        hasReward: existing.hasReward || eligibleReward || hasReward,
        maxTotalCents: Math.max(existing.maxTotalCents || 0, totalCents),
        eligible: existing.eligible || eligible,
        eligibilityReason: existing.eligible
          ? "eligible"
          : eligible
            ? "eligible"
            : existing.eligibilityReason || eligibilityReason,
        firstName: identity.firstName || existing.firstName || "",
        lastInitial: identity.lastInitial || existing.lastInitial || "",
        city: location.city || existing.city || "",
        country: location.country || existing.country || "",
        departmentCode: location.departmentCode || existing.departmentCode || "",
        lastSeenMs: Math.max(existing.lastSeenMs || 0, orderTime),
        updatedAtMs: nowMs
      }
    : {
        email,
        hasReward: eligibleReward || hasReward,
        maxTotalCents: totalCents,
        eligible,
        eligibilityReason,
        firstName: identity.firstName,
        lastInitial: identity.lastInitial,
        city: location.city,
        country: location.country,
        departmentCode: location.departmentCode,
        lastSeenMs: orderTime,
        updatedAtMs: nowMs
      }
  ululeContributionByEmail.set(email, next)
  return eligible
}

function pruneUluleEligibilityCache(nowMs) {
  const minSeenMs = nowMs - ULULE_LONG_CACHE_DAYS * 24 * 60 * 60 * 1000
  for (const [email, row] of ululeContributionByEmail.entries()) {
    if ((row.lastSeenMs || 0) < minSeenMs) {
      ululeContributionByEmail.delete(email)
    }
  }
}

async function fetchUluleOrdersByStatus(status, sinceMs) {
  const endpointBase = `${ULULE_API_BASE}/projects/${ULULE_PROJECT_ID}/orders`
  const orders = []
  let url = buildUluleStatusUrl(status)

  for (let page = 0; page < ULULE_SYNC_MAX_PAGES && url; page++) {
    const response = await fetch(url, {
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

    const hasRecentOrder = pageOrders.some((order) => parseOrderTimestampMs(order) >= sinceMs)
    if (!hasRecentOrder) break

    const next = parseNextLink(payload?.meta)
    if (!next) break
    if (next.startsWith("http://") || next.startsWith("https://")) {
      url = next
    } else if (next.startsWith("?")) {
      url = `${endpointBase}${next}`
    } else if (next.startsWith("/")) {
      url = `${ULULE_API_BASE}${next}`
    } else {
      url = `${endpointBase}${next}`
    }
  }

  return orders
}

function shouldUseLiveUluleInterval() {
  if (ululeSyncState.liveMode) return true
  if (!ULULE_SYNC_AUTO_LIVE) return false
  return triggered.length > 0 || activationSequence > 0
}

function currentUluleIntervalMs() {
  return shouldUseLiveUluleInterval() ? ULULE_SYNC_INTERVAL_LIVE_MS : ULULE_SYNC_INTERVAL_IDLE_MS
}

function scheduleUluleSync(delayMs = currentUluleIntervalMs()) {
  if (!isUluleConfigured()) return
  if (ululeSyncTimer) clearTimeout(ululeSyncTimer)
  ululeSyncState.nextRunAt = new Date(Date.now() + delayMs).toISOString()
  ululeSyncTimer = setTimeout(async () => {
    await syncUluleDelta({ reason: "scheduled" })
    scheduleUluleSync(currentUluleIntervalMs())
  }, delayMs)
}

async function syncUluleWindow({ reason = "manual", sinceMs } = {}) {
  if (!isUluleConfigured()) return { ok: false, error: "ulule_not_configured" }
  if (ululeSyncState.inProgress) return { ok: false, error: "sync_in_progress" }

  ululeSyncState.inProgress = true
  ululeSyncState.lastReason = reason
  const startedAtMs = Date.now()
  const effectiveSinceMs = Number.isFinite(sinceMs) ? sinceMs : startedAtMs - ULULE_DELTA_HOURS * 60 * 60 * 1000
  let updatedOrders = 0
  try {
    const [doneOrders, completedOrders] = await Promise.all([
      fetchUluleOrdersByStatus("payment-done", effectiveSinceMs),
      fetchUluleOrdersByStatus("payment-completed", effectiveSinceMs)
    ])

    const recentOrders = [...doneOrders, ...completedOrders].filter((order) => parseOrderTimestampMs(order) >= effectiveSinceMs)
    for (const order of recentOrders) {
      if (upsertUluleEligible(order, startedAtMs)) {
        updatedOrders += 1
      }
    }

    pruneUluleEligibilityCache(startedAtMs)
    ululeSyncState.lastSyncAt = new Date(startedAtMs).toISOString()
    ululeSyncState.lastError = null
    ululeSyncState.updatedOrders = updatedOrders
    ululeSyncState.lastDurationMs = Date.now() - startedAtMs
    return { ok: true, updatedOrders, scannedOrders: recentOrders.length }
  } catch (error) {
    ululeSyncState.lastError = String(error?.message || error)
    ululeSyncState.lastDurationMs = Date.now() - startedAtMs
    fastify.log.error({ error }, "Ulule delta sync failed")
    return { ok: false, error: "ulule_sync_failed" }
  } finally {
    ululeSyncState.inProgress = false
  }
}

async function syncUluleDelta({ reason = "manual" } = {}) {
  return syncUluleWindow({
    reason,
    sinceMs: Date.now() - ULULE_DELTA_HOURS * 60 * 60 * 1000
  })
}

async function syncUluleBackfill({ reason = "startup_backfill" } = {}) {
  return syncUluleWindow({
    reason,
    sinceMs: Date.now() - ULULE_LONG_CACHE_DAYS * 24 * 60 * 60 * 1000
  })
}

function getUluleStatus() {
  return {
    configured: isUluleConfigured(),
    liveMode: ululeSyncState.liveMode,
    autoLive: ULULE_SYNC_AUTO_LIVE,
    intervalLiveMs: ULULE_SYNC_INTERVAL_LIVE_MS,
    intervalIdleMs: ULULE_SYNC_INTERVAL_IDLE_MS,
    effectiveIntervalMs: currentUluleIntervalMs(),
    deltaHours: ULULE_DELTA_HOURS,
    longCacheDays: ULULE_LONG_CACHE_DAYS,
    minContributionCents: ULULE_MIN_CONTRIBUTION_CENTS,
    eligibleEmailsCached: [...ululeContributionByEmail.values()].filter((row) => row.eligible).length,
    inProgress: ululeSyncState.inProgress,
    lastSyncAt: ululeSyncState.lastSyncAt,
    lastDurationMs: ululeSyncState.lastDurationMs,
    lastReason: ululeSyncState.lastReason,
    lastError: ululeSyncState.lastError,
    updatedOrders: ululeSyncState.updatedOrders,
    nextRunAt: ululeSyncState.nextRunAt
  }
}

function checkUluleEligibility(email) {
  const normalizedEmail = normalizeRaffleEmail(email)
  if (!normalizedEmail) return { ok: false, error: "invalid_email" }
  if (!isUluleConfigured()) return { ok: false, error: "ulule_not_configured" }

  const cached = ululeContributionByEmail.get(normalizedEmail)
  if (!cached) return { ok: true, eligible: false }

  return {
    ok: true,
    eligible: Boolean(cached.eligible),
    eligibilityReason: cached.eligibilityReason || (cached.eligible ? "eligible" : "unknown"),
    hasReward: Boolean(cached.hasReward),
    orderTotalCents: Number(cached.maxTotalCents || 0),
    firstName: cached.firstName || "",
    lastInitial: cached.lastInitial || "",
    city: cached.city || "",
    country: cached.country || "",
    departmentCode: cached.departmentCode || "",
    lastSeenAt: new Date(cached.lastSeenMs || Date.now()).toISOString(),
    cacheSource: "ulule_delta_cache"
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
    firstName: entry.firstName || "",
    lastInitial: entry.lastInitial || "",
    playerToken: entry.playerToken || "",
    ulule: entry.ulule || null,
    source: entry.source,
    createdAt: entry.createdAt
  }))
  const winnerBase = raffleWinnerByTier[tierIndex]
  const winnerEntry = winnerBase?.id ? entries.find((entry) => entry.id === winnerBase.id) : null
  const winner = winnerEntry ? { ...winnerEntry, selectedAt: winnerBase.selectedAt } : winnerBase
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

function getEnteredTiersForPlayerToken(playerToken) {
  if (typeof playerToken !== "string" || !playerToken) return []
  const enteredTiers = []
  for (let tier = 1; tier <= ROWS; tier++) {
    const entriesMap = raffleEntriesByTier[tier - 1]
    if (!entriesMap) continue
    for (const entry of entriesMap.values()) {
      if (entry.playerToken === playerToken) {
        enteredTiers.push(tier)
        break
      }
    }
  }
  return enteredTiers
}

function serializePlayerMeta(playerToken) {
  return {
    raffleEnteredTiers: getEnteredTiersForPlayerToken(playerToken)
  }
}

function normalizeFirstName(value) {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, 80)
}

function addRaffleEntry({ tier, email, source = "manual", ulule = null, firstName = "", playerToken = "" }) {
  const tierIndex = tier - 1
  const entriesMap = raffleEntriesByTier[tierIndex]
  const normalizedEmail = normalizeRaffleEmail(email)
  if (!normalizedEmail) return { ok: false, error: "invalid_email" }

  for (const existing of entriesMap.values()) {
    if (existing.email === normalizedEmail) {
      return { ok: true, duplicated: true, entry: existing }
    }
  }

  const entry = {
    id: `r${raffleEntrySeq++}`,
    email: normalizedEmail,
    firstName: normalizeFirstName(firstName) || normalizeFirstName(ulule?.firstName),
    lastInitial: normalizeLastInitial(ulule?.lastInitial),
    playerToken: typeof playerToken === "string" ? playerToken.slice(0, 120) : "",
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

fastify.get("/api/backend-bruno/debug", { preHandler: requireAdmin }, async () => {
  return getDebugState()
})

fastify.get("/api/backend-bruno/content", { preHandler: requireAdmin }, async () => {
  return {
    ok: true,
    persisted: contentStorageReady,
    content: serializeContent()
  }
})

fastify.get("/api/branding", async () => {
  return {
    ok: true,
    branding: serializeBranding()
  }
})

fastify.patch("/api/backend-bruno/content", { preHandler: requireAdmin }, async (req, reply) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : null
  if (!entries) {
    reply.code(400)
    return { ok: false, error: "invalid_entries" }
  }

  const result = await saveEditableContent(entries)
  io.emit("content", serializeContent())
  return {
    ok: true,
    persisted: Boolean(result.persisted),
    warning: result.warning || null,
    content: serializeContent()
  }
})

fastify.patch("/api/backend-bruno/campaign-end", { preHandler: requireAdmin }, async (req, reply) => {
  const endAt = req.body?.endAt
  if (endAt === null || endAt === "") {
    campaignEndAtMs = null
    await saveRuntimeState()
    io.emit("state", serializeState())
    return { ok: true, campaign: serializeCampaign() }
  }

  if (typeof endAt !== "string") {
    reply.code(400)
    return { ok: false, error: "invalid_end_at" }
  }

  const parsed = Date.parse(endAt)
  if (!Number.isFinite(parsed)) {
    reply.code(400)
    return { ok: false, error: "invalid_end_at" }
  }

  campaignEndAtMs = parsed
  await saveRuntimeState()
  io.emit("state", serializeState())
  return { ok: true, campaign: serializeCampaign() }
})

fastify.patch("/api/backend-bruno/live-stream", { preHandler: requireAdmin }, async (req, reply) => {
  const url = req.body?.url
  const ululeUrl = req.body?.ululeUrl

  if ((url === null || url === "") && (ululeUrl === undefined || ululeUrl === null || ululeUrl === "")) {
    liveStreamUrl = ""
    ululePageUrl = ""
    await saveRuntimeState()
    io.emit("state", serializeState())
    return { ok: true, liveStream: serializeLiveStream() }
  }

  if (url !== undefined && url !== null && typeof url !== "string") {
    reply.code(400)
    return { ok: false, error: "invalid_url" }
  }

  if (ululeUrl !== undefined && ululeUrl !== null && typeof ululeUrl !== "string") {
    reply.code(400)
    return { ok: false, error: "invalid_ulule_url" }
  }

  const normalized = typeof url === "string" ? url.trim() : liveStreamUrl
  const normalizedUlule = typeof ululeUrl === "string" ? ululeUrl.trim() : ululePageUrl

  if (normalized && !normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    reply.code(400)
    return { ok: false, error: "invalid_url" }
  }

  if (normalizedUlule && !normalizedUlule.startsWith("http://") && !normalizedUlule.startsWith("https://")) {
    reply.code(400)
    return { ok: false, error: "invalid_ulule_url" }
  }

  liveStreamUrl = normalized
  ululePageUrl = normalizedUlule
  await saveRuntimeState()
  io.emit("state", serializeState())
  return { ok: true, liveStream: serializeLiveStream() }
})

fastify.get("/api/backend-bruno/ulule/status", { preHandler: requireAdmin }, async () => {
  return { ok: true, ulule: getUluleStatus() }
})

fastify.post("/api/backend-bruno/ulule/live-mode", { preHandler: requireAdmin }, async (req, reply) => {
  if (typeof req.body?.enabled !== "boolean") {
    reply.code(400)
    return { ok: false, error: "invalid_enabled" }
  }
  ululeSyncState.liveMode = req.body.enabled
  scheduleUluleSync(250)
  return { ok: true, ulule: getUluleStatus() }
})

fastify.post("/api/backend-bruno/ulule/sync-now", { preHandler: requireAdmin }, async () => {
  const result = await syncUluleDelta({ reason: "manual" })
  scheduleUluleSync(currentUluleIntervalMs())
  return {
    ok: Boolean(result.ok),
    result,
    ulule: getUluleStatus()
  }
})

fastify.get("/api/backend-bruno/events", { preHandler: requireAdmin }, async () => {
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

fastify.get("/api/backend-bruno/bootstrap", { preHandler: requireAdmin }, async () => {
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

fastify.get("/api/backend-bruno/activation-log", { preHandler: requireAdmin }, async (req, reply) => {
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

fastify.post("/api/backend-bruno/reload", { preHandler: requireAdmin }, async () => {
  const ok = await bootstrapGameData()
  if (!ok) {
    return {
      ok: false,
      error: "reload_failed"
    }
  }
  await saveRuntimeState()
  refreshConnectedPlayers()
  return {
    ok: true,
    debug: getDebugState()
  }
})

fastify.patch("/api/backend-bruno/board", { preHandler: requireAdmin }, async (req, reply) => {
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
  await saveRuntimeState()
  refreshConnectedPlayers()

  return { ok: true, board: serializeBoardConfig(), gameVersion }
})

fastify.post("/api/backend-bruno/target-tier", { preHandler: requireAdmin }, async (req, reply) => {
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
  await saveRuntimeState()
  io.emit("state", serializeState())
  return { ok: true, debug: getDebugState() }
})

fastify.post("/api/backend-bruno/game-ended", { preHandler: requireAdmin }, async (req, reply) => {
  if (typeof req.body?.ended !== "boolean") {
    reply.code(400)
    return { ok: false, error: "invalid_ended" }
  }
  gameEnded = req.body.ended
  await saveRuntimeState()
  io.emit("state", serializeState())
  return { ok: true, debug: getDebugState(), state: serializeState() }
})

fastify.post("/api/backend-bruno/game-fallback", { preHandler: requireAdmin }, async (req, reply) => {
  if (typeof req.body?.active !== "boolean") {
    reply.code(400)
    return { ok: false, error: "invalid_active" }
  }
  gameFallbackActive = req.body.active
  await saveRuntimeState()
  io.emit("state", serializeState())
  return { ok: true, debug: getDebugState(), state: serializeState() }
})

fastify.get("/api/backend-bruno/raffle", { preHandler: requireAdmin }, async (req, reply) => {
  const tier = parseTierInput(req.query?.tier)
  if (!tier) {
    reply.code(400)
    return { ok: false, error: "invalid_tier", min: 1, max: ROWS }
  }
  return { ok: true, ...serializeRaffleTier(tier) }
})

fastify.post("/api/backend-bruno/raffle/enter", { preHandler: requireAdmin }, async (req, reply) => {
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
    return {
      ok: false,
      error: ululeCheck.eligibilityReason === "amount_below_minimum" ? "contribution_too_low" : "not_ulule_eligible",
      nextSyncAt: ululeSyncState.nextRunAt
    }
  }

  const outcome = addRaffleEntry({
    tier,
    email: req.body?.email,
    source: "manual",
    firstName: req.body?.firstName,
    playerToken: req.body?.token,
    ulule: {
      verifiedAt: new Date().toISOString(),
      hasReward: Boolean(ululeCheck.hasReward),
      orderTotalCents: Number(ululeCheck.orderTotalCents || 0),
      firstName: ululeCheck.firstName || "",
      lastInitial: ululeCheck.lastInitial || "",
      city: ululeCheck.city || "",
      country: ululeCheck.country || "",
      departmentCode: ululeCheck.departmentCode || ""
    }
  })

  if (!outcome.ok) {
    reply.code(400)
    return outcome
  }

  await saveRuntimeState()
  emitPlayerMetaForToken(req.body?.token)
  return {
    ok: true,
    duplicated: Boolean(outcome.duplicated),
    entry: outcome.entry,
    raffle: serializeRaffleTier(tier)
  }
})

fastify.post("/api/raffle/enter", async (req, reply) => {
  const tier = parseTierInput(req.body?.tier)
  if (!tier) {
    reply.code(400)
    return { ok: false, error: "invalid_tier", min: 1, max: ROWS }
  }

  const firstName = normalizeFirstName(req.body?.firstName)
  const email = normalizeRaffleEmail(req.body?.email)
  const playerToken = typeof req.body?.token === "string" ? req.body.token : ""

  if (!firstName || !email) {
    reply.code(400)
    return { ok: false, error: "missing_fields" }
  }

  const tierWinners = winners[tier - 1]
  if (!tierWinners || !tierWinners.has(playerToken)) {
    reply.code(403)
    return { ok: false, error: "not_qualified_for_tier" }
  }

  const ululeCheck = checkUluleEligibility(email)
  if (!ululeCheck.ok) {
    reply.code(500)
    return { ok: false, error: ululeCheck.error || "ulule_check_failed" }
  }
  if (!ululeCheck.eligible) {
    reply.code(400)
    return {
      ok: false,
      error: ululeCheck.eligibilityReason === "amount_below_minimum" ? "contribution_too_low" : "not_ulule_eligible",
      nextSyncAt: ululeSyncState.nextRunAt
    }
  }

  const outcome = addRaffleEntry({
    tier,
    email,
    firstName,
    playerToken,
    source: "player",
    ulule: {
      verifiedAt: new Date().toISOString(),
      hasReward: Boolean(ululeCheck.hasReward),
      orderTotalCents: Number(ululeCheck.orderTotalCents || 0),
      firstName: ululeCheck.firstName || "",
      lastInitial: ululeCheck.lastInitial || "",
      city: ululeCheck.city || "",
      country: ululeCheck.country || "",
      departmentCode: ululeCheck.departmentCode || ""
    }
  })

  if (!outcome.ok) {
    reply.code(400)
    return { ok: false, error: outcome.error || "enter_failed" }
  }

  await saveRuntimeState()
  emitPlayerMetaForToken(playerToken)
  return {
    ok: true,
    duplicated: Boolean(outcome.duplicated),
    entry: outcome.entry
  }
})

fastify.post("/api/backend-bruno/raffle/mock", { preHandler: requireAdmin }, async (req, reply) => {
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

  await saveRuntimeState()
  return {
    ok: true,
    added,
    raffle: serializeRaffleTier(tier)
  }
})

fastify.post("/api/backend-bruno/raffle/draw", { preHandler: requireAdmin }, async (req, reply) => {
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

  const selected = entries[Math.floor(Math.random() * entries.length)]
  const winner = {
    id: selected.id,
    email: selected.email,
    selectedAt: new Date().toISOString()
  }
  raffleWinnerByTier[tierIndex] = winner

  await saveRuntimeState()
  return {
    ok: true,
    winner,
    raffle: serializeRaffleTier(tier)
  }
})

fastify.post("/api/backend-bruno/reset-round", { preHandler: requireAdmin }, async () => {
  clearRoundProgress()
  await saveRuntimeState()
  io.emit("state", serializeState())
  return { ok: true }
})

fastify.post("/api/backend-bruno/events", { preHandler: requireAdmin }, async (req, reply) => {
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

  await saveRuntimeState()
  refreshConnectedPlayers()
  return { ok: true, gameReset: true }
})

fastify.post("/api/backend-bruno/events/bulk", { preHandler: requireAdmin }, async (req, reply) => {
  const category = normalizeCategory(req.body?.category)
  const isMandatory = Boolean(req.body?.is_mandatory)
  const rawNames = Array.isArray(req.body?.names) ? req.body.names : []

  const normalizedNames = [...new Set(
    rawNames
      .filter((name) => typeof name === "string")
      .map((name) => name.trim())
      .filter((name) => name && name.length <= 120)
  )]

  if (normalizedNames.length === 0) {
    reply.code(400)
    return { ok: false, error: "invalid_names" }
  }

  const existingNames = new Set(events.map((event) => event.name.toLowerCase()))
  const rows = normalizedNames
    .filter((name) => !existingNames.has(name.toLowerCase()))
    .map((name) => ({ name, category, is_mandatory: isMandatory }))

  if (rows.length === 0) {
    return { ok: true, inserted: 0, skipped: normalizedNames.length, gameReset: false }
  }

  const { error } = await supabase.from("events").insert(rows)
  if (error) {
    fastify.log.error({ error }, "Error creating bulk events")
    reply.code(500)
    return { ok: false, error: "bulk_create_failed", details: error.message }
  }

  const ok = await loadEvents()
  if (!ok) {
    reply.code(500)
    return { ok: false, error: "reload_failed" }
  }

  await saveRuntimeState()
  refreshConnectedPlayers()
  return {
    ok: true,
    inserted: rows.length,
    skipped: normalizedNames.length - rows.length,
    gameReset: true
  }
})

fastify.patch("/api/backend-bruno/events/:id", { preHandler: requireAdmin }, async (req, reply) => {
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

    await saveRuntimeState()
    refreshConnectedPlayers()
    return { ok: true, gameReset: true }
  }

  // Category-only update: keep current round state and cards untouched.
  events = events.map((event) => (event.id === id ? { ...event, ...updates } : event))
  return { ok: true, gameReset: false }
})

fastify.delete("/api/backend-bruno/events/:id", { preHandler: requireAdmin }, async (req, reply) => {
  const id = Number(req.params?.id)
  if (!Number.isInteger(id) || id <= 0) {
    reply.code(400)
    return { ok: false, error: "invalid_id" }
  }

  const eventRow = events.find((event) => event.id === id)
  if (!eventRow) {
    reply.code(404)
    return { ok: false, error: "not_found" }
  }

  const { error } = await supabase.from("events").delete().eq("id", id)
  if (error) {
    fastify.log.error({ error }, "Error deleting event")
    reply.code(500)
    return { ok: false, error: "delete_failed", details: error.message }
  }

  const ok = await loadEvents()
  if (!ok) {
    reply.code(500)
    return { ok: false, error: "reload_failed" }
  }

  await saveRuntimeState()
  refreshConnectedPlayers()
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

  await saveRuntimeState()
  io.emit("state", serializeState())
  return { ok: true }
}

fastify.post("/api/backend-bruno/trigger", { preHandler: requireAdmin }, handleTrigger)

fastify.post("/api/backend-bruno/events/:id/toggle", { preHandler: requireAdmin }, async (req, reply) => {
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

  await saveRuntimeState()
  io.emit("state", serializeState())
  return { ok: true, state: serializeState(), debug: getDebugState() }
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
    await loadEditableContent()
    await fastify.listen({ port, host: "0.0.0.0" })
    fastify.log.info({ port }, "Server listening")

    // Non-blocking boot to reduce cold-start wait on first HTTP response.
    bootstrapGameData()
    if (isUluleConfigured()) {
      scheduleUluleSync(1000)
      syncUluleBackfill({ reason: "startup" })
    } else {
      fastify.log.warn("Ulule sync disabled: ULULE_API_KEY or ULULE_PROJECT_ID missing")
    }
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
