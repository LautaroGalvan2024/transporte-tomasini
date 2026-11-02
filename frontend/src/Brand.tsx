export function Brand({ className = "" }: { className?: string }) {
  return (
    <img
      className={`official-brand ${className}`}
      src="/brand/tomasini.webp"
      width="646"
      height="488"
      alt="Transporte Tomasini"
    />
  );
}
