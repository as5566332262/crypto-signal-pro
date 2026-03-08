export function Button({ className = "", variant = "default", ...props }) {
  const variants = {
    default: "bg-slate-900 text-white hover:bg-slate-800",
    outline: "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50",
  };
  return <button className={`${variants[variant] || variants.default} inline-flex items-center justify-center px-4 py-2 ${className}`} {...props} />;
}
