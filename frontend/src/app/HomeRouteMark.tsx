export function HomeRouteMark({ className }: { className: string }) {
  return (
    <svg
      className={`home-route-mark ${className}`}
      viewBox="0 0 240 96"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 76h67a20 20 0 0 0 20-20V40a20 20 0 0 1 20-20h117" />
      <path
        className="home-route-guide"
        d="M8 84h67a28 28 0 0 0 28-28V40a12 12 0 0 1 12-12h117"
      />
      <circle cx="8" cy="76" r="4" />
      <circle cx="148" cy="20" r="4" />
      <circle cx="232" cy="20" r="4" />
    </svg>
  );
}
