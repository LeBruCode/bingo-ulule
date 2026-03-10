import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"
import useBrandLogo from "../hooks/useBrandLogo.js"

export default function AdminRaffle() {
  const navigate = useNavigate()
  const [logoSrc] = useBrandLogo()
  const [debug, setDebug] = useState(null)
  const [tier, setTier] = useState(1)
  const [entries, setEntries] = useState([])
  const [winner, setWinner] = useState(null)
  const [loading, setLoading] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [cursorIndex, setCursorIndex] = useState(0)
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

  const activeEntry = entries.length > 0 ? entries[cursorIndex % entries.length] : null

  const visibleCandidates = useMemo(() => {
    if (entries.length === 0) return []
    const current = cursorIndex % entries.length
    const windowSize = 9
    return Array.from({ length: windowSize }, (_, idx) => {
      const offset = idx - Math.floor(windowSize / 2)
      const index = (current + offset + entries.length) % entries.length
      return { entry: entries[index], index, isCenter: offset === 0 }
    })
  }, [entries, cursorIndex])

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

  async function loadRaffle(nextTier) {
    const { response, data } = await fetchJson(`/api/backend-bruno/raffle?tier=${nextTier}`)
    if (!response.ok || !data.ok) return
    setEntries(data.entries || [])
    setWinner(data.winner || null)
    setCursorIndex(0)
  }

  async function bootstrap() {
    setLoading(true)
    setStatus("")
    try {
      const nextDebug = await loadDebug()
      const nextTier = Number(nextDebug?.targetTier || 1)
      setTier(nextTier)
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
        setStatus(`Erreur palier: ${data.error || "unknown_error"}`)
        return
      }
      setDebug(data.debug || null)
      setTier(nextTier)
      await loadRaffle(nextTier)
      setStatus(`Palier actif: ${data.debug?.targetLabel || `${nextTier} ligne(s)`}`)
    } finally {
      setLoading(false)
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function animateAndStop(entriesList, winnerId) {
    if (entriesList.length === 0) return
    setSpinning(true)
    let nextIndex = 0
    for (let i = 0; i < 64; i++) {
      nextIndex = (nextIndex + 1) % entriesList.length
      setCursorIndex(nextIndex)
      await sleep(25 + i * 5)
    }
    const winnerIndex = Math.max(
      0,
      entriesList.findIndex((entry) => entry.id === winnerId)
    )
    setCursorIndex(winnerIndex)
    setSpinning(false)
  }

  async function drawWinner() {
    if (entries.length === 0) {
      setStatus("Aucun candidat pour ce palier")
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
      if (data.winner?.id) {
        await animateAndStop(nextEntries, data.winner.id)
      }
      setWinner(data.raffle?.winner || data.winner || null)
      setStatus("Tirage terminé")
    } finally {
      setLoading(false)
    }
  }

  const tierButtons = Array.from({ length: Number(debug?.rows || 0) }, (_, i) => {
    const n = i + 1
    return {
      tier: n,
      label: n === Number(debug?.rows || 0) ? "Carton plein" : `${n} ligne${n > 1 ? "s" : ""}`
    }
  })

  return (
    <div className="raffle-shell">
      <header className="raffle-topbar">
        <div className="raffle-title-wrap">
          <OldeupeLogo className="brand-logo raffle-brand-logo" src={logoSrc} />
          <span className="raffle-kicker">Bingo Live</span>
          <h1>Tirage au sort</h1>
          <p>
            Palier en jeu: <strong>{debug?.targetLabel || `${tier} ligne`}</strong>
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
        <div className="raffle-stage-head">
          <div className={`raffle-pulse ${spinning ? "on" : ""}`}>TIRAGE {spinning ? "• TOC TOC TOC •" : "PRÊT"}</div>
          <div className="raffle-counts">
            <span>Candidats: <strong>{entries.length}</strong></span>
            <span>Événements tirés: <strong>{debug?.triggered || 0}</strong></span>
            <span>Joueurs: <strong>{debug?.players || 0}</strong></span>
          </div>
        </div>

        <div className="raffle-hero">
          <div className={`raffle-hero-card ${spinning ? "spinning" : ""} ${winner ? "winner" : ""}`}>
            <span className="raffle-hero-label">
              {winner ? "Gagnant sélectionné" : spinning ? "Sélection en cours" : "Candidat au centre"}
            </span>
            <strong>{formatParticipant(winner || activeEntry)}</strong>
            <small>
              {winner
                ? `Palier remporté: ${debug?.targetLabel || `${tier} ligne`}`
                : `${entries.length} candidat${entries.length > 1 ? "s" : ""} en lice`}
            </small>
          </div>
        </div>

        <div className="raffle-slot">
          {visibleCandidates.length === 0 ? (
            <div className="raffle-slot-empty">Aucun candidat pour ce palier</div>
          ) : (
            visibleCandidates.map((item) => (
              <div
                key={`${item.entry.id}-${item.index}`}
                className={`raffle-slot-item ${item.isCenter ? "center" : ""} ${winner?.id === item.entry.id ? "winner" : ""}`}
              >
                <span className="raffle-slot-rank">{String(item.index + 1).padStart(2, "0")}</span>
                <strong>{formatParticipant(item.entry)}</strong>
              </div>
            ))
          )}
        </div>

        <div className="raffle-controls">
          <div className="row raffle-tier-row">
            {tierButtons.map((item) => (
              <button
                key={item.tier}
                className={`btn ghost ${item.tier === tier ? "active" : ""}`}
                onClick={() => changeTier(item.tier)}
                disabled={loading || spinning}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn raffle-launch" onClick={drawWinner} disabled={loading || spinning || entries.length === 0}>
              Lancer le tirage - {debug?.targetLabel || `${tier} ligne`}
            </button>
          </div>
        </div>

        {winner ? (
          <div className="raffle-winner-banner">
            <span>Gagnant du palier</span>
            <strong>{formatParticipant(winner)}</strong>
          </div>
        ) : null}
      </section>

      {status ? <p className="status">{status}</p> : null}
    </div>
  )
}
