import fs from "fs/promises"
import path from "path"

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIndex = trimmed.indexOf("=")
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex).trim()
      let value = trimmed.slice(eqIndex + 1).trim()
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
  } catch {
    // optional
  }
}

await loadEnvFile(path.resolve(".env"))
await loadEnvFile(path.resolve(".env.local"))

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error("SUPABASE_URL or SUPABASE_KEY is missing")
  process.exit(1)
}

const csvPath = process.argv[2]
if (!csvPath) {
  console.error("Usage: node scripts/import-ulule-orders-csv.mjs /absolute/path/orders.csv")
  process.exit(1)
}

const MIN_CONTRIBUTION_CENTS = 1000
const MILESTONE_START_CENTS = 500000 * 100
const MILESTONE_END_CENTS = 510000 * 100

function parseCsv(content, delimiter = ";") {
  const rows = []
  let row = []
  let cell = ""
  let inQuotes = false

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const next = content[i + 1]

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\""
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell)
      cell = ""
      continue
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
      continue
    }

    cell += char
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

function moneyToCents(raw) {
  const normalized = String(raw || "").trim().replace(",", ".")
  if (!normalized) return 0
  const value = Number(normalized)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value * 100))
}

function normalizeText(value) {
  return String(value || "").trim()
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/^\uFEFF/, "")
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeFirstName(value) {
  return normalizeText(value)
}

function normalizeLastInitial(value) {
  const normalized = normalizeText(value)
  return normalized ? normalized.charAt(0).toUpperCase() : ""
}

function normalizeCountry(value) {
  return normalizeText(value)
}

function normalizeCity(value) {
  return normalizeText(value)
}

function normalizePostalCode(value) {
  return normalizeText(value).replace(/\s+/g, "")
}

function deriveDepartmentCode(postalCode, country) {
  const normalizedCountry = normalizeCountry(country).toUpperCase()
  if (normalizedCountry && normalizedCountry !== "FR" && normalizedCountry !== "FRANCE") return ""
  const normalizedPostal = normalizePostalCode(postalCode)
  if (/^(97|98)\d{3}$/.test(normalizedPostal)) return normalizedPostal.slice(0, 3)
  if (/^\d{5}$/.test(normalizedPostal)) return normalizedPostal.slice(0, 2)
  return ""
}

function isoFromDate(raw) {
  const value = normalizeText(raw)
  if (!value) return new Date().toISOString()
  const direct = Date.parse(value)
  if (Number.isFinite(direct)) return new Date(direct).toISOString()
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00.000Z`).toISOString()
  return new Date().toISOString()
}

function buildContributionRow(base, order) {
  const totalCents = order.totalCents
  const eligible = totalCents >= MIN_CONTRIBUTION_CENTS
  return {
    email: order.email,
    hasReward: Boolean(order.hasReward || base?.hasReward),
    maxTotalCents: Math.max(Number(base?.maxTotalCents || 0), totalCents),
    eligible: Boolean(base?.eligible || eligible),
    eligibilityReason: eligible || base?.eligible ? "eligible" : "amount_below_minimum",
    firstName: order.firstName || base?.firstName || "",
    lastInitial: order.lastInitial || base?.lastInitial || "",
    city: order.city || base?.city || "",
    country: order.country || base?.country || "",
    departmentCode: order.departmentCode || base?.departmentCode || "",
    lastSeenMs: Math.max(Number(base?.lastSeenMs || 0), Date.parse(order.paidAt) || 0),
    updatedAtMs: Date.now()
  }
}

const raw = await fs.readFile(path.resolve(csvPath), "utf8")
const rows = parseCsv(raw, ";")
if (rows.length < 2) {
  console.error("CSV is empty")
  process.exit(1)
}

const headers = rows[0].map(normalizeHeader)
const dataRows = rows.slice(1).filter((row) => row.some((cell) => normalizeText(cell)))
const index = Object.fromEntries(headers.map((header, idx) => [header, idx]))

const requiredHeaders = ["#", "E-mail", "Montant unitaire total", "Frais de port", "Date de création", "Statut"]
for (const header of requiredHeaders) {
  if (!(header in index)) {
    console.error(`Missing header: ${header}`)
    process.exit(1)
  }
}

const ordersMap = new Map()

for (const row of dataRows) {
  const orderId = normalizeText(row[index["#"]])
  if (!orderId) continue
  const email = normalizeEmail(row[index["E-mail"]])
  const firstName = normalizeFirstName(row[index["Prénom de facturation"]] || row[index["Prénom de livraison"]])
  const lastName = normalizeText(row[index["Nom de facturation"]] || row[index["Nom de livraison"]])
  const city = normalizeCity(row[index["Ville de facturation"]] || row[index["Ville de livraison"]])
  const country = normalizeCountry(row[index["Pays de facturation"]] || row[index["Pays de livraison"]])
  const postalCode = normalizePostalCode(row[index["Code postal de facturation"]] || row[index["Code postal de livraison"]])
  const paymentStatus = normalizeText(row[index["Statut"]])
  const rewardTitle = normalizeText(row[index["Titre de la contrepartie"]])
  const quantityRaw = normalizeText(row[index["Quantité"]])
  const quantity = quantityRaw ? Math.max(1, Math.round(Number(quantityRaw.replace(",", ".")) || 1)) : 1
  const unitTotalCents = moneyToCents(row[index["Montant unitaire total"]])
  const shippingCents = moneyToCents(row[index["Frais de port"]])
  const paidAt = isoFromDate(row[index["Date de création"]])

  const current = ordersMap.get(orderId) || {
    id: orderId,
    email,
    totalCents: 0,
    shippingCents: 0,
    eligible: false,
    hasReward: false,
    firstName,
    lastInitial: normalizeLastInitial(lastName),
    city,
    country,
    departmentCode: deriveDepartmentCode(postalCode, country),
    paidAt,
    paymentStatus
  }

  current.email = current.email || email
  current.firstName = current.firstName || firstName
  current.lastInitial = current.lastInitial || normalizeLastInitial(lastName)
  current.city = current.city || city
  current.country = current.country || country
  current.departmentCode = current.departmentCode || deriveDepartmentCode(postalCode, country)
  current.paymentStatus = current.paymentStatus || paymentStatus
  current.paidAt = current.paidAt || paidAt
  current.totalCents += unitTotalCents * quantity
  current.shippingCents = Math.max(current.shippingCents, shippingCents)
  if (rewardTitle && rewardTitle.toLowerCase() !== "don libre") current.hasReward = true

  ordersMap.set(orderId, current)
}

const importedOrders = [...ordersMap.values()]
  .map((order) => ({
    ...order,
    totalCents: order.totalCents + order.shippingCents,
    eligible: (order.totalCents + order.shippingCents) >= MIN_CONTRIBUTION_CENTS
  }))
  .filter((order) => /paiement effectué/i.test(order.paymentStatus || ""))

const importedContributionByEmail = new Map()
for (const order of importedOrders) {
  if (!order.email) continue
  importedContributionByEmail.set(order.email, buildContributionRow(importedContributionByEmail.get(order.email), order))
}

const totalCents = importedOrders.reduce((sum, order) => sum + Number(order.totalCents || 0), 0)
const sortedOrders = [...importedOrders].sort((a, b) => {
  const left = Date.parse(a.paidAt || "") || 0
  const right = Date.parse(b.paidAt || "") || 0
  if (left !== right) return left - right
  return a.id.localeCompare(b.id)
})

let cumulativeCents = 0
const milestoneWindowOrders = []
for (const order of sortedOrders) {
  const next = cumulativeCents + Number(order.totalCents || 0)
  if (cumulativeCents < MILESTONE_END_CENTS && next > MILESTONE_START_CENTS) {
    milestoneWindowOrders.push(order)
  }
  cumulativeCents = next
}

const stateResponse = await fetch(`${supabaseUrl}/rest/v1/app_state?state_key=eq.runtime&select=state_key,state_value`, {
  headers: {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Accept: "application/json"
  }
})

if (!stateResponse.ok) {
  console.error("Failed to load runtime state", await stateResponse.text())
  process.exit(1)
}

const statePayload = await stateResponse.json().catch(() => [])
const runtime = statePayload?.[0]?.state_value && typeof statePayload[0].state_value === "object" ? statePayload[0].state_value : {}
runtime.ululeFrozenBeforeMs = Date.now()
runtime.ululeFrozenOrderLedger = importedOrders
runtime.ululeFrozenContributionByEmail = [...importedContributionByEmail.entries()]
runtime.ululeOrderLedger = []

const upsertResponse = await fetch(`${supabaseUrl}/rest/v1/app_state`, {
  method: "POST",
  headers: {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=representation"
  },
  body: JSON.stringify([
    {
      state_key: "runtime",
      state_value: runtime
    }
  ])
})

if (!upsertResponse.ok) {
  console.error("Failed to save runtime state", await upsertResponse.text())
  process.exit(1)
}

console.log(JSON.stringify({
  ok: true,
  file: path.resolve(csvPath),
  importedOrders: importedOrders.length,
  importedEmails: importedContributionByEmail.size,
  totalCents,
  totalEuros: Number((totalCents / 100).toFixed(2)),
  milestone500kOrders: milestoneWindowOrders.length,
  milestone500kEligibleEmails: new Set(milestoneWindowOrders.filter((order) => order.eligible && order.email).map((order) => order.email)).size
}, null, 2))
