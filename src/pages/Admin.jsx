import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"

const DEFAULT_CATEGORIES = ["coulisses", "creative", "chat", "public", "dons", "general"]

export default function Admin() {
  const navigate = useNavigate()
  const [debug, setDebug] = useState(null)
  const [boardRows, setBoardRows] = useState(4)
  const [boardCols, setBoardCols] = useState(5)
  const [campaignEndInput, setCampaignEndInput] = useState("")
  const [liveStreamInput, setLiveStreamInput] = useState("")
  const [events, setEvents] = useState([])
  const [draggedEventId, setDraggedEventId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [tierLoading, setTierLoading] = useState(false)
  const [raffleLoading, setRaffleLoading] = useState(false)
  const [raffleEmail, setRaffleEmail] = useState("")
  const [raffleEntries, setRaffleEntries] = useState([])
  const [raffleWinner, setRaffleWinner] = useState(null)
  const [rouletteIndex, setRouletteIndex] = useState(0)
  const [rouletteSpinning, setRouletteSpinning] = useState(false)
  const [status, setStatus] = useState("")

  const categories = useMemo(() => {
    const fromEvents = events.map((event) => event.category)
    const fromStorage = JSON.parse(localStorage.getItem("bingoCategories") || "[]")
    const merged = [...DEFAULT_CATEGORIES, ...fromStorage, ...fromEvents]
    return [...new Set(merged.filter(Boolean))]
  }, [events])

  const winnerTiers = useMemo(() => {
    const byLine = debug?.winners?.byLine || {}
    return Object.entries(byLine)
      .sort(([a], [b]) => Number(a.replace("line_", "")) - Number(b.replace("line_", "")))
      .map(([key, count]) => {
        const lineNumber = Number(key.replace("line_", ""))
        const label = lineNumber === Number(debug?.rows) ? `Carton plein (${lineNumber} lignes)` : `${lineNumber} ligne${lineNumber > 1 ? "s" : ""}`
        return { key, label, count }
      })
  }, [debug])

  const progressTiers = useMemo(() => {
    const byLine = debug?.progressByLine || {}
    const rows = Number(debug?.rows || 0)
    if (!rows) return []

    return Array.from({ length: rows }, (_, index) => {
      const tier = index + 1
      const key = `line_${tier}`
      const stats = byLine[key] || { oneAway: 0, missingBuckets: {} }
      const label = tier === rows ? "Carton plein" : `${tier} ligne${tier > 1 ? "s" : ""}`
      const buckets = stats.missingBuckets || {}
      const oneAway = Number(stats.oneAway || 0)
      const twoAway = Number(buckets["2"] || 0)
      const threeAway = Number(buckets["3"] || 0)
      const almostThere = oneAway + twoAway
      const veryClose = oneAway + twoAway + threeAway
      return { key, label, oneAway, almostThere, veryClose }
    })
  }, [debug])

  const tierControls = useMemo(() => {
    const rows = Number(debug?.rows || 0)
    if (!rows) return []
    return Array.from({ length: rows }, (_, index) => {
      const tier = index + 1
      const label = tier === rows ? "Carton plein" : `${tier} ligne${tier > 1 ? "s" : ""}`
      return { tier, label }
    })
  }, [debug])

  const eventsByCategory = useMemo(() => {
    const grouped = {}
    for (const category of categories) grouped[category] = []

    for (const event of events) {
      if (!grouped[event.category]) grouped[event.category] = []
      grouped[event.category].push(event)
    }

    for (const category of Object.keys(grouped)) {
      grouped[category].sort((a, b) => {
        if (a.triggered !== b.triggered) return Number(a.triggered) - Number(b.triggered)
        const aOrder = a.trigger_order || Number.MAX_SAFE_INTEGER
        const bOrder = b.trigger_order || Number.MAX_SAFE_INTEGER
        return aOrder - bOrder
      })
    }

    return grouped
  }, [events, categories])

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options)
    const data = await response.json().catch(() => ({}))
    return { response, data }
  }

  async function loadDashboard() {
    setLoading(true)
    setStatus("")

    try {
      const bootstrapCall = await fetchJson("/api/backend-bruno/bootstrap")

      if (!bootstrapCall.response.ok) {
        if (bootstrapCall.response.status === 403) {
          navigate("/admin/login", { replace: true })
          return
        }
        setDebug(null)
        setEvents([])
        setStatus("Session invalide: reconnecte-toi")
        return
      }

      setDebug(bootstrapCall.data.debug)
      const campaignEndAt = bootstrapCall.data.debug?.campaign?.endAt
      setCampaignEndInput(campaignEndAt ? toLocalDateTimeInput(campaignEndAt) : "")
      setLiveStreamInput(bootstrapCall.data.debug?.liveStream?.url || "")
      setBoardRows(bootstrapCall.data.debug?.rows || 4)
      setBoardCols(bootstrapCall.data.debug?.cols || 5)
      setEvents(bootstrapCall.data.events?.events || [])
      await loadRaffle(bootstrapCall.data.debug?.targetTier || 1)
      if (bootstrapCall.data.bootstrapping) {
        setStatus("Initialisation des cartes en cours...")
        setTimeout(() => {
          loadDashboard()
        }, 1200)
      } else {
        setStatus("Tableau de bord chargé")
      }
    } finally {
      setLoading(false)
    }
  }

  function toLocalDateTimeInput(iso) {
    const date = new Date(iso)
    if (!Number.isFinite(date.getTime())) return ""
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    const hours = String(date.getHours()).padStart(2, "0")
    const minutes = String(date.getMinutes()).padStart(2, "0")
    const seconds = String(date.getSeconds()).padStart(2, "0")
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
  }

  function formatParticipant(entry) {
    const firstName = (entry?.firstName || entry?.ulule?.firstName || "").trim()
    const lastInitial = (entry?.lastInitial || entry?.ulule?.lastInitial || "").trim()
    const city = (entry?.ulule?.city || "").trim()
    const country = (entry?.ulule?.country || "").trim()
    const departmentCode = (entry?.ulule?.departmentCode || "").trim()
    const countryLower = country.toLowerCase()
    const isFrance = countryLower === "france" || countryLower === "fr" || countryLower === ""
    const suffix = isFrance ? departmentCode : country
    const identity = firstName ? `${firstName}${lastInitial ? ` ${lastInitial}.` : ""}` : "Joueur"
    if (city && suffix) return `${identity} - ${city} (${suffix})`
    if (city) return `${identity} - ${city}`
    if (suffix) return `${identity} (${suffix})`
    return identity
  }

  useEffect(() => {
    loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const interval = setInterval(async () => {
      if (loading || tierLoading || raffleLoading || rouletteSpinning) return
      const { response, data } = await fetchJson("/api/backend-bruno/debug")
      if (!response.ok || !data) return
      setDebug(data)
    }, 2500)
    return () => clearInterval(interval)
  }, [loading, tierLoading, raffleLoading, rouletteSpinning])

  async function toggleEvent(event) {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson(`/api/backend-bruno/events/${event.id}/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !event.triggered })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur activation: ${data.error || "unknown_error"}`)
        return
      }

      setEvents((prev) =>
        prev.map((item) =>
          item.id === event.id
            ? {
                ...item,
                triggered: !item.triggered,
                trigger_order: item.triggered
                  ? null
                  : prev.filter((candidate) => candidate.triggered).length + 1,
                activation_count: item.triggered
                  ? item.activation_count || 0
                  : (item.activation_count || 0) + 1
              }
            : item
        )
      )
      setDebug((prev) =>
        data.debug || prev
      )
      setStatus(event.triggered ? "Événement désactivé" : "Événement activé")
    } finally {
      setLoading(false)
    }
  }

  async function moveEventToCategory(eventId, category) {
    const event = events.find((item) => item.id === eventId)
    if (!event || event.category === category) return

    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson(`/api/backend-bruno/events/${eventId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur deplacement: ${data.error || "unknown_error"}`)
        return
      }

      setEvents((prev) =>
        prev.map((item) =>
          item.id === eventId
            ? {
                ...item,
                category
              }
            : item
        )
      )
      setStatus(`Événement déplacé vers ${category}`)
    } finally {
      setLoading(false)
    }
  }

  async function reloadFromSupabase() {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/backend-bruno/reload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur reload: ${data.error || "unknown_error"}`)
        return
      }

      setStatus("Événements rechargés")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function resetRound() {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/backend-bruno/reset-round", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur reset: ${data.error || "unknown_error"}`)
        return
      }

      setStatus("Manche réinitialisée")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function updateBoardSize() {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/backend-bruno/board", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: Number(boardRows), cols: Number(boardCols) })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur format: ${data.details || data.error || "unknown_error"}`)
        return
      }

      setStatus(`Format applique: ${data.board.rows}x${data.board.cols}`)
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function saveCampaignEnd() {
    setLoading(true)
    setStatus("")

    try {
      const endAt = campaignEndInput ? new Date(campaignEndInput).toISOString() : null
      const { response, data } = await fetchJson("/api/backend-bruno/campaign-end", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endAt })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur fin campagne: ${data.error || "unknown_error"}`)
        return
      }

      setDebug((prev) =>
        prev
          ? {
              ...prev,
              campaign: data.campaign
            }
          : prev
      )
      setStatus(endAt ? "Fin de campagne enregistrée" : "Fin de campagne supprimée")
    } finally {
      setLoading(false)
    }
  }

  async function saveLiveStream() {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/backend-bruno/live-stream", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: liveStreamInput.trim() || null })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur live: ${data.error || "unknown_error"}`)
        return
      }

      setDebug((prev) =>
        prev
          ? {
              ...prev,
              liveStream: data.liveStream
            }
          : prev
      )
      setStatus(data.liveStream?.url ? "URL du live enregistrée" : "URL du live supprimée")
    } finally {
      setLoading(false)
    }
  }

  async function chooseTargetTier(tier) {
    setTierLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/backend-bruno/target-tier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur palier: ${data.error || "unknown_error"}`)
        return
      }

      setDebug(data.debug || null)
      await loadRaffle(tier)
      setStatus(`Palier en cours: ${data.debug?.targetLabel || `${tier} ligne(s)`}`)
    } finally {
      setTierLoading(false)
    }
  }

  async function loadRaffle(tier = debug?.targetTier || 1) {
    const { response, data } = await fetchJson(`/api/backend-bruno/raffle?tier=${tier}`)
    if (!response.ok || !data.ok) return
    setRaffleEntries(data.entries || [])
    setRaffleWinner(data.winner || null)
    setRouletteIndex(0)
  }

  async function addRaffleEntry() {
    if (!raffleEmail.trim()) return
    setRaffleLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/backend-bruno/raffle/enter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: debug?.targetTier || 1, email: raffleEmail.trim() })
      })
      if (!response.ok || !data.ok) {
        if (data.error === "not_ulule_eligible") {
          setStatus("Email non éligible Ulule: contribution avec contrepartie ou >= 10€ requise")
          return
        }
        if (data.error === "ulule_not_configured") {
          setStatus("Chaînage Ulule non configuré côté serveur")
          return
        }
        setStatus(`Erreur préinscription: ${data.error || "unknown_error"}`)
        return
      }
      setRaffleEmail("")
      setRaffleEntries(data.raffle?.entries || [])
      setRaffleWinner(data.raffle?.winner || null)
      setStatus(data.duplicated ? "Email déjà préinscrit sur ce palier" : "Préinscription ajoutée")
    } finally {
      setRaffleLoading(false)
    }
  }

  async function addMockEntries() {
    setRaffleLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/backend-bruno/raffle/mock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: debug?.targetTier || 1, count: 25 })
      })
      if (!response.ok || !data.ok) {
        setStatus(`Erreur mock: ${data.error || "unknown_error"}`)
        return
      }
      setRaffleEntries(data.raffle?.entries || [])
      setRaffleWinner(data.raffle?.winner || null)
      setStatus(`${data.added || 0} faux préinscrits ajoutés`)
    } finally {
      setRaffleLoading(false)
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function animateRoulette(entries, winnerId) {
    if (entries.length === 0) return
    setRouletteSpinning(true)
    let index = 0
    for (let step = 0; step < 36; step++) {
      index = (index + 1) % entries.length
      setRouletteIndex(index)
      await sleep(55 + step * 4)
    }
    const finalIndex = Math.max(
      0,
      entries.findIndex((entry) => entry.id === winnerId)
    )
    setRouletteIndex(finalIndex)
    setRouletteSpinning(false)
  }

  async function drawRaffle() {
    if (raffleEntries.length === 0) {
      setStatus("Aucun préinscrit pour ce palier")
      return
    }
    setRaffleLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/backend-bruno/raffle/draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: debug?.targetTier || 1 })
      })
      if (!response.ok || !data.ok) {
        setStatus(`Erreur tirage: ${data.error || "unknown_error"}`)
        return
      }

      const entries = data.raffle?.entries || []
      setRaffleEntries(entries)
      if (data.winner) {
        await animateRoulette(entries, data.winner.id)
      }
      setRaffleWinner(data.raffle?.winner || data.winner || null)
      setStatus("Tirage terminé")
    } finally {
      setRaffleLoading(false)
    }
  }

  async function logout() {
    await fetch("/api/backend-bruno/logout", { method: "POST" }).catch(() => {})
    navigate("/admin/login", { replace: true })
  }

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <OldeupeLogo className="brand-logo admin-brand-logo" />
          <h1>Tableau de bord live</h1>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={loadDashboard} disabled={loading}>
            {loading ? "Chargement..." : "Rafraîchir"}
          </button>
          <Link className="btn ghost" to="/admin/raffle">
            Vue tirage
          </Link>
          <Link className="btn ghost" to="/admin/manage">
            Vue édition
          </Link>
          <Link className="btn ghost" to="/admin/content">
            Textes
          </Link>
          <button className="btn ghost" onClick={logout}>
            Deconnexion
          </button>
        </div>
      </div>

      <div className="admin-grid full-width">
        <section className="panel">
          <h2>Manche</h2>
          <div className="row">
            <button className="btn" onClick={reloadFromSupabase} disabled={loading}>
              Recharger
            </button>
            <button className="btn danger" onClick={resetRound} disabled={loading}>
              Réinitialiser la manche
            </button>
          </div>
          <div className="row">
            {tierControls.map((tierItem) => (
              <button
                key={tierItem.tier}
                className={`btn ghost ${debug?.targetTier === tierItem.tier ? "active" : ""}`}
                onClick={() => chooseTargetTier(tierItem.tier)}
                disabled={tierLoading}
              >
                {tierItem.label}
              </button>
            ))}
          </div>
          {debug?.targetLabel ? (
            <p className="hint">
              Palier en cours: <strong>{debug.targetLabel}</strong>
              {debug?.tierLocked ? " (gagnant trouvé, passe au palier suivant)" : ""}
            </p>
          ) : null}
          <div className="row">
            <input
              className="input"
              type="number"
              min="2"
              max="8"
              value={boardRows}
              onChange={(e) => setBoardRows(e.target.value)}
            />
            <input
              className="input"
              type="number"
              min="2"
              max="8"
              value={boardCols}
              onChange={(e) => setBoardCols(e.target.value)}
            />
            <button className="btn ghost" onClick={updateBoardSize} disabled={loading}>
              Appliquer format
            </button>
          </div>
          <div className="row">
            <input
              className="input"
              type="datetime-local"
              step="1"
              value={campaignEndInput}
              onChange={(e) => setCampaignEndInput(e.target.value)}
            />
            <button className="btn ghost" onClick={saveCampaignEnd} disabled={loading}>
              Enregistrer fin campagne
            </button>
          </div>
          <p className="hint">Date, heure et secondes modifiables. Le compte à rebours joueur se met à jour avec cette valeur exacte.</p>
          <div className="row">
            <input
              className="input"
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={liveStreamInput}
              onChange={(e) => setLiveStreamInput(e.target.value)}
            />
            <button className="btn ghost" onClick={saveLiveStream} disabled={loading}>
              Enregistrer URL live
            </button>
          </div>
          {debug && (
            <>
              <div className="kpis">
                <div><strong>{debug.events}</strong><span>événements</span></div>
                <div><strong>{debug.players}</strong><span>joueurs</span></div>
                <div><strong>{debug.triggered}</strong><span>tirés</span></div>
                <div><strong>{debug.activationCount || 0}</strong><span>activations</span></div>
                <div><strong>{debug.rows}x{debug.cols}</strong><span>grille</span></div>
              </div>
              <div className="winner-grid">
                {winnerTiers.map((tier) => (
                  <div key={tier.key} className="winner-card">
                    <span>{tier.label}</span>
                    <strong>{tier.count}</strong>
                  </div>
                ))}
              </div>
              <div className="winner-grid">
                {progressTiers.map((tier) => (
                  <div key={tier.key} className="winner-card">
                    <span>{tier.label}</span>
                    <strong>À 1 case du palier: {tier.oneAway}</strong>
                    <small className="hint">
                      Très proches (1-2 cases): {tier.almostThere} • Proches (1-3 cases): {tier.veryClose}
                    </small>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

      </div>

      <section className="panel">
        <h2>Tirage au sort</h2>
        <p className="hint">Palier actif: <strong>{debug?.targetLabel || "1 ligne"}</strong></p>
        <div className="row">
          <input
            className="input"
            type="email"
            placeholder="email de contribution ulule"
            value={raffleEmail}
            onChange={(e) => setRaffleEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addRaffleEntry()
            }}
          />
          <button className="btn ghost" onClick={addRaffleEntry} disabled={raffleLoading}>
            Ajouter
          </button>
          <button className="btn ghost" onClick={addMockEntries} disabled={raffleLoading}>
            Ajouter 25 démos
          </button>
          <button className="btn" onClick={drawRaffle} disabled={raffleLoading || raffleEntries.length === 0}>
            Lancer le tirage
          </button>
        </div>

        <div className={`raffle-roulette ${rouletteSpinning ? "spinning" : ""}`}>
          {raffleEntries.length === 0 ? (
            <div className="raffle-empty">Aucun préinscrit pour ce palier</div>
          ) : (
            raffleEntries.slice(0, 80).map((entry, index) => (
              <div
                key={entry.id}
                className={`raffle-item ${index === rouletteIndex ? "active" : ""} ${raffleWinner?.id === entry.id ? "winner" : ""}`}
              >
                <strong>{formatParticipant(entry)}</strong>
                {entry.ulule ? (
                  <small>
                    Ulule validé • {entry.ulule.hasReward ? "contrepartie" : "don"} • {(entry.ulule.orderTotalCents / 100).toFixed(2)}€
                  </small>
                ) : null}
              </div>
            ))
          )}
        </div>

        <p className="hint">Préinscrits: <strong>{raffleEntries.length}</strong></p>
        {raffleWinner ? (
          <p className="status">Gagnant tiré au sort: <strong>{formatParticipant(raffleWinner)}</strong></p>
        ) : null}
      </section>

      <section className="panel">
        <h2>Catégories</h2>
        <div className="category-stack">
          {categories.map((category) => (
            <section
              key={category}
              className="category-section"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const eventId = Number(e.dataTransfer.getData("text/event-id") || draggedEventId)
                if (eventId) moveEventToCategory(eventId, category)
                setDraggedEventId(null)
              }}
            >
              <header className="category-section-head">
                <h3>{category}</h3>
                <span>{eventsByCategory[category]?.length || 0}</span>
              </header>

              <div className="category-events">
                {(eventsByCategory[category] || []).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`event-chip ${event.triggered ? "on" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      setDraggedEventId(event.id)
                      e.dataTransfer.setData("text/event-id", String(event.id))
                    }}
                    onClick={() => toggleEvent(event)}
                  >
                    <span>{event.name}</span>
                    {event.trigger_order ? <span className="event-order">#{event.trigger_order}</span> : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      {status && <p className="status">{status}</p>}
    </div>
  )
}
