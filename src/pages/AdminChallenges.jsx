import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import OldeupeLogo from "../components/OldeupeLogo.jsx"
import useBrandLogo from "../hooks/useBrandLogo.js"

const EMPTY_FORM = {
  label: "",
  targetCount: 10,
  durationSeconds: 300,
  type: "eligible_streak"
}

export default function AdminChallenges() {
  const navigate = useNavigate()
  const [logoSrc] = useBrandLogo()
  const [data, setData] = useState({ definitions: [], active: null })
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 403) {
      navigate("/admin/login", { replace: true })
    }
    return { response, payload }
  }

  async function loadChallenges() {
    setLoading(true)
    setStatus("")
    try {
      const { response, payload } = await fetchJson("/api/backend-bruno/challenges")
      if (!response.ok || !payload.ok) {
        setStatus(`Erreur chargement des défis : ${payload.error || "unknown_error"}`)
        return
      }
      setData(payload.challenges || { definitions: [], active: null })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadChallenges()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds || 0))
    const minutes = Math.floor(total / 60)
    const remaining = total % 60
    if (remaining === 0) return `${minutes} min`
    return `${minutes} min ${remaining}s`
  }

  function formatRemaining(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }

  async function createChallenge() {
    setLoading(true)
    setStatus("")
    try {
      const { response, payload } = await fetchJson("/api/backend-bruno/challenges", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form)
      })
      if (!response.ok || !payload.ok) {
        setStatus(`Erreur création défi : ${payload.error || "unknown_error"}`)
        return
      }
      setData(payload.challenges || data)
      setForm(EMPTY_FORM)
      setStatus("Défi enregistré")
    } finally {
      setLoading(false)
    }
  }

  async function startChallenge(id) {
    setLoading(true)
    setStatus("")
    try {
      const { response, payload } = await fetchJson("/api/backend-bruno/challenges/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      })
      if (!response.ok || !payload.ok) {
        setStatus(`Erreur lancement défi : ${payload.error || "unknown_error"}`)
        return
      }
      setData(payload.challenges || data)
      setStatus("Défi lancé")
    } finally {
      setLoading(false)
    }
  }

  async function stopChallenge() {
    setLoading(true)
    setStatus("")
    try {
      const { response, payload } = await fetchJson("/api/backend-bruno/challenges/stop", {
        method: "POST"
      })
      if (!response.ok || !payload.ok) {
        setStatus(`Erreur arrêt défi : ${payload.error || "unknown_error"}`)
        return
      }
      setData(payload.challenges || data)
      setStatus("Défi arrêté")
    } finally {
      setLoading(false)
    }
  }

  async function deleteChallenge(id) {
    setLoading(true)
    setStatus("")
    try {
      const { response, payload } = await fetchJson(`/api/backend-bruno/challenges/${id}`, {
        method: "DELETE"
      })
      if (!response.ok || !payload.ok) {
        setStatus(`Erreur suppression défi : ${payload.error || "unknown_error"}`)
        return
      }
      setData(payload.challenges || data)
      setStatus("Défi supprimé")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <OldeupeLogo className="brand-logo admin-brand-logo" src={logoSrc} />
          <h1>Défis collectifs</h1>
          <p>Défis temporaires visibles à l’écran, mis à jour automatiquement avec les contributions Ulule.</p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/admin">
            Retour dashboard
          </Link>
          <Link className="btn ghost" to="/overlay/challenges" target="_blank" rel="noreferrer">
            Ouvrir la projection
          </Link>
          <button className="btn ghost" onClick={loadChallenges} disabled={loading}>
            {loading ? "Chargement..." : "Rafraîchir"}
          </button>
        </div>
      </div>

      <section className="panel">
        <h2>Défi en cours</h2>
        {data.active ? (
          <div className={`collective-active-card ${data.active.status}`}>
            <div className="collective-active-head">
              <div>
                <strong>{data.active.label}</strong>
                <span>{data.active.targetCount} dons consécutifs éligibles à atteindre</span>
              </div>
              <span className={`pill ${data.active.status === "completed" ? "on" : data.active.status === "running" ? "pending" : ""}`}>
                {data.active.status === "completed" ? "Réussi" : data.active.status === "running" ? "En cours" : "Terminé"}
              </span>
            </div>
            <div className="collective-active-metrics">
              <span>Progression : {data.active.progress} / {data.active.targetCount}</span>
              <span>Temps restant : {formatRemaining(data.active.remainingMs)}</span>
            </div>
            <div className="row">
              <button className="btn danger" onClick={stopChallenge} disabled={loading || data.active.status !== "running"}>
                Arrêter le défi
              </button>
            </div>
          </div>
        ) : (
          <p className="hint">Aucun défi en cours. La vue StreamElements reste vide tant qu’aucun défi n’est lancé.</p>
        )}
      </section>

      <section className="panel">
        <h2>Nouveau défi</h2>
        <div className="content-editor-list">
          <label className="content-editor-item">
            <span className="content-editor-key">Titre du défi</span>
            <input
              className="input"
              value={form.label}
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder="10 dons d’affilée"
            />
          </label>
          <label className="content-editor-item">
            <span className="content-editor-key">Objectif</span>
            <input
              className="input"
              type="number"
              min="1"
              max="100"
              value={form.targetCount}
              onChange={(e) => setForm((prev) => ({ ...prev, targetCount: e.target.value }))}
            />
          </label>
          <label className="content-editor-item">
            <span className="content-editor-key">Durée en secondes</span>
            <input
              className="input"
              type="number"
              min="30"
              max="3600"
              value={form.durationSeconds}
              onChange={(e) => setForm((prev) => ({ ...prev, durationSeconds: e.target.value }))}
            />
          </label>
        </div>
        <div className="row">
          <button className="btn" onClick={createChallenge} disabled={loading}>
            Enregistrer le défi
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Défis disponibles</h2>
        <div className="admin-milestone-list">
          {(data.definitions || []).length === 0 ? (
            <p className="hint">Aucun défi enregistré pour le moment.</p>
          ) : (
            data.definitions.map((challenge) => (
              <article key={challenge.id} className="admin-milestone-item">
                <div className="admin-milestone-head">
                  <div>
                    <strong>{challenge.label}</strong>
                    <span>{challenge.targetCount} dons consécutifs éligibles • {formatDuration(challenge.durationSeconds)}</span>
                  </div>
                  <div className="row">
                    <button className="btn" onClick={() => startChallenge(challenge.id)} disabled={loading}>
                      Lancer
                    </button>
                    <button className="btn ghost" onClick={() => deleteChallenge(challenge.id)} disabled={loading}>
                      Supprimer
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {status ? <p className="status">{status}</p> : null}
    </div>
  )
}
