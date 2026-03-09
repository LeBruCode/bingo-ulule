import { useEffect, useMemo, useState } from "react"
import { io } from "socket.io-client"

export default function Overlay() {
  const [state, setState] = useState(null)

  const overlayKey = new URLSearchParams(window.location.search).get("key") || undefined

  useEffect(() => {
    document.body.classList.add("overlay-mode")
    return () => document.body.classList.remove("overlay-mode")
  }, [])

  useEffect(() => {
    const socket = io(window.location.origin, {
      auth: {
        role: "overlay",
        overlayKey
      },
      transports: ["websocket"],
      upgrade: false
    })

    socket.on("state", setState)

    return () => {
      socket.off("state", setState)
      socket.close()
    }
  }, [overlayKey])

  const tiers = useMemo(() => {
    const byLine = state?.winners?.byLine || {}
    const rows = state?.board?.rows || 0

    return Object.entries(byLine)
      .sort(([a], [b]) => Number(a.replace("line_", "")) - Number(b.replace("line_", "")))
      .map(([key, tokens]) => {
        const lineNumber = Number(key.replace("line_", ""))
        const count = Array.isArray(tokens) ? tokens.length : 0
        const label = lineNumber === rows ? `Carton plein (${lineNumber} lignes)` : `${lineNumber} ligne${lineNumber > 1 ? "s" : ""}`
        return { key, lineNumber, label, count }
      })
  }, [state])

  const nextTier = tiers.find((tier) => tier.count === 0)

  return (
    <div className="overlay-shell">
      <div className="overlay-card">
        <h2>Progression Bingo Live</h2>

        <div className="overlay-meta">
          <span>Événements: {state?.triggered?.length || 0}/{state?.stats?.eventsTotal || 0}</span>
          <span>Joueurs: {state?.stats?.players || 0}</span>
        </div>

        <div className="overlay-tiers">
          {tiers.map((tier) => (
            <div key={tier.key} className={`overlay-tier ${tier.count > 0 ? "done" : ""}`}>
              <span>{tier.label}</span>
              <strong>{tier.count > 0 ? "Gagné" : "En attente"}</strong>
            </div>
          ))}
        </div>

        {nextTier ? (
          <p className="overlay-next">Prochain palier: {nextTier.label}</p>
        ) : (
          <p className="overlay-next">Tous les paliers sont gagnés</p>
        )}
      </div>
    </div>
  )
}
