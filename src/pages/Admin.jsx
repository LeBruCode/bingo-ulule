import { useEffect, useMemo, useState } from "react"

export default function Admin() {
  const [adminKey, setAdminKey] = useState(localStorage.getItem("bingoAdminKey") || "")
  const [debug, setDebug] = useState(null)
  const [events, setEvents] = useState([])
  const [newEventName, setNewEventName] = useState("")
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState("")
  const [triggerName, setTriggerName] = useState("")
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")

  useEffect(() => {
    localStorage.setItem("bingoAdminKey", adminKey)
  }, [adminKey])

  useEffect(() => {
    if (adminKey) {
      loadDashboard()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        setStatus("Acces refuse: verifie ADMIN_KEY")
        return
      }

      setDebug(debugCall.data)
      setEvents(eventsCall.data.events || [])
      setStatus("Dashboard charge")
    } finally {
      setLoading(false)
    }
  }

  async function addEvent() {
    if (!newEventName.trim()) return
    setLoading(true)
    setStatus("")
    try {
      const { response, data } = await fetchJson("/api/admin/events", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: newEventName })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur ajout: ${data.error || "unknown_error"}`)
        return
      }

      setNewEventName("")
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
        body: JSON.stringify({ name: editingName })
      })

      if (!response.ok || !data.ok) {
        setStatus(`Erreur edition: ${data.error || "unknown_error"}`)
        return
      }

      setEditingId(null)
      setEditingName("")
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

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <div>
          <h1>Live Dashboard</h1>
          <p>Gestion des evenements, du round et du debug live.</p>
        </div>
        <button className="btn ghost" onClick={loadDashboard} disabled={loading}>
          {loading ? "Chargement..." : "Rafraichir"}
        </button>
      </div>

      <div className="admin-grid">
        <section className="panel">
          <h2>Acces securise</h2>
          <input
            className="input"
            placeholder="ADMIN_KEY"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
          />
          <p className="hint">La cle est envoyee dans le header x-admin-key.</p>
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
      </section>

      <section className="panel">
        <h2>Modifier les intitules</h2>
        <div className="table">
          {events.map((event) => (
            <div className="table-row" key={event.id}>
              <span className={event.triggered ? "pill on" : "pill"}>{event.triggered ? "On" : "Off"}</span>

              {editingId === event.id ? (
                <input
                  className="input"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                />
              ) : (
                <span className="event-name">{event.name}</span>
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
