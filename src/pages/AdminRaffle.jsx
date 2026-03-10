import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"
import useBrandLogo from "../hooks/useBrandLogo.js"

export default function AdminRaffle() {
  const navigate = useNavigate()
  const [logoSrc] = useBrandLogo()
  const [debug, setDebug] = useState(null)
  const [content, setContent] = useState({})
  const [tier, setTier] = useState(1)
  const [entries, setEntries] = useState([])
  const [winners, setWinners] = useState([])
  const [loading, setLoading] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [rafflePhase, setRafflePhase] = useState("idle")
  const [stageEntries, setStageEntries] = useState([])
  const [focusEntry, setFocusEntry] = useState(null)
  const [countdownValue, setCountdownValue] = useState(null)
  const [status, setStatus] = useState("")

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

  const previewEntries = useMemo(() => {
    if (entries.length <= 48) return entries
    return entries.slice(0, 48)
  }, [entries])

  const finalists = useMemo(() => {
    if (!Array.isArray(stageEntries)) return []
    return stageEntries.slice(0, Math.min(5, stageEntries.length))
  }, [stageEntries])

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
    if (errorCode === "cannot_decrease_tier") return "Impossible de revenir a une manche precedente."
    return errorCode || "unknown_error"
  }

  async function loadDebug() {
    const { response, data } = await fetchJson("/api/backend-bruno/debug")
    if (!response.ok) {
      if (response.status === 403) {
        navigate("/admin/login", { replace: true })
      }
      return null
    }
    setDebug(data)
    return data
  }

  async function loadContent() {
    const { response, data } = await fetchJson("/api/backend-bruno/content")
    if (!response.ok || !data.ok) return
    setContent(data.content || {})
  }

  async function loadRaffle(nextTier) {
    const { response, data } = await fetchJson(`/api/backend-bruno/raffle?tier=${nextTier}`)
    if (!response.ok || !data.ok) return
    const nextEntries = data.entries || []
    const nextWinners = data.winners || []
    const nextWinner = nextWinners[nextWinners.length - 1] || null
    setEntries(nextEntries)
    setWinners(nextWinners)
    setRafflePhase(nextWinner ? "winner" : "idle")
    setCountdownValue(null)
    if (nextWinner?.id) {
      const winnerEntry = nextEntries.find((entry) => entry.id === nextWinner.id) || nextWinner
      setStageEntries(winnerEntry ? [winnerEntry] : [])
      setFocusEntry(winnerEntry || null)
    } else {
      setStageEntries([])
      setFocusEntry(null)
    }
  }

  async function bootstrap() {
    setLoading(true)
    setStatus("")
    try {
      const nextDebug = await loadDebug()
      const nextTier = Number(nextDebug?.targetTier || 1)
      setTier(nextTier)
      await loadContent()
      await loadRaffle(nextTier)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const interval = setInterval(async () => {
      if (loading || spinning) return
      const nextDebug = await loadDebug()
      if (!nextDebug) return
      const nextTier = Number(nextDebug?.targetTier || tier)
      if (nextTier !== tier) setTier(nextTier)
      await loadRaffle(nextTier)
    }, 2500)
    return () => clearInterval(interval)
  }, [loading, spinning, tier])

  async function changeTier(nextTier) {
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/backend-bruno/target-tier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: nextTier })
      })
      if (!response.ok || !data.ok) {
        setStatus(`Erreur palier: ${humanizeError(data.error)}`)
        return
      }
      setDebug(data.debug || null)
      setTier(nextTier)
      await loadRaffle(nextTier)
      setStatus(`Palier actif : ${data.debug?.targetLabel || `${nextTier} ligne(s)`}`)
    } finally {
      setLoading(false)
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function shuffleList(list) {
    const next = [...list]
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[next[i], next[j]] = [next[j], next[i]]
    }
    return next
  }

  function buildStagePool(entriesList, winnerId) {
    if (entriesList.length <= 1) return entriesList
    const winnerEntry = entriesList.find((entry) => entry.id === winnerId)
    const others = shuffleList(entriesList.filter((entry) => entry.id !== winnerId))
    const limit = Math.min(entriesList.length, 40)
    const selected = winnerEntry ? [winnerEntry, ...others.slice(0, Math.max(0, limit - 1))] : others.slice(0, limit)
    return shuffleList(selected)
  }

  async function animateDraw(entriesList, winnerEntry) {
    if (!winnerEntry || entriesList.length === 0) return
    const winnerId = winnerEntry.id
    let pool = buildStagePool(entriesList, winnerId)
    setSpinning(true)
    setWinners([])
    setRafflePhase("elimination")
    setStageEntries(pool)
    setFocusEntry(null)

    if (pool.length === 1) {
      await sleep(1200)
      setFocusEntry(winnerEntry)
      setRafflePhase("winner")
      setWinners([winnerEntry])
      setSpinning(false)
      return
    }

    const finalistTarget = Math.min(5, pool.length)
    const earlyEliminations = Math.max(0, pool.length - finalistTarget)
    const finalEliminations = Math.max(0, finalistTarget - 1)
    const earlyDelay = earlyEliminations > 0 ? 11000 / earlyEliminations : 0
    const finalDelay = finalEliminations > 0 ? 4500 / finalEliminations : 0

    while (pool.length > finalistTarget) {
      const removable = pool.filter((entry) => entry.id !== winnerId)
      const removed = removable[Math.floor(Math.random() * removable.length)]
      pool = pool.filter((entry) => entry.id !== removed.id)
      setStageEntries(pool)
      setFocusEntry(pool[Math.floor(Math.random() * pool.length)] || null)
      await sleep(Math.max(180, earlyDelay))
    }

    setRafflePhase("finalists")
    setFocusEntry(pool[Math.floor(Math.random() * pool.length)] || null)
    await sleep(1400)

    while (pool.length > 1) {
      const removable = pool.filter((entry) => entry.id !== winnerId)
      const removed = removable[Math.floor(Math.random() * removable.length)]
      pool = pool.filter((entry) => entry.id !== removed.id)
      setStageEntries(pool)
      setFocusEntry(pool[Math.floor(Math.random() * pool.length)] || null)
      await sleep(Math.max(650, finalDelay))
    }

    setStageEntries(pool)
    setFocusEntry(winnerEntry)
    setRafflePhase("winner")
    setWinners([winnerEntry])
    setSpinning(false)
  }

  async function runCountdown() {
    setRafflePhase("countdown")
    for (const value of [3, 2, 1]) {
      setCountdownValue(value)
      await sleep(850)
    }
    setCountdownValue(null)
  }

  async function drawWinner() {
    if (entries.length === 0) {
      setStatus("Aucun candidat pour ce palier")
      return
    }
    if (winners.length > 0) {
      setStatus("Le tirage a déjà été effectué pour cette manche")
      return
    }
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/backend-bruno/raffle/draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier })
      })
      if (!response.ok || !data.ok) {
        setStatus(`Erreur tirage: ${data.error || "unknown_error"}`)
        return
      }
      const nextEntries = data.raffle?.entries || entries
      setEntries(nextEntries)
      if (data.winners?.length) {
        const featuredWinner = data.winners[data.winners.length - 1]
        const winnerEntry = nextEntries.find((entry) => entry.id === featuredWinner.id) || data.raffle?.winner || featuredWinner
        await runCountdown()
        await animateDraw(nextEntries, winnerEntry)
      }
      setWinners(data.raffle?.winners || data.winners || [])
      setStatus(`Tirage terminé: ${data.raffle?.winnersCount || data.winners?.length || 0} gagnant(s)`)
    } finally {
      setLoading(false)
    }
  }

  const tierButtons = Array.from({ length: Number(debug?.rows || 0) }, (_, i) => {
    const n = i + 1
    const tierKey = `line_${n}`
    const winnersCount = Number(debug?.raffle?.byTier?.[tierKey]?.winnersCount || 0)
    return {
      tier: n,
      label: n === Number(debug?.rows || 0) ? "Carton plein" : `${n} ligne${n > 1 ? "s" : ""}`,
      hasWinner: winnersCount > 0,
      winnersCount,
      quota: Number(debug?.raffle?.byTier?.[tierKey]?.quota || 1)
    }
  })
  const currentReward = typeof content[`reward.line_${tier}`] === "string" ? content[`reward.line_${tier}`].trim() : ""
  const featuredWinner = winners[winners.length - 1] || null
  const displayEntries = spinning || rafflePhase === "finalists" || featuredWinner ? stageEntries : previewEntries
  const gridClassName = `raffle-grid ${rafflePhase === "finalists" ? "finalists" : ""} ${featuredWinner ? "winner" : ""} ${displayEntries.length >= 28 ? "dense" : displayEntries.length >= 16 ? "wide" : "comfortable"}`
  const activeTierAlreadyDrawn = Boolean(tierButtons.find((item) => item.tier === tier)?.hasWinner)
  const activeTierQuota = Number(tierButtons.find((item) => item.tier === tier)?.quota || 1)

  return (
    <div className="raffle-shell">
      <header className="raffle-topbar">
        <div className="raffle-title-wrap">
          <OldeupeLogo className="brand-logo raffle-brand-logo" src={logoSrc} />
          <span className="raffle-kicker">Bingo Live</span>
          <h1>Tirage au sort</h1>
          <p>
            Palier en jeu : <strong>{debug?.targetLabel || `${tier} ligne`}</strong>
          </p>
        </div>
        <div className="row raffle-admin-actions">
          <Link className="btn ghost" to="/admin">
            Retour dashboard
          </Link>
          <button className="btn ghost" onClick={bootstrap} disabled={loading}>
            {loading ? "Chargement..." : "Rafraîchir"}
          </button>
        </div>
      </header>

      <section className="raffle-stage">
        <div className="raffle-orb raffle-orb-left" />
        <div className="raffle-orb raffle-orb-right" />
        {countdownValue !== null ? <div className="raffle-countdown-overlay">{countdownValue}</div> : null}
        <div className="raffle-stage-head">
          <div className={`raffle-pulse ${spinning ? "on" : ""}`}>TIRAGE {spinning ? "• TOC TOC TOC •" : "PRÊT"}</div>
          <div className="raffle-counts">
            <span>Candidats: <strong>{entries.length}</strong></span>
            <span>Gagnants à tirer: <strong>{activeTierQuota}</strong></span>
            <span>Événements tirés: <strong>{debug?.triggered || 0}</strong></span>
            <span>Joueurs connectés: <strong>{debug?.connectedPlayers || 0}</strong></span>
          </div>
        </div>

        <div className="raffle-hero">
          <div className={`raffle-hero-card ${spinning ? "spinning" : ""} ${featuredWinner ? "winner" : ""}`}>
            <span className="raffle-hero-label">
              {featuredWinner ? "Gagnants sélectionnés" : rafflePhase === "countdown" ? "Lancement imminent" : rafflePhase === "finalists" ? "Les 5 derniers" : spinning ? "Élimination en cours" : "Tirage prêt"}
            </span>
            <strong>
              {featuredWinner
                ? `${winners.length} gagnant${winners.length > 1 ? "s" : ""}`
                : rafflePhase === "countdown"
                  ? "3 • 2 • 1"
                : focusEntry && (spinning || rafflePhase === "finalists")
                  ? formatParticipant(focusEntry)
                  : "Prêt pour le tirage"}
            </strong>
            <small>
              {featuredWinner
                ? `Palier tiré: ${debug?.targetLabel || `${tier} ligne`} • ${winners.length} / ${activeTierQuota}`
                : rafflePhase === "countdown"
                  ? "Le tirage démarre maintenant"
                : rafflePhase === "finalists"
                  ? `Suspense final entre ${finalists.length} candidat${finalists.length > 1 ? "s" : ""}`
                  : spinning
                    ? `${stageEntries.length} carte${stageEntries.length > 1 ? "s" : ""} encore en lice`
                    : `${entries.length} candidat${entries.length > 1 ? "s" : ""} en attente du lancement`}
            </small>
          </div>
        </div>

        <div className={gridClassName}>
          {displayEntries.length === 0 ? (
            <div className="raffle-slot-empty">Aucun candidat pour ce palier</div>
          ) : (
            displayEntries.map((entry) => (
              <div
                key={entry.id}
                className={`raffle-grid-card ${focusEntry?.id === entry.id ? "focus" : ""} ${winners.some((winnerItem) => winnerItem.id === entry.id) ? "winner" : ""} ${finalists.some((item) => item.id === entry.id) ? "finalist" : ""}`}
              >
                <span className="raffle-grid-chip">
                  {winners.some((winnerItem) => winnerItem.id === entry.id) ? "Gagnant" : finalists.some((item) => item.id === entry.id) && rafflePhase === "finalists" ? "Finaliste" : "En lice"}
                </span>
                <strong>{formatParticipant(entry)}</strong>
              </div>
            ))
          )}
        </div>

        <div className="raffle-controls">
          <div className="row raffle-tier-row">
            {tierButtons.map((item) => (
              <button
                key={item.tier}
                className={`btn ghost ${item.tier === tier ? "active" : ""} ${item.hasWinner ? "done" : ""}`}
                onClick={() => changeTier(item.tier)}
                disabled={loading || spinning}
              >
                {item.label} • {item.winnersCount}/{item.quota}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn raffle-launch" onClick={drawWinner} disabled={loading || spinning || entries.length === 0 || activeTierAlreadyDrawn}>
              {activeTierAlreadyDrawn ? `Tirage déjà effectué - ${debug?.targetLabel || `${tier} ligne`}` : `Lancer le tirage - ${debug?.targetLabel || `${tier} ligne`}`}
            </button>
          </div>
        </div>

        {featuredWinner ? (
          <div className="raffle-winner-banner">
            <span>Résultat du tirage</span>
            <strong>{winners.length} gagnant{winners.length > 1 ? "s" : ""}</strong>
            <div className="raffle-winner-list">
              {winners.map((winnerItem) => (
                <div key={winnerItem.id} className="raffle-winner-list-item">
                  {formatParticipant(winnerItem)}
                </div>
              ))}
            </div>
            <p>Bravo aux gagnants. Vous remportez : {currentReward || "le lot de cette manche"}.</p>
          </div>
        ) : null}
      </section>

      {status ? <p className="status">{status}</p> : null}
    </div>
  )
}
