import { useEffect, useMemo, useState } from "react"
import { io } from "socket.io-client"
import OldeupeLogo from "../components/OldeupeLogo.jsx"

export default function ChallengeOverlay() {
  const [state, setState] = useState(null)
  const [content, setContent] = useState({})
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

    socket.on("content", setContent)
    socket.on("state", setState)

    return () => {
      socket.off("content", setContent)
      socket.off("state", setState)
      socket.close()
    }
  }, [overlayKey])

  const challenge = state?.collectiveChallenge || null

  const remainingLabel = useMemo(() => {
    const remainingMs = Number(challenge?.remainingMs || 0)
    const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }, [challenge?.remainingMs])

  if (!challenge) {
    return <div className="challenge-overlay-empty" />
  }

  const logoSrc = typeof content["brand.logo_src"] === "string" ? content["brand.logo_src"] : ""
  const progressRatio = Math.min(1, Math.max(0, Number(challenge.progress || 0) / Math.max(1, Number(challenge.targetCount || 1))))

  return (
    <div className={`challenge-overlay-shell ${challenge.status}`}>
      <div className="challenge-overlay-card">
        <div className="challenge-overlay-head">
          <OldeupeLogo className="brand-logo challenge-overlay-logo" src={logoSrc} />
          <span className={`challenge-overlay-pill ${challenge.status}`}>{challenge.status === "completed" ? "Défi réussi" : "Défi collectif"}</span>
        </div>
        <h2>{challenge.label}</h2>
        <p>{challenge.targetCount} dons consécutifs éligibles en {Math.max(1, Math.round(Number(challenge.durationSeconds || 0) / 60))} minute(s)</p>
        <div className="challenge-overlay-stats">
          <div>
            <span>Progression</span>
            <strong>{challenge.progress} / {challenge.targetCount}</strong>
          </div>
          <div>
            <span>Temps restant</span>
            <strong>{challenge.status === "completed" ? "Terminé" : remainingLabel}</strong>
          </div>
        </div>
        <div className="challenge-overlay-bar">
          <div className="challenge-overlay-bar-fill" style={{ width: `${progressRatio * 100}%` }} />
        </div>
        <div className="challenge-overlay-foot">
          {challenge.status === "completed" ? (
            <strong>Objectif atteint. Vous avez débloqué le défi.</strong>
          ) : (
            <strong>{Math.max(0, Number(challenge.targetCount || 0) - Number(challenge.progress || 0))} dons pour réussir le défi</strong>
          )}
        </div>
      </div>
    </div>
  )
}
