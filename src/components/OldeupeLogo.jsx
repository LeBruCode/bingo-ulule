export default function OldeupeLogo({ className = "", title = "OLDEUPE", src = "" }) {
  const normalizedSrc = typeof src === "string" ? src.trim() : ""

  if (normalizedSrc) {
    return <img className={className} src={normalizedSrc} alt={title} />
  }

  return (
    <div className={`${className} brand-wordmark`} aria-label={title} role="img">
      <span>{title}</span>
    </div>
  )
}
