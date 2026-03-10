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
let raffleWinnerByTier = Array.from({ length: ROWS }, () => [])
let raffleWonEmails = new Set()
let raffleEntrySeq = 1
let raffleQuotaByTier = Array.from({ length: ROWS }, (_, index) => defaultRaffleQuota(index + 1, ROWS))
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
let ululeOrderLedger = new Map()
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
let uiSettingsStorageReady = false
const MAX_ADMIN_LOG = Number(process.env.MAX_ADMIN_LOG || 300)
let adminActionLog = []
let milestoneWinnersPerWindow = 1
let milestoneWinnersByWindow = new Map()
let milestoneWonEmails = new Set()
let collectiveChallenges = []
let activeCollectiveChallenge = null
let collectiveChallengeTimer = null
const DEFAULT_TEXT_CONTENT = {
  "brand.logo_src": "",
  "player.title": "Bingo Live",
  "player.subtitle": "Campagne en direct",
  "player.loading_card": "Chargement de la carte...",
  "player.game_ended_title": "Jeu terminé",
  "player.game_ended_body": "Merci à tous pour votre participation.",
  "player.fallback_title": "Jeu indisponible",
  "player.fallback_body": "En raison de problèmes techniques, nous ne sommes malheureusement pas en mesure de pouvoir vous proposer ce jeu. Nous vous remercions toutefois pour votre participation. À très vite.",
  "player.no_cards_generated": "Initialisation du bingo en cours, réessaie dans quelques secondes.",
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
  "player.mobile_card_font_weight": "500",
  "player.raffle_button": "Participer au tirage au sort",
  "player.raffle_registered_banner": "Ta participation au tirage au sort est bien prise en compte.",
  "player.raffle_registered_status": "Tu participes au tirage au sort.",
  "player.current_reward_label": "À gagner",
  "player.cell_validated_badge": "Validé",
  "player.progress_ready": "Éligible au tirage",
  "player.progress_closed": "Tirage terminé",
  "player.progress_waiting_round": "En attente de cette manche",
  "player.progress_missing": "Il manque {missing} case{plural}",
  "player.qualified_banner": "Tu as complété {label}. Tu peux participer au tirage au sort.",
  "player.modal_title": "Participer au tirage",
  "player.modal_body": "Tu es qualifié pour {label}. Renseigne le prénom et l'adresse e-mail utilisée pour ta contribution Ulule. Pour participer, cette contribution ou ce don doit être d'au moins 10 EUR.",
  "player.modal_first_name": "Prénom",
  "player.modal_email": "E-mail utilisé sur Ulule",
  "player.modal_close": "Fermer",
  "player.modal_submit": "Valider ma participation",
  "player.modal_submit_loading": "Vérification...",
  "player.error_missing_fields": "Merci de remplir ton prénom et l'e-mail utilisé pour ta contribution Ulule.",
  "player.error_not_ulule_eligible": "Aucune contribution éligible n'a été trouvée pour cet e-mail sur Ulule. Vérifie que l'e-mail est correct, ou contribue avec cet e-mail avec une contrepartie ou un don d'au moins 10 EUR.",
  "player.error_contribution_too_low": "Une contribution existe bien pour cet e-mail sur Ulule, mais son montant est inférieur à 10 EUR. Pour participer au tirage, la contribution ou le don doit être d'au moins 10 EUR.",
  "player.error_not_qualified": "Ta qualification n'est plus active pour ce palier.",
  "player.error_generic": "Erreur : {error}",
  "player.success_duplicate": "E-mail déjà inscrit pour ce palier.",
  "player.success_validated": "Inscription au tirage validée.",
  "overlay.title": "Progression Bingo Live",
  "overlay.events": "Événements : {current}/{total}",
  "overlay.players": "Joueurs : {count}",
  "overlay.tier_done": "Gagné",
  "overlay.tier_pending": "En attente",
  "overlay.next_tier": "Prochain palier : {label}",
  "overlay.all_done": "Tous les paliers sont gagnés",
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
const DEFAULT_UI_SETTINGS = {
  playerDensityMode: "lisible",
  playerFullscreenMode: false,
  playerMobileLayout: "text"
}
let uiSettings = { ...DEFAULT_UI_SETTINGS }

function boardSize() {
  return ROWS * COLS
}

function defaultRaffleQuota(tier, rows) {
  if (tier === rows) return 1
  if (rows >= 5 && tier === rows - 1) return 2
  if (tier === 1) return 10
  if (tier === 2) return 5
  if (tier === 3) return 3
  return 1
}

function createWinnerTiers() {
  return Array.from({ length: ROWS }, () => new Set())
}

function createRaffleStore() {
  return {
    entriesByTier: Array.from({ length: ROWS }, () => new Map()),
    winnerByTier: Array.from({ length: ROWS }, () => [])
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

function normalizeChallengeType(value) {
  return value === "eligible_streak" ? value : "eligible_streak"
}

function sanitizeChallengeLabel(value) {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, 120)
}

function normalizeChallengeDefinitions(input) {
  if (!Array.isArray(input)) return []
  return input
    .filter((row) => row && typeof row.id === "string")
    .map((row) => ({
      id: row.id,
      label: sanitizeChallengeLabel(row.label),
      type: normalizeChallengeType(row.type),
      targetCount: Math.min(Math.max(1, Number(row.targetCount || 1)), 100),
      durationSeconds: Math.min(Math.max(30, Number(row.durationSeconds || 300)), 60 * 60),
      createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString()
    }))
    .filter((row) => row.label)
}

function normalizeActiveCollectiveChallenge(input) {
  if (!input || typeof input !== "object" || typeof input.id !== "string") return null
  const startedAt = typeof input.startedAt === "string" ? input.startedAt : new Date().toISOString()
  const endsAt = typeof input.endsAt === "string" ? input.endsAt : new Date(Date.now() + 5 * 60 * 1000).toISOString()
  return {
    id: input.id,
    definitionId: typeof input.definitionId === "string" ? input.definitionId : "",
    label: sanitizeChallengeLabel(input.label),
    type: normalizeChallengeType(input.type),
    targetCount: Math.min(Math.max(1, Number(input.targetCount || 1)), 100),
    durationSeconds: Math.min(Math.max(30, Number(input.durationSeconds || 300)), 60 * 60),
    startedAt,
    endsAt,
    status: input.status === "completed" || input.status === "expired" || input.status === "stopped" ? input.status : "running",
    progress: Math.max(0, Number(input.progress || 0)),
    currentStreak: Math.max(0, Number(input.currentStreak || 0)),
    lastOrderId: typeof input.lastOrderId === "string" ? input.lastOrderId : "",
    lastOrderAt: typeof input.lastOrderAt === "string" ? input.lastOrderAt : "",
    completedAt: typeof input.completedAt === "string" ? input.completedAt : "",
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : startedAt
  }
}

function formatChallengeCountdown(endsAt) {
  const endsAtMs = Date.parse(endsAt || "")
  if (!Number.isFinite(endsAtMs)) return 0
  return Math.max(0, endsAtMs - Date.now())
}

function getSortedUluleOrders() {
  return [...ululeOrderLedger.values()].sort((a, b) => {
    const left = Date.parse(a.paidAt || "") || 0
    const right = Date.parse(b.paidAt || "") || 0
    if (left !== right) return left - right
    return String(a.id || "").localeCompare(String(b.id || ""))
  })
}

function serializeCollectiveChallengePublic() {
  const challenge = normalizeActiveCollectiveChallenge(activeCollectiveChallenge)
  if (!challenge) return null
  if (challenge.status === "expired" || challenge.status === "stopped") return null
  return {
    id: challenge.id,
    label: challenge.label,
    type: challenge.type,
    status: challenge.status,
    targetCount: challenge.targetCount,
    durationSeconds: challenge.durationSeconds,
    progress: challenge.progress,
    currentStreak: challenge.currentStreak,
    startedAt: challenge.startedAt,
    endsAt: challenge.endsAt,
    remainingMs: formatChallengeCountdown(challenge.endsAt),
    completedAt: challenge.completedAt || null
  }
}

function serializeCollectiveChallengesAdmin() {
  return {
    definitions: collectiveChallenges,
    active: activeCollectiveChallenge
      ? {
          ...activeCollectiveChallenge,
          remainingMs: formatChallengeCountdown(activeCollectiveChallenge.endsAt)
        }
      : null
  }
}

function clearCollectiveChallengeTimer() {
  if (collectiveChallengeTimer) {
    clearTimeout(collectiveChallengeTimer)
    collectiveChallengeTimer = null
  }
}

function scheduleCollectiveChallengeTimer() {
  clearCollectiveChallengeTimer()
  if (!activeCollectiveChallenge || activeCollectiveChallenge.status !== "running") return
  const remainingMs = formatChallengeCountdown(activeCollectiveChallenge.endsAt)
  if (remainingMs <= 0) return
  collectiveChallengeTimer = setTimeout(() => {
    const changed = evaluateActiveCollectiveChallenge({ reason: "timeout" })
    if (changed) {
      io.emit("state", serializeState())
    }
  }, remainingMs + 20)
}

function evaluateActiveCollectiveChallenge({ reason = "sync" } = {}) {
  if (!activeCollectiveChallenge) return false
  let changed = false
  const challenge = { ...activeCollectiveChallenge }
  const now = Date.now()
  const startedAtMs = Date.parse(challenge.startedAt || "")
  const endsAtMs = Date.parse(challenge.endsAt || "")
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endsAtMs)) return false

  if (challenge.status === "running") {
    const relevantOrders = getSortedUluleOrders().filter((order) => {
      const paidAtMs = Date.parse(order.paidAt || "")
      return Number.isFinite(paidAtMs) && paidAtMs >= startedAtMs && paidAtMs <= Math.min(now, endsAtMs)
    })

    let streak = 0
    let lastOrderId = ""
    let lastOrderAt = ""
    for (const order of relevantOrders) {
      lastOrderId = order.id || ""
      lastOrderAt = order.paidAt || ""
      if (challenge.type === "eligible_streak") {
        streak = order.eligible ? streak + 1 : 0
      }
    }

    if (challenge.currentStreak !== streak) {
      challenge.currentStreak = streak
      challenge.progress = streak
      changed = true
    }
    if (challenge.lastOrderId !== lastOrderId || challenge.lastOrderAt !== lastOrderAt) {
      challenge.lastOrderId = lastOrderId
      challenge.lastOrderAt = lastOrderAt
      changed = true
    }

    if (challenge.currentStreak >= challenge.targetCount) {
      challenge.status = "completed"
      challenge.completedAt = new Date().toISOString()
      changed = true
      pushAdminLog("collective_challenge_completed", { id: challenge.id, label: challenge.label, reason })
    } else if (now >= endsAtMs) {
      challenge.status = "expired"
      changed = true
      pushAdminLog("collective_challenge_expired", { id: challenge.id, label: challenge.label, reason })
    }
  }

  if (changed) {
    challenge.updatedAt = new Date().toISOString()
    activeCollectiveChallenge = challenge
    scheduleRuntimeStateSave(50)
  }
  scheduleCollectiveChallengeTimer()
  return changed
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
    collectiveChallenge: serializeCollectiveChallengePublic(),
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

function normalizeDensityMode(value) {
  if (value === "compact" || value === "lisible" || value === "geant") return value
  return DEFAULT_UI_SETTINGS.playerDensityMode
}

function normalizePlayerMobileLayout(value) {
  if (value === "numbers" || value === "text") return value
  return DEFAULT_UI_SETTINGS.playerMobileLayout
}

function serializeUiSettings() {
  return {
    playerDensityMode: normalizeDensityMode(uiSettings.playerDensityMode),
    playerFullscreenMode: Boolean(uiSettings.playerFullscreenMode),
    playerMobileLayout: normalizePlayerMobileLayout(uiSettings.playerMobileLayout)
  }
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

async function loadUiSettings() {
  const { data, error } = await supabase.from("app_ui_settings").select("setting_key, setting_value")
  if (error) {
    fastify.log.warn({ error }, "UI settings table unavailable, using defaults")
    uiSettings = { ...DEFAULT_UI_SETTINGS }
    uiSettingsStorageReady = false
    return false
  }

  const next = { ...DEFAULT_UI_SETTINGS }
  for (const row of data || []) {
    if (row?.setting_key === "playerDensityMode") {
      next.playerDensityMode = normalizeDensityMode(row.setting_value)
    }
    if (row?.setting_key === "playerFullscreenMode") {
      next.playerFullscreenMode = Boolean(row.setting_value)
    }
    if (row?.setting_key === "playerMobileLayout") {
      next.playerMobileLayout = normalizePlayerMobileLayout(row.setting_value)
    }
  }
  uiSettings = next
  uiSettingsStorageReady = true
  return true
}

async function saveUiSettings(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: true, persisted: uiSettingsStorageReady, settings: serializeUiSettings() }
  }

  const next = { ...serializeUiSettings() }
  const rows = []
  for (const entry of entries) {
    if (!entry || typeof entry.key !== "string") continue
    if (entry.key === "playerDensityMode") {
      next.playerDensityMode = normalizeDensityMode(entry.value)
      rows.push({ setting_key: "playerDensityMode", setting_value: next.playerDensityMode })
    }
    if (entry.key === "playerFullscreenMode") {
      next.playerFullscreenMode = Boolean(entry.value)
      rows.push({ setting_key: "playerFullscreenMode", setting_value: next.playerFullscreenMode })
    }
    if (entry.key === "playerMobileLayout") {
      next.playerMobileLayout = normalizePlayerMobileLayout(entry.value)
      rows.push({ setting_key: "playerMobileLayout", setting_value: next.playerMobileLayout })
    }
  }

  uiSettings = next
  if (rows.length === 0) {
    return { ok: true, persisted: uiSettingsStorageReady, settings: serializeUiSettings() }
  }

  const { error } = await supabase.from("app_ui_settings").upsert(rows, { onConflict: "setting_key" })
  if (error) {
    fastify.log.warn({ error }, "UI settings save fallback to memory only")
    uiSettingsStorageReady = false
    return { ok: true, persisted: false, warning: "storage_unavailable", settings: serializeUiSettings() }
  }

  uiSettingsStorageReady = true
  return { ok: true, persisted: true, settings: serializeUiSettings() }
}

function getConnectedPlayerCount() {
  let count = 0
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.token) count += 1
  }
  return count
}

function pushAdminLog(action, details = {}) {
  adminActionLog.push({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    details,
    createdAt: new Date().toISOString()
  })
  if (adminActionLog.length > MAX_ADMIN_LOG) {
    adminActionLog = adminActionLog.slice(adminActionLog.length - MAX_ADMIN_LOG)
  }
  if (cards.length > 0) {
    scheduleRuntimeStateSave(50)
  }
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
    adminActionLog,
    activationCountByEvent: Object.fromEntries(activationCountByEvent.entries()),
    milestoneWinnersPerWindow,
    milestoneWonEmails: [...milestoneWonEmails],
    milestoneWinnersByWindow: [...milestoneWinnersByWindow.entries()],
    collectiveChallenges,
    activeCollectiveChallenge,
    ululeOrderLedger: [...ululeOrderLedger.values()],
    raffleEntrySeq,
    raffleQuotaByTier,
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

function normalizeMilestoneWinners(input) {
  const map = new Map()
  if (!Array.isArray(input)) return map
  for (const row of input) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !Array.isArray(row[1])) continue
    map.set(
      row[0],
      row[1]
        .filter((item) => item && typeof item.id === "string" && typeof item.email === "string")
        .map((item) => ({
          id: item.id,
          email: normalizeRaffleEmail(item.email),
          firstName: normalizeFirstName(item.firstName),
          lastInitial: normalizeLastInitial(item.lastInitial),
          city: normalizeCity(item.city),
          country: normalizeCountry(item.country),
          departmentCode: typeof item.departmentCode === "string" ? item.departmentCode.trim().slice(0, 12) : "",
          amountCents: Math.max(0, Number(item.amountCents || 0)),
          orderId: typeof item.orderId === "string" ? item.orderId : "",
          paidAt: typeof item.paidAt === "string" ? item.paidAt : "",
          selectedAt: typeof item.selectedAt === "string" ? item.selectedAt : new Date().toISOString()
        }))
    )
  }
  return map
}

function normalizeUluleOrderLedger(input) {
  const map = new Map()
  if (!Array.isArray(input)) return map
  for (const row of input) {
    if (!row || typeof row.id !== "string") continue
    map.set(row.id, {
      id: row.id,
      email: normalizeRaffleEmail(row.email),
      totalCents: Math.max(0, Number(row.totalCents || 0)),
      eligible: Boolean(row.eligible),
      hasReward: Boolean(row.hasReward),
      firstName: normalizeFirstName(row.firstName),
      lastInitial: normalizeLastInitial(row.lastInitial),
      city: normalizeCity(row.city),
      country: normalizeCountry(row.country),
      departmentCode: typeof row.departmentCode === "string" ? row.departmentCode.trim().slice(0, 12) : "",
      paidAt: typeof row.paidAt === "string" ? row.paidAt : new Date().toISOString()
    })
  }
  return map
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
  adminActionLog = Array.isArray(stateValue.adminActionLog)
    ? stateValue.adminActionLog
        .filter((item) => item && typeof item.action === "string")
        .slice(-MAX_ADMIN_LOG)
    : []
  milestoneWinnersPerWindow = Number.isInteger(Number(stateValue.milestoneWinnersPerWindow))
    ? Math.min(Math.max(1, Number(stateValue.milestoneWinnersPerWindow)), 50)
    : 1
  collectiveChallenges = normalizeChallengeDefinitions(stateValue.collectiveChallenges)
  activeCollectiveChallenge = normalizeActiveCollectiveChallenge(stateValue.activeCollectiveChallenge)
  milestoneWonEmails = new Set(
    Array.isArray(stateValue.milestoneWonEmails)
      ? stateValue.milestoneWonEmails.map((email) => normalizeRaffleEmail(email)).filter(Boolean)
      : []
  )
  milestoneWinnersByWindow = normalizeMilestoneWinners(stateValue.milestoneWinnersByWindow)
  ululeOrderLedger = normalizeUluleOrderLedger(stateValue.ululeOrderLedger)

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
    const rows = Array.isArray(stateValue.raffleWinnerByTier?.[index]) ? stateValue.raffleWinnerByTier[index] : []
    return rows
      .filter((row) => row && typeof row.id === "string" && typeof row.email === "string")
      .map((row) => ({
        id: row.id,
        email: normalizeRaffleEmail(row.email),
        playerToken: typeof row.playerToken === "string" ? row.playerToken.slice(0, 120) : "",
        firstName: normalizeFirstName(row.firstName),
        lastInitial: normalizeLastInitial(row.lastInitial),
        ulule: row.ulule && typeof row.ulule === "object" ? row.ulule : null,
        selectedAt: typeof row.selectedAt === "string" ? row.selectedAt : new Date().toISOString()
      }))
  })
  raffleWonEmails = new Set(
    Array.isArray(stateValue.raffleWonEmails)
      ? stateValue.raffleWonEmails.map((email) => normalizeRaffleEmail(email)).filter(Boolean)
      : []
  )
  raffleEntrySeq = Number.isInteger(Number(stateValue.raffleEntrySeq)) ? Math.max(1, Number(stateValue.raffleEntrySeq)) : 1
  raffleQuotaByTier = Array.from({ length: ROWS }, (_, index) => {
    const raw = Array.isArray(stateValue.raffleQuotaByTier) ? Number(stateValue.raffleQuotaByTier[index]) : NaN
    return Number.isInteger(raw) && raw >= 1 ? raw : defaultRaffleQuota(index + 1, ROWS)
  })
  evaluateActiveCollectiveChallenge({ reason: "restore" })
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
  raffleQuotaByTier = Array.from({ length: ROWS }, (_, index) => defaultRaffleQuota(index + 1, ROWS))
  activationSequence = 0
  activationLog = []
  adminActionLog = []
  activationCountByEvent = new Map()
  activeCollectiveChallenge = null
  clearCollectiveChallengeTimer()
  markProgressStatsDirty()
  gameVersion += 1
}

function clearRoundProgress() {
  const previousQuotas = [...raffleQuotaByTier]
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
  raffleQuotaByTier = Array.from({ length: ROWS }, (_, index) => {
    const value = Number(previousQuotas[index])
    return Number.isInteger(value) && value >= 1 ? value : defaultRaffleQuota(index + 1, ROWS)
  })
  activationSequence = 0
  activationLog = []
  adminActionLog = []
  activationCountByEvent = new Map()
  markProgressStatsDirty()
}

function resetLiveRuntime({ preserveQuotas = true, regenerateCards = true } = {}) {
  const previousQuotas = preserveQuotas ? [...raffleQuotaByTier] : null
  resetGameState()
  if (previousQuotas && previousQuotas.length === ROWS) {
    raffleQuotaByTier = Array.from({ length: ROWS }, (_, index) => {
      const value = Number(previousQuotas[index])
      return Number.isInteger(value) && value >= 1 ? value : defaultRaffleQuota(index + 1, ROWS)
    })
  }
  gameEnded = false
  gameFallbackActive = false
  if (regenerateCards) {
    const generated = generateCards()
    if (!generated) return false
  }
  return true
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
    await loadUiSettings()
    const ok = await loadEvents()
    isBootstrapped = Boolean(ok && cards.length > 0)
    bootstrapError = isBootstrapped ? null : "bootstrap_failed"
    if (isBootstrapped) {
      restoreRuntimeProgress()
      refreshConnectedPlayers()
      io.emit("ui-settings", serializeUiSettings())
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
    socket.emit("ui-settings", serializeUiSettings())
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
  socket.emit("ui-settings", serializeUiSettings())
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
    uiSettingsStorageReady,
    ...serializeBoardConfig(),
    events: eventNames.length,
    mandatory,
    cards: cards.length,
    players: players.size,
    connectedPlayers: getConnectedPlayerCount(),
    triggered: triggered.length,
    activationCount: activationSequence,
    targetTier: currentTargetTier,
    targetLabel:
      currentTargetTier === ROWS ? `Carton plein (${ROWS} lignes)` : `${currentTargetTier} ligne${currentTargetTier > 1 ? "s" : ""}`,
    tierLocked: (winners[currentTargetTier - 1]?.size || 0) > 0,
    campaign: serializeCampaign(),
    liveStream: serializeLiveStream(),
    collectiveChallenges: serializeCollectiveChallengesAdmin(),
    ulule: getUluleStatus(),
    raffle: serializeRaffleSummary(),
    progressByLine: getProgressStatsByLine(),
    winners: serializeWinnerCounts(),
    adminLogs: adminActionLog.slice(-40)
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

function buildUluleOrderId(order, email, totalCents, paidAtMs) {
  const directId = order?.id || order?.uuid || order?.reference || order?.order_id
  if (typeof directId === "string" && directId.trim()) return directId.trim()
  if (typeof directId === "number" && Number.isFinite(directId)) return String(directId)
  return `ulule-${email}-${paidAtMs}-${totalCents}`
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
  const orderId = buildUluleOrderId(order, email, totalCents, orderTime)
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
  ululeOrderLedger.set(orderId, {
    id: orderId,
    email,
    totalCents,
    eligible,
    hasReward: eligibleReward || hasReward,
    firstName: identity.firstName,
    lastInitial: identity.lastInitial,
    city: location.city,
    country: location.country,
    departmentCode: location.departmentCode,
    paidAt: new Date(orderTime).toISOString()
  })
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
    const challengeChanged = evaluateActiveCollectiveChallenge({ reason })
    if (recentOrders.length > 0) {
      scheduleRuntimeStateSave(100)
    }
    if (challengeChanged) {
      io.emit("state", serializeState())
    }
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
  const winners = Array.isArray(raffleWinnerByTier[tierIndex]) ? raffleWinnerByTier[tierIndex] : []
  const quota = Number(raffleQuotaByTier[tierIndex] || defaultRaffleQuota(tier, ROWS))
  return {
    tier,
    label: tier === ROWS ? `Carton plein (${tier} lignes)` : `${tier} ligne${tier > 1 ? "s" : ""}`,
    quota,
    winnersCount: winners.length,
    remainingToDraw: Math.max(0, quota - winners.length),
    entriesCount: entries.length,
    entries,
    winners,
    winner: winners[winners.length - 1] || null
  }
}

function serializeRaffleSummary() {
  const byTier = {}
  for (let tier = 1; tier <= ROWS; tier++) {
    const tierData = serializeRaffleTier(tier)
    byTier[`line_${tier}`] = {
      quota: tierData.quota,
      entriesCount: tierData.entriesCount,
      winnersCount: tierData.winnersCount,
      winners: tierData.winners,
      winner: tierData.winner
    }
  }
  return {
    currentTier: currentTargetTier,
    byTier
  }
}

function serializeAllRaffleWinners() {
  const content = serializeContent()
  const winners = []

  for (let tier = 1; tier <= ROWS; tier++) {
    const tierLabel = tier === ROWS ? "Carton plein" : `${tier} ligne${tier > 1 ? "s" : ""}`
    const reward = typeof content[`reward.line_${tier}`] === "string" ? content[`reward.line_${tier}`].trim() : ""
    const tierWinners = Array.isArray(raffleWinnerByTier[tier - 1]) ? raffleWinnerByTier[tier - 1] : []

    for (const winner of tierWinners) {
      winners.push({
        id: winner.id,
        tier,
        tierLabel,
        reward,
        email: winner.email || "",
        firstName: winner.firstName || "",
        lastInitial: winner.lastInitial || "",
        playerToken: winner.playerToken || "",
        selectedAt: winner.selectedAt || null,
        ulule: winner.ulule || null
      })
    }
  }

  winners.sort((a, b) => {
    const left = Date.parse(a.selectedAt || "") || 0
    const right = Date.parse(b.selectedAt || "") || 0
    return right - left
  })

  return winners
}

function buildMilestoneWindows() {
  const windowSizeCents = 10000 * 100
  const orders = [...ululeOrderLedger.values()]
    .filter((order) => Number(order.totalCents || 0) > 0)
    .sort((a, b) => {
      const left = Date.parse(a.paidAt || "") || 0
      const right = Date.parse(b.paidAt || "") || 0
      if (left !== right) return left - right
      return a.id.localeCompare(b.id)
    })

  const windows = new Map()
  let cumulativeCents = 0

  for (const order of orders) {
    const windowIndex = Math.floor(cumulativeCents / windowSizeCents)
    const windowKey = `window_${windowIndex + 1}`
    if (!windows.has(windowKey)) {
      const startCents = windowIndex * windowSizeCents
      windows.set(windowKey, {
        key: windowKey,
        index: windowIndex + 1,
        startCents,
        endCents: startCents + windowSizeCents - 1,
        totalOrders: 0,
        eligibleCandidatesMap: new Map(),
        totalAmountCents: 0
      })
    }

    const window = windows.get(windowKey)
    window.totalOrders += 1
    window.totalAmountCents += Number(order.totalCents || 0)

    if (order.eligible && order.email) {
      if (!window.eligibleCandidatesMap.has(order.email)) {
        window.eligibleCandidatesMap.set(order.email, {
          id: order.id,
          email: order.email,
          firstName: order.firstName || "",
          lastInitial: order.lastInitial || "",
          city: order.city || "",
          country: order.country || "",
          departmentCode: order.departmentCode || "",
          amountCents: Number(order.totalCents || 0),
          orderId: order.id,
          paidAt: order.paidAt || ""
        })
      }
    }

    cumulativeCents += Number(order.totalCents || 0)
  }

  return [...windows.values()].map((window) => {
    const winners = milestoneWinnersByWindow.get(window.key) || []
    return {
      key: window.key,
      index: window.index,
      startCents: window.startCents,
      endCents: window.endCents,
      totalOrders: window.totalOrders,
      totalAmountCents: window.totalAmountCents,
      candidates: [...window.eligibleCandidatesMap.values()],
      candidatesCount: window.eligibleCandidatesMap.size,
      winners,
      winnersCount: winners.length
    }
  })
}

function serializeMilestoneRaffles() {
  return {
    winnersPerWindow: milestoneWinnersPerWindow,
    windows: buildMilestoneWindows()
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
    raffleEnteredTiers: getEnteredTiersForPlayerToken(playerToken),
    hasWonAnyRaffle: Array.isArray(raffleWinnerByTier)
      ? raffleWinnerByTier.some((tierWinners) => Array.isArray(tierWinners) && tierWinners.some((winner) => winner.playerToken === playerToken))
      : false
  }
}

function getPlayerCompletedLines(playerToken) {
  if (typeof playerToken !== "string" || !playerToken) return 0
  const player = players.get(playerToken)
  if (!player) return 0
  const cardIndex = Number(player.cardIndex)
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= cardLineCounts.length) return 0
  return Number(cardLineCounts[cardIndex] || 0)
}

function isPlayerQualifiedForTier(playerToken, tier) {
  if (!Number.isInteger(Number(tier)) || tier < 1 || tier > ROWS) return false
  return getPlayerCompletedLines(playerToken) >= tier
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
  if (raffleWonEmails.has(normalizedEmail)) return { ok: false, error: "already_won_bingo" }

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

function buildBackupSnapshot() {
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    events: events.map((event) => ({
      name: event.name,
      category: event.category,
      is_mandatory: Boolean(event.is_mandatory)
    })),
    content: serializeContent(),
    uiSettings: serializeUiSettings(),
    runtime: serializeRuntimeState()
  }
}

async function replaceAllEvents(nextEvents) {
  const normalizedRows = Array.isArray(nextEvents)
    ? nextEvents
        .map((event) => ({
          name: typeof event?.name === "string" ? event.name.trim() : "",
          category: normalizeCategory(event?.category),
          is_mandatory: Boolean(event?.is_mandatory)
        }))
        .filter((event) => event.name)
    : []

  if (normalizedRows.length === 0) {
    throw new Error("invalid_events_snapshot")
  }

  const { error: deleteError } = await supabase.from("events").delete().not("id", "is", null)
  if (deleteError) throw deleteError

  const { error: insertError } = await supabase.from("events").insert(normalizedRows)
  if (insertError) throw insertError
}

async function applyBackupSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return { ok: false, error: "invalid_snapshot" }
  }

  if (!Array.isArray(snapshot.events) || !snapshot.content || !snapshot.runtime) {
    return { ok: false, error: "invalid_snapshot" }
  }

  await replaceAllEvents(snapshot.events)

  const contentEntries = Object.entries(snapshot.content || {}).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : ""
  }))
  await saveEditableContent(contentEntries)

  const nextUiEntries = Object.entries(snapshot.uiSettings || {}).map(([key, value]) => ({
    key,
    value
  }))
  await saveUiSettings(nextUiEntries)

  pendingRuntimeState = snapshot.runtime
  const ok = await loadEvents()
  if (!ok) {
    return { ok: false, error: "reload_failed_after_import" }
  }
  restoreRuntimeProgress()
  refreshConnectedPlayers()
  io.emit("content", serializeContent())
  io.emit("ui-settings", serializeUiSettings())
  io.emit("state", serializeState())
  await saveRuntimeState()
  pushAdminLog("import_snapshot", { events: events.length, players: players.size, triggered: triggered.length })
  return { ok: true }
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

fastify.get("/api/backend-bruno/ui-settings", { preHandler: requireAdmin }, async () => {
  return {
    ok: true,
    persisted: uiSettingsStorageReady,
    settings: serializeUiSettings()
  }
})

fastify.get("/api/backend-bruno/challenges", { preHandler: requireAdmin }, async () => {
  evaluateActiveCollectiveChallenge({ reason: "admin_load" })
  return {
    ok: true,
    challenges: serializeCollectiveChallengesAdmin()
  }
})

fastify.post("/api/backend-bruno/challenges", { preHandler: requireAdmin }, async (req, reply) => {
  const label = sanitizeChallengeLabel(req.body?.label)
  const type = normalizeChallengeType(req.body?.type)
  const targetCount = Math.min(Math.max(1, Number(req.body?.targetCount || 1)), 100)
  const durationSeconds = Math.min(Math.max(30, Number(req.body?.durationSeconds || 300)), 60 * 60)
  if (!label) {
    reply.code(400)
    return { ok: false, error: "invalid_label" }
  }

  collectiveChallenges.push({
    id: `challenge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    type,
    targetCount,
    durationSeconds,
    createdAt: new Date().toISOString()
  })
  await saveRuntimeState()
  pushAdminLog("create_collective_challenge", { label, type, targetCount, durationSeconds })
  return {
    ok: true,
    challenges: serializeCollectiveChallengesAdmin()
  }
})

fastify.patch("/api/backend-bruno/challenges/:id", { preHandler: requireAdmin }, async (req, reply) => {
  const id = String(req.params?.id || "")
  const index = collectiveChallenges.findIndex((item) => item.id === id)
  if (index === -1) {
    reply.code(404)
    return { ok: false, error: "not_found" }
  }

  const current = collectiveChallenges[index]
  const next = {
    ...current,
    label: req.body?.label !== undefined ? sanitizeChallengeLabel(req.body.label) : current.label,
    type: req.body?.type !== undefined ? normalizeChallengeType(req.body.type) : current.type,
    targetCount: req.body?.targetCount !== undefined ? Math.min(Math.max(1, Number(req.body.targetCount || 1)), 100) : current.targetCount,
    durationSeconds: req.body?.durationSeconds !== undefined ? Math.min(Math.max(30, Number(req.body.durationSeconds || 300)), 60 * 60) : current.durationSeconds
  }
  if (!next.label) {
    reply.code(400)
    return { ok: false, error: "invalid_label" }
  }

  collectiveChallenges[index] = next
  await saveRuntimeState()
  pushAdminLog("update_collective_challenge", { id, label: next.label })
  return {
    ok: true,
    challenges: serializeCollectiveChallengesAdmin()
  }
})

fastify.delete("/api/backend-bruno/challenges/:id", { preHandler: requireAdmin }, async (req, reply) => {
  const id = String(req.params?.id || "")
  const current = collectiveChallenges.find((item) => item.id === id)
  if (!current) {
    reply.code(404)
    return { ok: false, error: "not_found" }
  }

  collectiveChallenges = collectiveChallenges.filter((item) => item.id !== id)
  if (activeCollectiveChallenge?.definitionId === id || activeCollectiveChallenge?.id === id) {
    activeCollectiveChallenge = null
    clearCollectiveChallengeTimer()
    io.emit("state", serializeState())
  }
  await saveRuntimeState()
  pushAdminLog("delete_collective_challenge", { id, label: current.label })
  return {
    ok: true,
    challenges: serializeCollectiveChallengesAdmin()
  }
})

fastify.post("/api/backend-bruno/challenges/start", { preHandler: requireAdmin }, async (req, reply) => {
  const id = String(req.body?.id || "")
  const definition = collectiveChallenges.find((item) => item.id === id)
  if (!definition) {
    reply.code(404)
    return { ok: false, error: "not_found" }
  }

  const now = Date.now()
  activeCollectiveChallenge = {
    id: `active-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    definitionId: definition.id,
    label: definition.label,
    type: definition.type,
    targetCount: definition.targetCount,
    durationSeconds: definition.durationSeconds,
    startedAt: new Date(now).toISOString(),
    endsAt: new Date(now + definition.durationSeconds * 1000).toISOString(),
    status: "running",
    progress: 0,
    currentStreak: 0,
    lastOrderId: "",
    lastOrderAt: "",
    completedAt: "",
    updatedAt: new Date(now).toISOString()
  }
  evaluateActiveCollectiveChallenge({ reason: "start" })
  scheduleCollectiveChallengeTimer()
  await saveRuntimeState()
  pushAdminLog("start_collective_challenge", { id: definition.id, label: definition.label })
  io.emit("state", serializeState())
  return {
    ok: true,
    challenges: serializeCollectiveChallengesAdmin(),
    state: serializeState()
  }
})

fastify.post("/api/backend-bruno/challenges/stop", { preHandler: requireAdmin }, async () => {
  if (!activeCollectiveChallenge) {
    return { ok: true, challenges: serializeCollectiveChallengesAdmin(), unchanged: true }
  }
  const previous = activeCollectiveChallenge
  activeCollectiveChallenge = {
    ...activeCollectiveChallenge,
    status: "stopped",
    updatedAt: new Date().toISOString()
  }
  clearCollectiveChallengeTimer()
  await saveRuntimeState()
  pushAdminLog("stop_collective_challenge", { id: previous.id, label: previous.label })
  io.emit("state", serializeState())
  return {
    ok: true,
    challenges: serializeCollectiveChallengesAdmin(),
    state: serializeState()
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
  pushAdminLog("save_content", { keys: entries.map((entry) => entry?.key).filter(Boolean).slice(0, 20) })
  io.emit("content", serializeContent())
  return {
    ok: true,
    persisted: Boolean(result.persisted),
    warning: result.warning || null,
    content: serializeContent()
  }
})

fastify.patch("/api/backend-bruno/ui-settings", { preHandler: requireAdmin }, async (req, reply) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : null
  if (!entries) {
    reply.code(400)
    return { ok: false, error: "invalid_entries" }
  }

  const result = await saveUiSettings(entries)
  pushAdminLog("save_ui_settings", { settings: serializeUiSettings() })
  io.emit("ui-settings", serializeUiSettings())
  return {
    ok: true,
    persisted: Boolean(result.persisted),
    warning: result.warning || null,
    settings: serializeUiSettings()
  }
})

fastify.get("/api/backend-bruno/export", { preHandler: requireAdmin }, async () => {
  return {
    ok: true,
    snapshot: buildBackupSnapshot()
  }
})

fastify.post("/api/backend-bruno/import", { preHandler: requireAdmin }, async (req, reply) => {
  try {
    const result = await applyBackupSnapshot(req.body?.snapshot)
    if (!result.ok) {
      reply.code(400)
      return result
    }
    return {
      ok: true,
      debug: getDebugState()
    }
  } catch (error) {
    fastify.log.error({ error }, "Import snapshot failed")
    reply.code(500)
    return { ok: false, error: "import_failed" }
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
  pushAdminLog("set_campaign_end", { endAt: new Date(campaignEndAtMs).toISOString() })
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
  pushAdminLog("set_live_urls", { liveStreamUrl: Boolean(liveStreamUrl), ululePageUrl: Boolean(ululePageUrl) })
  io.emit("state", serializeState())
  return { ok: true, liveStream: serializeLiveStream() }
})

fastify.patch("/api/backend-bruno/raffle-quotas", { preHandler: requireAdmin }, async (req, reply) => {
  const quotas = req.body?.quotas
  if (!quotas || typeof quotas !== "object") {
    reply.code(400)
    return { ok: false, error: "invalid_quotas" }
  }

  const nextQuotas = Array.from({ length: ROWS }, (_, index) => {
    const tier = index + 1
    const value = Number(quotas[`line_${tier}`] ?? quotas[tier] ?? raffleQuotaByTier[index])
    if (!Number.isInteger(value) || value < 1 || value > 50) {
      return null
    }
    return value
  })

  if (nextQuotas.some((value) => value === null)) {
    reply.code(400)
    return { ok: false, error: "invalid_quotas" }
  }

  raffleQuotaByTier = nextQuotas
  await saveRuntimeState()
  pushAdminLog("update_raffle_quotas", { quotas: raffleQuotaByTier })
  return { ok: true, quotas: raffleQuotaByTier, debug: getDebugState() }
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
  pushAdminLog("update_board", { rows: ROWS, cols: COLS })
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
  pushAdminLog("change_tier", { tier })
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
  pushAdminLog("toggle_game_ended", { ended: gameEnded })
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
  pushAdminLog("toggle_game_fallback", { active: gameFallbackActive })
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

fastify.get("/api/backend-bruno/winners", { preHandler: requireAdmin }, async () => {
  return {
    ok: true,
    winners: serializeAllRaffleWinners(),
    debug: getDebugState()
  }
})

fastify.get("/api/backend-bruno/milestone-raffles", { preHandler: requireAdmin }, async () => {
  return {
    ok: true,
    milestoneRaffles: serializeMilestoneRaffles(),
    debug: getDebugState()
  }
})

fastify.patch("/api/backend-bruno/milestone-raffles/settings", { preHandler: requireAdmin }, async (req, reply) => {
  const winnersPerWindow = Number(req.body?.winnersPerWindow)
  if (!Number.isInteger(winnersPerWindow) || winnersPerWindow < 1 || winnersPerWindow > 50) {
    reply.code(400)
    return { ok: false, error: "invalid_winners_per_window" }
  }

  milestoneWinnersPerWindow = winnersPerWindow
  await saveRuntimeState()
  pushAdminLog("update_milestone_raffle_settings", { winnersPerWindow })
  return {
    ok: true,
    milestoneRaffles: serializeMilestoneRaffles()
  }
})

fastify.post("/api/backend-bruno/milestone-raffles/draw", { preHandler: requireAdmin }, async (req, reply) => {
  const windowKey = typeof req.body?.windowKey === "string" ? req.body.windowKey.trim() : ""
  if (!windowKey) {
    reply.code(400)
    return { ok: false, error: "invalid_window_key" }
  }

  const windows = serializeMilestoneRaffles().windows
  const targetWindow = windows.find((window) => window.key === windowKey)
  if (!targetWindow) {
    reply.code(404)
    return { ok: false, error: "window_not_found" }
  }

  if (targetWindow.winnersCount > 0) {
    return { ok: true, alreadyDrawn: true, window: targetWindow, milestoneRaffles: serializeMilestoneRaffles() }
  }

  const eligibleCandidates = targetWindow.candidates.filter((candidate) => !milestoneWonEmails.has(candidate.email))
  if (eligibleCandidates.length === 0) {
    reply.code(400)
    return { ok: false, error: "no_eligible_candidates" }
  }

  const winnersToDraw = Math.min(milestoneWinnersPerWindow, eligibleCandidates.length)
  const pool = [...eligibleCandidates]
  const selectedWinners = []
  while (selectedWinners.length < winnersToDraw && pool.length > 0) {
    const pickedIndex = crypto.randomInt(0, pool.length)
    const picked = pool.splice(pickedIndex, 1)[0]
    selectedWinners.push({
      ...picked,
      selectedAt: new Date().toISOString()
    })
    milestoneWonEmails.add(picked.email)
  }

  milestoneWinnersByWindow.set(windowKey, selectedWinners)
  await saveRuntimeState()
  pushAdminLog("draw_milestone_raffle", { windowKey, winners: selectedWinners.length })
  return {
    ok: true,
    winners: selectedWinners,
    window: serializeMilestoneRaffles().windows.find((window) => window.key === windowKey) || null,
    milestoneRaffles: serializeMilestoneRaffles()
  }
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
    return { ok: false, error: outcome.error || "enter_failed" }
  }

  await saveRuntimeState()
  pushAdminLog("enter_raffle_admin", { tier, duplicated: Boolean(outcome.duplicated) })
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

  if (!isPlayerQualifiedForTier(playerToken, tier)) {
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
  pushAdminLog("enter_raffle_player", { tier, duplicated: Boolean(outcome.duplicated) })
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
  pushAdminLog("add_mock_entries", { tier, added })
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

  if ((raffleWinnerByTier[tierIndex] || []).length > 0) {
    return { ok: true, alreadyDrawn: true, raffle: serializeRaffleTier(tier) }
  }

  const eligibleEntries = entries.filter((entry) => !raffleWonEmails.has(entry.email))
  if (eligibleEntries.length === 0) {
    reply.code(400)
    return { ok: false, error: "no_eligible_entries" }
  }

  const quota = Number(raffleQuotaByTier[tierIndex] || defaultRaffleQuota(tier, ROWS))
  const winnersToDraw = Math.min(quota, eligibleEntries.length)
  const pool = [...eligibleEntries]
  const selectedWinners = []
  while (selectedWinners.length < winnersToDraw && pool.length > 0) {
    const pickedIndex = crypto.randomInt(0, pool.length)
    const picked = pool.splice(pickedIndex, 1)[0]
    const winner = {
      id: picked.id,
      email: picked.email,
      playerToken: picked.playerToken || "",
      firstName: picked.firstName || "",
      lastInitial: picked.lastInitial || "",
      ulule: picked.ulule || null,
      selectedAt: new Date().toISOString()
    }
    selectedWinners.push(winner)
    raffleWonEmails.add(picked.email)
  }
  raffleWinnerByTier[tierIndex] = selectedWinners

  await saveRuntimeState()
  pushAdminLog("draw_raffle", { tier, winners: selectedWinners.length })
  refreshConnectedPlayers()
  io.emit("state", serializeState())
  return {
    ok: true,
    winners: selectedWinners,
    winner: selectedWinners[selectedWinners.length - 1] || null,
    raffle: serializeRaffleTier(tier)
  }
})

fastify.post("/api/backend-bruno/reset-round", { preHandler: requireAdmin }, async () => {
  clearRoundProgress()
  await saveRuntimeState()
  pushAdminLog("reset_round")
  refreshConnectedPlayers()
  io.emit("state", serializeState())
  return { ok: true }
})

fastify.post("/api/backend-bruno/reset-all", { preHandler: requireAdmin }, async (req, reply) => {
  const ok = resetLiveRuntime({ preserveQuotas: true, regenerateCards: true })
  if (!ok) {
    reply.code(400)
    return { ok: false, error: "reset_all_failed" }
  }

  await saveRuntimeState()
  pushAdminLog("reset_all")
  refreshConnectedPlayers()
  io.emit("state", serializeState())
  return { ok: true, debug: getDebugState(), state: serializeState() }
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
  pushAdminLog("create_event", { name: normalizedName, category, isMandatory })
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
  pushAdminLog("bulk_create_events", { inserted: rows.length, category, isMandatory })
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
    pushAdminLog("update_event", { id, ...updates, gameReset: true })
    refreshConnectedPlayers()
    return { ok: true, gameReset: true }
  }

  // Category-only update: keep current round state and cards untouched.
  events = events.map((event) => (event.id === id ? { ...event, ...updates } : event))
  pushAdminLog("update_event", { id, ...updates, gameReset: false })
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
  pushAdminLog("delete_event", { id, name: eventRow.name })
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
  pushAdminLog("trigger_event", { event: normalizedEvent })
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
  pushAdminLog(req.body.active ? "activate_event" : "deactivate_event", { id, name: eventRow.name })
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
    await loadUiSettings()
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
