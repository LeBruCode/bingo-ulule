import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"
import useBrandLogo from "../hooks/useBrandLogo.js"

const DEFAULT_CATEGORIES = ["coulisses", "creative", "chat", "public", "dons", "general"]

export default function Admin() {
  const navigate = useNavigate()
  const [logoSrc] = useBrandLogo()
  const [debug, setDebug] = useState(null)
  const [boardRows, setBoardRows] = useState(4)
  const [boardCols, setBoardCols] = useState(5)
  const [campaignEndInput, setCampaignEndInput] = useState("")
  const [liveStreamInput, setLiveStreamInput] = useState("")
  const [ululePageInput, setUlulePageInput] = useState("")
  const [liveMessage, setLiveMessage] = useState("")
  const [tierRewards, setTierRewards] = useState({})
  const [raffleQuotas, setRaffleQuotas] = useState({})
  const [events, setEvents] = useState([])
  const [draggedEventId, setDraggedEventId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [tierLoading, setTierLoading] = useState(false)
  const [raffleLoading, setRaffleLoading] = useState(false)
  const [raffleEmail, setRaffleEmail] = useState("")
  const [raffleEntries, setRaffleEntries] = useState([])
  const [raffleWinners, setRaffleWinners] = useState([])
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

  const roundTimeline = useMemo(() => {
    const rows = Number(debug?.rows || 0)
    if (!rows) return []
    return Array.from({ length: rows }, (_, index) => {
      const tier = index + 1
      const key = `line_${tier}`
      const winnersCount = Number(debug?.raffle?.byTier?.[key]?.winnersCount || 0)
      const quota = Number(debug?.raffle?.byTier?.[key]?.quota || 1)
      let state = "upcoming"
      if (winnersCount > 0) state = "drawn"
      else if (tier === Number(debug?.targetTier || 1)) state = "active"
      return {
        tier,
        label: tier === rows ? "Carton plein" : `${tier} ligne${tier > 1 ? "s" : ""}`,
        state,
        winnersCount,
        quota
      }
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
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options
    })
    const data = await response.json().catch(() => ({}))
    if (response.status === 403) {
      navigate("/admin/login", { replace: true })
    }
    return { response, data }
  }

  function humanizeError(errorCode) {
    if (errorCode === "cannot_decrease_tier") return "Impossible de revenir à une manche précédente."
    return errorCode || "unknown_error"
  }

  function formatDateTime(value) {
    if (!value) return "Jamais"
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return "Jamais"
    return date.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  }

  async function loadDashboard() {
    setLoading(true)
    setStatus("")

    try {
      const bootstrapCall = await fetchJson("/api/backend-bruno/bootstrap")
      const contentCall = await fetchJson("/api/backend-bruno/content")

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
      setUlulePageInput(bootstrapCall.data.debug?.liveStream?.ululeUrl || "")
      setBoardRows(bootstrapCall.data.debug?.rows || 4)
      setBoardCols(bootstrapCall.data.debug?.cols || 5)
      setEvents(bootstrapCall.data.events?.events || [])
      if (contentCall.response.ok) {
        setTierRewards(contentCall.data.content || {})
        setLiveMessage(contentCall.data.content?.["player.live_message"] || "")
      }
      const quotas = {}
      Array.from({ length: Number(bootstrapCall.data.debug?.rows || 0) }, (_, index) => {
        const tier = index + 1
        quotas[`line_${tier}`] = Number(bootstrapCall.data.debug?.raffle?.byTier?.[`line_${tier}`]?.quota || 1)
        return tier
      })
      setRaffleQuotas(quotas)
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
    const rows = Number(debug?.rows || 0)
    if (!rows) return
    const nextQuotas = {}
    for (let index = 0; index < rows; index += 1) {
      const tier = index + 1
      nextQuotas[`line_${tier}`] = Number(debug?.raffle?.byTier?.[`line_${tier}`]?.quota || 1)
    }
    setRaffleQuotas(nextQuotas)
  }, [debug?.rows, debug?.raffle])

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
        if (response.status === 403) {
          setStatus("Session admin expirée, reconnecte-toi")
          return
        }
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

  async function resetAll() {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Tout réinitialiser ? Les cartes, attributions joueurs, tirages, gagnants et préinscriptions seront effacés.")
      if (!confirmed) return
    }

    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/backend-bruno/reset-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur reset total: ${data.error || "unknown_error"}`)
        return
      }

      setStatus("Réinitialisation complète effectuée")
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

      setStatus(`Format appliqué : ${data.board.rows}x${data.board.cols}`)
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
        body: JSON.stringify({
          url: liveStreamInput.trim() || null,
          ululeUrl: ululePageInput.trim() || null
        })
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

  async function saveLiveMessage() {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/backend-bruno/content", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entries: [
            {
              key: "player.live_message",
              value: liveMessage
            }
          ]
        })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur message live: ${data.error || "unknown_error"}`)
        return
      }

      setLiveMessage(data.content?.["player.live_message"] || "")
      setStatus("Message live enregistré")
    } finally {
      setLoading(false)
    }
  }

  async function saveTierRewards() {
    setLoading(true)
    setStatus("")

    try {
      const rows = Number(debug?.rows || 0)
      const entries = Array.from({ length: rows }, (_, index) => {
        const tier = index + 1
        const key = `reward.line_${tier}`
        return {
          key,
          value: typeof tierRewards[key] === "string" ? tierRewards[key] : ""
        }
      })

      const { response, data } = await fetchJson("/api/backend-bruno/content", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur gains: ${data.error || "unknown_error"}`)
        return
      }

      setTierRewards(data.content || {})
      setStatus("Gains enregistrés")
    } finally {
      setLoading(false)
    }
  }

  async function saveRaffleQuotas() {
    setLoading(true)
    setStatus("")

    try {
      const rows = Number(debug?.rows || 0)
      const quotas = {}
      for (let index = 0; index < rows; index += 1) {
        const tier = index + 1
        quotas[`line_${tier}`] = Number(raffleQuotas[`line_${tier}`] || 1)
      }

      const { response, data } = await fetchJson("/api/backend-bruno/raffle-quotas", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quotas })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur gagnants par manche: ${data.error || "unknown_error"}`)
        return
      }

      setDebug(data.debug || null)
      const nextQuotas = {}
      ;(data.quotas || []).forEach((value, index) => {
        nextQuotas[`line_${index + 1}`] = Number(value || 1)
      })
      setRaffleQuotas(nextQuotas)
      setStatus("Nombre de gagnants enregistré")
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
        setStatus(`Erreur palier: ${humanizeError(data.error)}`)
        return
      }

      setDebug(data.debug || null)
      await loadRaffle(tier)
      setStatus(`Palier en cours : ${data.debug?.targetLabel || `${tier} ligne(s)`}`)
    } finally {
      setTierLoading(false)
    }
  }

  async function toggleGameEnded(nextEnded) {
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/backend-bruno/game-ended", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ended: nextEnded })
      })
      if (!response.ok || !data.ok) {
        setStatus(`Erreur fin du jeu: ${data.error || "unknown_error"}`)
        return
      }
      setDebug(data.debug || null)
      setStatus(nextEnded ? "Jeu terminé pour tous les joueurs" : "Jeu rouvert")
    } finally {
      setLoading(false)
    }
  }

  async function toggleGameFallback(nextActive) {
    setLoading(true)
    setStatus("")

    try {
      const { response, data } = await fetchJson("/api/backend-bruno/game-fallback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: nextActive })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur fallback: ${data.error || "unknown_error"}`)
        return
      }

      setDebug(data.debug || null)
      setStatus(nextActive ? "Mode incident activé" : "Mode incident désactivé")
    } finally {
      setLoading(false)
    }
  }

  async function loadRaffle(tier = debug?.targetTier || 1) {
    const { response, data } = await fetchJson(`/api/backend-bruno/raffle?tier=${tier}`)
    if (!response.ok || !data.ok) return
    setRaffleEntries(data.entries || [])
    setRaffleWinners(data.winners || [])
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
          setStatus("E-mail non éligible Ulule : contribution avec contrepartie ou >= 10 € requise")
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
      setRaffleWinners(data.raffle?.winners || [])
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
      setRaffleWinners(data.raffle?.winners || [])
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
      if (data.winners?.length) {
        const featuredWinner = data.winners[data.winners.length - 1]
        await animateRoulette(entries, featuredWinner.id)
      }
      setRaffleWinners(data.raffle?.winners || data.winners || [])
      setStatus(`Tirage terminé: ${data.raffle?.winnersCount || data.winners?.length || 0} gagnant(s)`)
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
          <OldeupeLogo className="brand-logo admin-brand-logo" src={logoSrc} />
          <h1>Tableau de bord live</h1>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={loadDashboard} disabled={loading}>
            {loading ? "Chargement..." : "Rafraîchir"}
          </button>
          <Link className="btn ghost" to="/admin/raffle">
            Vue tirage
          </Link>
          <Link className="btn ghost" to="/admin/raffle/stage">
            Projection tirage
          </Link>
          <Link className="btn ghost" to="/admin/manage">
            Vue édition
          </Link>
          <Link className="btn ghost" to="/admin/control">
            Pilotage mobile
          </Link>
          <Link className="btn ghost" to="/admin/winners">
            Gagnants
          </Link>
          <Link className="btn ghost" to="/admin/milestones">
            Tirages cagnotte
          </Link>
          <Link className="btn ghost" to="/admin/challenges">
            Défis collectifs
          </Link>
          <Link className="btn ghost" to="/admin/content">
            Textes
          </Link>
          <button className="btn ghost" onClick={logout}>
            Déconnexion
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
            <button className="btn danger" onClick={resetAll} disabled={loading}>
              Réinitialisation complète
            </button>
            <button
              className={`btn ${debug?.gameEnded ? "ghost" : "danger"}`}
              onClick={() => toggleGameEnded(!debug?.gameEnded)}
              disabled={loading}
            >
              {debug?.gameEnded ? "Réouvrir le jeu" : "Fin du jeu"}
            </button>
            <button
              className={`btn ${debug?.gameFallbackActive ? "ghost" : "danger"}`}
              onClick={() => toggleGameFallback(!debug?.gameFallbackActive)}
              disabled={loading}
            >
              {debug?.gameFallbackActive ? "Retirer le fallback" : "Activer le fallback"}
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
              Palier en cours : <strong>{debug.targetLabel}</strong>
              {debug?.tierLocked ? " (gagnant trouvé, passe au palier suivant)" : ""}
            </p>
          ) : null}
          {debug?.targetTier ? (
            <div className="current-reward-banner admin-reward-banner">
              <span>Lot en jeu</span>
              <strong>{(tierRewards[`reward.line_${debug.targetTier}`] || "").trim() || "Aucun lot saisi pour cette manche"}</strong>
            </div>
          ) : null}
          {debug?.gameEnded ? <p className="status">Le jeu est actuellement terminé pour tous les joueurs.</p> : null}
          {debug?.gameFallbackActive ? <p className="status">Le fallback technique est actuellement affiché à tous les joueurs.</p> : null}
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
              Enregistrer URLs
            </button>
          </div>
          <div className="row">
            <input
              className="input"
              type="url"
              placeholder="https://fr.ulule.com/..."
              value={ululePageInput}
              onChange={(e) => setUlulePageInput(e.target.value)}
            />
          </div>
          <div className="row">
            <textarea
              className="input content-editor-textarea"
              rows="3"
              placeholder="Message affiché sous le compte à rebours"
              value={liveMessage}
              onChange={(e) => setLiveMessage(e.target.value)}
            />
            <button className="btn ghost" onClick={saveLiveMessage} disabled={loading}>
              Enregistrer message
            </button>
          </div>
          {debug?.rows ? (
            <div className="panel" style={{ marginTop: 14, marginBottom: 0 }}>
              <h2>Gains par manche</h2>
              <div className="content-editor-list">
                {Array.from({ length: Number(debug.rows) }, (_, index) => {
                  const tier = index + 1
                  const key = `reward.line_${tier}`
                  const label = tier === Number(debug.rows) ? "Carton plein" : `${tier} ligne${tier > 1 ? "s" : ""}`
                  return (
                    <label key={key} className="content-editor-item">
                      <span className="content-editor-key">{label}</span>
                      <textarea
                        className="input content-editor-textarea"
                        rows="2"
                        placeholder={`Gain pour ${label}`}
                        value={tierRewards[key] || ""}
                        onChange={(e) => setTierRewards((prev) => ({ ...prev, [key]: e.target.value }))}
                      />
                    </label>
                  )
                })}
              </div>
              <h2 style={{ marginTop: 18 }}>Gagnants par manche</h2>
              <div className="content-editor-list">
                {Array.from({ length: Number(debug.rows) }, (_, index) => {
                  const tier = index + 1
                  const key = `line_${tier}`
                  const label = tier === Number(debug.rows) ? "Carton plein" : `${tier} ligne${tier > 1 ? "s" : ""}`
                  const winnersCount = Number(debug?.raffle?.byTier?.[key]?.winnersCount || 0)
                  const quota = Number(raffleQuotas[key] || debug?.raffle?.byTier?.[key]?.quota || 1)
                  return (
                    <label key={key} className="content-editor-item quota-editor-item">
                      <span className="content-editor-key">{label}</span>
                      <div className="quota-editor-row">
                        <input
                          className="input quota-editor-input"
                          type="number"
                          min="1"
                          max="50"
                          value={quota}
                          onChange={(e) =>
                            setRaffleQuotas((prev) => ({
                              ...prev,
                              [key]: e.target.value
                            }))
                          }
                        />
                        <small className="hint">
                          Tirés: {winnersCount} / {Number(debug?.raffle?.byTier?.[key]?.quota || quota || 1)}
                        </small>
                      </div>
                    </label>
                  )
                })}
              </div>
              <div className="row">
                <button className="btn ghost" onClick={saveTierRewards} disabled={loading}>
                  Enregistrer les gains
                </button>
                <button className="btn ghost" onClick={saveRaffleQuotas} disabled={loading}>
                  Enregistrer les gagnants
                </button>
              </div>
            </div>
          ) : null}
          {debug && (
            <>
              <div className="kpis">
                <div><strong>{debug.events}</strong><span>événements</span></div>
                <div><strong>{debug.players}</strong><span>cartes attribuées</span></div>
                <div><strong>{debug.connectedPlayers || 0}</strong><span>joueurs connectés</span></div>
                <div><strong>{debug.triggered}</strong><span>tirés</span></div>
                <div><strong>{debug.activationCount || 0}</strong><span>activations</span></div>
                <div><strong>{debug.rows}x{debug.cols}</strong><span>grille</span></div>
                <div><strong>{formatDateTime(debug.ulule?.lastSyncAt)}</strong><span>dernière synchro Ulule</span></div>
              </div>
              <div className="round-timeline">
                {roundTimeline.map((item) => (
                  <div key={item.tier} className={`round-timeline-item ${item.state}`}>
                    <div className="round-timeline-head">
                      <strong>{item.label}</strong>
                      <span className={`round-badge ${item.state}`}>
                        {item.state === "drawn" ? "Tiré" : item.state === "active" ? "En jeu" : "À venir"}
                      </span>
                    </div>
                    {item.winnersCount > 0 ? <small>{item.winnersCount} / {item.quota} gagnants tirés</small> : item.state === "active" ? <small>Manche en cours</small> : <small>Pas encore lancé</small>}
                  </div>
                ))}
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
        <p className="hint">Palier actif : <strong>{debug?.targetLabel || "1 ligne"}</strong></p>
        <p className="hint">
          Gagnants prévus : <strong>{debug?.raffle?.byTier?.[`line_${debug?.targetTier || 1}`]?.quota || 1}</strong>
          {" "}• déjà tirés : <strong>{debug?.raffle?.byTier?.[`line_${debug?.targetTier || 1}`]?.winnersCount || 0}</strong>
        </p>
        <div className="row">
          <input
            className="input"
            type="email"
            placeholder="e-mail de contribution Ulule"
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
          <button
            className="btn"
            onClick={drawRaffle}
            disabled={raffleLoading || raffleEntries.length === 0 || Number(debug?.raffle?.byTier?.[`line_${debug?.targetTier || 1}`]?.winnersCount || 0) > 0}
          >
            {Number(debug?.raffle?.byTier?.[`line_${debug?.targetTier || 1}`]?.winnersCount || 0) > 0 ? "Tirage déjà effectué" : "Lancer le tirage"}
          </button>
        </div>

        <div className={`raffle-roulette ${rouletteSpinning ? "spinning" : ""}`}>
          {raffleEntries.length === 0 ? (
            <div className="raffle-empty">Aucun préinscrit pour ce palier</div>
          ) : (
            raffleEntries.slice(0, 80).map((entry, index) => (
              <div
                key={entry.id}
                className={`raffle-item ${index === rouletteIndex ? "active" : ""} ${raffleWinners.some((winner) => winner.id === entry.id) ? "winner" : ""}`}
              >
                <strong>{formatParticipant(entry)}</strong>
                {entry.ulule ? (
                  <small>
                    Ulule validé • {entry.ulule.hasReward ? "contrepartie" : "don"} • {(entry.ulule.orderTotalCents / 100).toFixed(2)} €
                  </small>
                ) : null}
              </div>
            ))
          )}
        </div>

        <p className="hint">Préinscrits : <strong>{raffleEntries.length}</strong></p>
        {raffleWinners.length > 0 ? (
          <div className="status">
            <strong>Gagnants tirés au sort :</strong>{" "}
            {raffleWinners.map((winner) => formatParticipant(winner)).join(" • ")}
          </div>
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

      <section className="panel">
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Journal opérateur</summary>
          <div className="admin-log-list" style={{ marginTop: 12 }}>
            {(debug?.adminLogs || []).length === 0 ? (
              <p className="hint">Aucune action opérateur récente.</p>
            ) : (
              (debug?.adminLogs || []).slice().reverse().map((item) => (
                <div key={item.id} className="admin-log-item">
                  <strong>{item.action}</strong>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        </details>
      </section>

      {status && <p className="status">{status}</p>}
    </div>
  )
}
