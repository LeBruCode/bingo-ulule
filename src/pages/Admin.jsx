import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

const CATEGORIES = ["coulisses", "creative", "chat", "public", "dons", "general"]

export default function Admin() {
  const navigate = useNavigate()
  const [debug, setDebug] = useState(null)
  const [events, setEvents] = useState([])
  const [newEventName, setNewEventName] = useState("")
  const [newEventCategory, setNewEventCategory] = useState("general")
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState("")
  const [editingCategory, setEditingCategory] = useState("general")
  const [triggerName, setTriggerName] = useState("")
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")

  const adminKey = localStorage.getItem("bingoAdminKey") || ""

  const authHeaders = useMemo(
    () => ({
      "x-admin-key": adminKey,
      "content-type": "application/json"
    }),
    [adminKey]
  )

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options)
    const data = await response.json().catch(() => ({}))
    return { response, data }
  }

  async function loadDashboard() {
    setLoading(true)
    setStatus("")
    try {
      const [debugCall, eventsCall] = await Promise.all([
        fetchJson("/api/admin/debug", { headers: authHeaders }),
        fetchJson("/api/admin/events", { headers: authHeaders })
      ])

      if (!debugCall.response.ok || !eventsCall.response.ok) {
        setDebug(null)
        setEvents([])
        setStatus("Session invalide: reconnecte-toi")
        return
      }

      setDebug(debugCall.data)
      setEvents(eventsCall.data.events || [])
      setStatus("Dashboard charge")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!adminKey) {
      navigate("/admin/login", { replace: true })
      return
    }
    loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addEvent() {
    if (!newEventName.trim()) return
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/admin/events", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: newEventName, category: newEventCategory })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur ajout: ${data.error || "unknown_error"}`)
        return
      }

      setNewEventName("")
      setNewEventCategory("general")
      setStatus("Evenement ajoute (cartes regenerees)")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function saveRename(id) {
    if (!editingName.trim()) return
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson(`/api/admin/events/${id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ name: editingName, category: editingCategory })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur edition: ${data.error || "unknown_error"}`)
        return
      }

      setEditingId(null)
      setEditingName("")
      setEditingCategory("general")
      setStatus("Intitule mis a jour (cartes regenerees)")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function triggerEvent() {
    if (!triggerName.trim()) return
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/admin/trigger", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ event: triggerName })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur trigger: ${data.error || "unknown_error"}`)
        return
      }

      setStatus(data.duplicated ? "Evenement deja declenche" : "Evenement declenche")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function reloadFromSupabase() {
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/admin/reload", {
        method: "POST",
        headers: authHeaders
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur reload: ${data.error || "unknown_error"}`)
        return
      }

      setStatus("Evenements recharges depuis Supabase")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  async function resetRound() {
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/admin/reset-round", {
        method: "POST",
        headers: authHeaders
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur reset: ${data.error || "unknown_error"}`)
        return
      }

      setStatus("Round reset")
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  function logout() {
    localStorage.removeItem("bingoAdminKey")
    navigate("/admin/login", { replace: true })
  }

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <h1>Live Dashboard</h1>
          <p>Gestion des evenements, du round et du debug live.</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={loadDashboard} disabled={loading}>
            {loading ? "Chargement..." : "Rafraichir"}
          </button>
          <button className="btn ghost" onClick={logout}>
            Deconnexion
          </button>
        </div>
      </div>

      <div className="admin-grid">
        <section className="panel">
          <h2>Session</h2>
          <p className="hint">Dashboard protege par ADMIN_KEY. Session locale active.</p>
        </section>

        <section className="panel">
          <h2>Round</h2>
          <div className="row">
            <button className="btn" onClick={reloadFromSupabase} disabled={loading}>
              Recharger depuis Supabase
            </button>
            <button className="btn danger" onClick={resetRound} disabled={loading}>
              Reset round
            </button>
          </div>
          {debug && (
            <div className="kpis">
              <div>
                <strong>{debug.events}</strong>
                <span>events</span>
              </div>
              <div>
                <strong>{debug.players}</strong>
                <span>players</span>
              </div>
              <div>
                <strong>{debug.triggered}</strong>
                <span>triggered</span>
              </div>
              <div>
                <strong>{debug.gameVersion}</strong>
                <span>game ver</span>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Declencher un evenement</h2>
        <div className="row">
          <input
            className="input"
            placeholder="Nom exact de l'evenement"
            value={triggerName}
            onChange={(e) => setTriggerName(e.target.value)}
          />
          <button className="btn" onClick={triggerEvent} disabled={loading}>
            Declencher
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Ajouter un evenement</h2>
        <div className="row">
          <input
            className="input"
            placeholder="Nouvel intitule"
            value={newEventName}
            onChange={(e) => setNewEventName(e.target.value)}
          />
          <button className="btn" onClick={addEvent} disabled={loading}>
            Ajouter
          </button>
        </div>
        <div className="row">
          <select
            className="input"
            value={newEventCategory}
            onChange={(e) => setNewEventCategory(e.target.value)}
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel">
        <h2>Modifier les intitules</h2>
        <div className="table">
          {events.map((event) => (
            <div className="table-row" key={event.id}>
              <span className={event.triggered ? "pill on" : "pill"}>{event.triggered ? "On" : "Off"}</span>

              {editingId === event.id ? (
                <div className="row">
                  <input
                    className="input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                  />
                  <select
                    className="input"
                    value={editingCategory}
                    onChange={(e) => setEditingCategory(e.target.value)}
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <span className="event-name">
                  {event.name} <small className="event-category">[{event.category}]</small>
                </span>
              )}

              {editingId === event.id ? (
                <div className="row">
                  <button className="btn" onClick={() => saveRename(event.id)} disabled={loading}>
                    Sauver
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setEditingId(null)
                      setEditingName("")
                    }}
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  className="btn ghost"
                    onClick={() => {
                      setEditingId(event.id)
                      setEditingName(event.name)
                      setEditingCategory(event.category || "general")
                    }}
                    disabled={loading}
                >
                  Editer
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {status && <p className="status">{status}</p>}
    </div>
  )
}
