export function Alert({ className = "", children }) {
  return <div className={`flex items-start gap-2 border p-3 ${className}`}>{children}</div>;
}
export function AlertDescription({ children }) {
  return <div>{children}</div>;
}
