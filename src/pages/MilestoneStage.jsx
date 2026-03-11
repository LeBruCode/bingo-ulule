import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"
import useBrandLogo from "../hooks/useBrandLogo.js"

function formatMoney(cents) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format((Number(cents || 0)) / 100)
}

function toDisplayCase(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("fr-FR")
    .replace(/(^|[\s'-])([\p{L}])/gu, (match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("fr-FR")}`)
}

function normalizeDepartmentCode(value) {
  return String(value || "").trim().toUpperCase()
}

function getWinnerIdentity(entry) {
  const firstName = toDisplayCase(entry?.firstName || "Participant")
  const city = toDisplayCase(entry?.city || "")
  const country = toDisplayCase(entry?.country || "")
  const departmentCode = normalizeDepartmentCode(entry?.departmentCode || "")
  const isFrance = !country || ["France", "Fr"].includes(country)

  return {
    firstName,
    city,
    country,
    departmentCode,
    isFrance,
    locationLabel: isFrance ? departmentCode : country
  }
}

function formatWinner(entry) {
  if (!entry) return "Participant"
  const identity = getWinnerIdentity(entry)
  if (identity.city && identity.locationLabel) return `${identity.firstName} • ${identity.city} (${identity.locationLabel})`
  if (identity.city) return `${identity.firstName} • ${identity.city}`
  if (identity.locationLabel) return `${identity.firstName} • ${identity.locationLabel}`
  return identity.firstName
}

export default function MilestoneStage({ adminView = false }) {
  const navigate = useNavigate()
  const [logoSrc] = useBrandLogo()
  const [stage, setStage] = useState({ selectedWindow: null, winnersPerWindow: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [status, setStatus] = useState("")
  const [drawPhase, setDrawPhase] = useState("idle")
  const [stageEntries, setStageEntries] = useState([])
  const [focusEntry, setFocusEntry] = useState(null)
  const [countdownValue, setCountdownValue] = useState(null)
  const animatedWindowRef = useRef("")

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

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 403 && adminView) {
      navigate("/admin/login", { replace: true })
    }
    return { response, payload }
  }

  async function runCountdown() {
    setDrawPhase("countdown")
    for (const value of [3, 2, 1]) {
      setCountdownValue(value)
      await sleep(850)
    }
    setCountdownValue(null)
  }

  async function animateMilestoneDraw(candidatesList, winnersList) {
    if (!Array.isArray(winnersList) || winnersList.length === 0) return
    const winnerIds = new Set(winnersList.map((entry) => entry.id))
    let pool = shuffleList(candidatesList).slice(0, Math.min(40, Math.max(candidatesList.length, winnersList.length)))
    for (const winner of winnersList) {
      if (!pool.some((entry) => entry.id === winner.id)) {
        pool.push(winner)
      }
    }
    pool = shuffleList(pool)
    setStageEntries(pool)
    setFocusEntry(null)
    await runCountdown()
    setDrawPhase("spinning")

    while (pool.length > winnersList.length) {
      const removable = pool.filter((entry) => !winnerIds.has(entry.id))
      if (removable.length === 0) break
      const removed = removable[Math.floor(Math.random() * removable.length)]
      pool = pool.filter((entry) => entry.id !== removed.id)
      setStageEntries(pool)
      setFocusEntry(pool[Math.floor(Math.random() * pool.length)] || null)
      await sleep(pool.length <= Math.max(5, winnersList.length) ? 650 : 210)
    }

    setStageEntries(winnersList)
    setFocusEntry(winnersList[winnersList.length - 1] || null)
    setDrawPhase("done")
  }

  useEffect(() => {
    let cancelled = false

    async function loadStage() {
      try {
        const { response, payload } = await fetchJson("/api/milestone-raffles/stage")
        if (!response.ok || !payload.ok) {
          if (!cancelled) {
            setError(payload.error || "stage_unavailable")
            setLoading(false)
          }
          return
        }
        if (!cancelled) {
          setStage(payload.milestoneStage || { selectedWindow: null, winnersPerWindow: 1 })
          setError("")
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setError("network_error")
          setLoading(false)
        }
      }
    }

    loadStage()
    const timer = setInterval(loadStage, 2500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  async function drawSelectedWindow() {
    if (!selectedWindow?.key) return
    if ((selectedWindow?.winners || []).length > 0) {
      setStatus("Le tirage a déjà été effectué pour cette tranche.")
      return
    }
    setLoading(true)
    setStatus("")
    try {
      const { response, payload } = await fetchJson("/api/backend-bruno/milestone-raffles/draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ windowKey: selectedWindow.key })
      })
      if (!response.ok || !payload.ok) {
        setStatus(`Erreur tirage cagnotte : ${payload.error || "unknown_error"}`)
        return
      }
      setStage(payload.milestoneStage || stage)
      setStatus(`Tirage lancé pour ${formatMoney(selectedWindow.startCents)} → ${formatMoney(selectedWindow.endCents)}`)
    } catch {
      setStatus("Erreur réseau pendant le tirage cagnotte.")
    } finally {
      setLoading(false)
    }
  }

  async function resetSelectedWindow() {
    if (!selectedWindow?.key) return
    setLoading(true)
    setStatus("")
    try {
      const { response, payload } = await fetchJson("/api/backend-bruno/milestone-raffles/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ windowKey: selectedWindow.key })
      })
      if (!response.ok || !payload.ok) {
        setStatus(`Erreur réinitialisation tirage cagnotte : ${payload.error || "unknown_error"}`)
        return
      }
      animatedWindowRef.current = ""
      setDrawPhase("idle")
      setStageEntries([])
      setFocusEntry(null)
      setCountdownValue(null)
      setStage(payload.milestoneStage || stage)
      setStatus(`Tirage réinitialisé pour ${formatMoney(selectedWindow.startCents)} → ${formatMoney(selectedWindow.endCents)}`)
    } catch {
      setStatus("Erreur réseau pendant la réinitialisation du tirage cagnotte.")
    } finally {
      setLoading(false)
    }
  }

  const selectedWindow = stage.selectedWindow || null
  const candidates = Array.isArray(selectedWindow?.candidates) ? selectedWindow.candidates : []
  const winners = Array.isArray(selectedWindow?.winners) ? selectedWindow.winners : []
  const showWindowOnCards = stage.showWindowOnCards !== false
  const previewCandidates = winners.length > 0 ? winners : candidates.slice(0, showWindowOnCards ? 24 : 36)
  const hiddenCandidates = Math.max(0, candidates.length - previewCandidates.length)
  const displayedEntries = drawPhase === "idle" ? previewCandidates : stageEntries
  const suspenseLabel = useMemo(() => {
    const remaining = displayedEntries.length
    if (drawPhase === "done") return "Gagnants sélectionnés"
    if (drawPhase === "countdown") return "Lancement imminent"
    if (remaining <= 2) return "Les derniers finalistes"
    if (remaining <= 5) return "Top 5"
    if (remaining <= 10) return "Top 10"
    return "Élimination en cours"
  }, [displayedEntries.length, drawPhase])

  useEffect(() => {
    const windowKey = selectedWindow?.key || ""
    if (!windowKey) {
      animatedWindowRef.current = ""
      setDrawPhase("idle")
      setStageEntries([])
      setFocusEntry(null)
      setCountdownValue(null)
      return
    }
    if (!winners.length) {
      animatedWindowRef.current = ""
      setDrawPhase("idle")
      setStageEntries([])
      setFocusEntry(null)
      setCountdownValue(null)
      return
    }
    if (animatedWindowRef.current === windowKey) return
    animatedWindowRef.current = windowKey
    animateMilestoneDraw(candidates, winners)
  }, [selectedWindow?.key, winners, candidates])

  return (
    <div className={`milestone-stage-shell${adminView ? " admin-view" : ""}`}>
      <div className="milestone-stage-panel">
        <header className="milestone-stage-head">
          <div>
            <OldeupeLogo className="brand-logo raffle-brand-logo" src={logoSrc} />
            <span className="raffle-kicker">Tirage cagnotte</span>
            <h1>Tranche des {selectedWindow ? `${formatMoney(selectedWindow.startCents)} à ${formatMoney(selectedWindow.endCents)}` : "10 000 EUR"}</h1>
            <p>
              {selectedWindow
                ? `${selectedWindow.candidatesCount} candidat(s) éligible(s) • ${stage.winnersPerWindow} gagnant(s) prévu(s)`
                : "Sélectionne une tranche depuis le back-office."}
            </p>
          </div>
          {adminView ? (
            <div className="row">
              <button className="btn ghost" onClick={resetSelectedWindow} disabled={loading || !selectedWindow}>
                Réinitialiser le tirage
              </button>
              <button className="btn" onClick={drawSelectedWindow} disabled={loading || !selectedWindow || winners.length > 0 || candidates.length === 0}>
                {winners.length > 0 ? "Tirage déjà effectué" : "Lancer le tirage"}
              </button>
            </div>
          ) : null}
        </header>

        {loading ? (
          <div className="raffle-empty">Chargement de la projection...</div>
        ) : error ? (
          <div className="raffle-empty">Projection indisponible : {error}</div>
        ) : !selectedWindow ? (
          <div className="raffle-empty">Aucune tranche sélectionnée pour la projection.</div>
        ) : (
          <>
            {countdownValue !== null ? <div className="raffle-countdown-overlay">{countdownValue}</div> : null}
            <section className="milestone-stage-summary">
              <div>
                <span>Candidats :</span>
                <strong>{selectedWindow.candidatesCount}</strong>
              </div>
              <div>
                <span>Contributions dans la tranche :</span>
                <strong>{selectedWindow.totalOrders}</strong>
              </div>
              <div>
                <span>Montant cumulé de la tranche :</span>
                <strong>{formatMoney(selectedWindow.totalAmountCents)}</strong>
              </div>
              <div>
                <span>Gagnants :</span>
                <strong>{winners.length} / {stage.winnersPerWindow}</strong>
              </div>
            </section>

            <section className="milestone-stage-hero">
              <div className={`milestone-stage-banner ${winners.length > 0 ? "done" : ""}`}>
                <span>{winners.length > 0 ? suspenseLabel : "Tranche en attente de tirage"}</span>
                <strong>
                  {winners.length > 0
                    ? drawPhase === "done"
                      ? `${winners.length} gagnant(s) sélectionné(s)`
                      : focusEntry
                        ? formatWinner(focusEntry)
                        : `${displayedEntries.length} participant(s) encore en lice`
                    : `${selectedWindow.candidatesCount} participant(s) en lice`}
                </strong>
              </div>
            </section>

            <section className={`milestone-stage-grid ${winners.length > 0 ? "winners" : ""} ${showWindowOnCards ? "" : "compact"}`}>
              {displayedEntries.length === 0 ? (
                <div className="raffle-empty">Aucun candidat éligible dans cette tranche.</div>
              ) : (
                displayedEntries.map((entry) => {
                  const identity = getWinnerIdentity(entry)
                  const locationSuffix = identity.city && identity.locationLabel ? identity.locationLabel : ""
                  return (
                  <article
                    key={entry.id}
                    className={`milestone-stage-card ${winners.some((winner) => winner.id === entry.id) && drawPhase === "done" ? "winner" : ""} ${focusEntry?.id === entry.id ? "focus" : ""}`}
                  >
                    <span className="milestone-stage-chip">
                      {winners.some((winner) => winner.id === entry.id) && drawPhase === "done" ? "Gagnant" : "En lice"}
                    </span>
                    <strong>{identity.firstName}</strong>
                    {identity.city ? (
                      <div className="milestone-stage-location">
                        <span>{identity.city}</span>
                        {locationSuffix ? (
                          <small>{`(${locationSuffix})`}</small>
                        ) : null}
                      </div>
                    ) : identity.locationLabel ? (
                      <div className="milestone-stage-location">
                        <small>{`(${identity.locationLabel})`}</small>
                      </div>
                    ) : null}
                    {showWindowOnCards ? (
                      <small>{formatMoney(selectedWindow.startCents)} → {formatMoney(selectedWindow.endCents)}</small>
                    ) : null}
                  </article>
                  )
                })
              )}
            </section>

            {!winners.length && hiddenCandidates > 0 ? (
              <p className="hint milestone-stage-foot">+ {hiddenCandidates} autre(s) candidat(s) dans cette tranche.</p>
            ) : null}
          </>
        )}
        {adminView && status ? <p className="status">{status}</p> : null}
      </div>
    </div>
  )
}
