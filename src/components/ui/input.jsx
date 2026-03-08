export function Input({ className = "", ...props }) {
  return <input className={`w-full border border-slate-200 px-4 py-2 ${className}`} {...props} />;
}
