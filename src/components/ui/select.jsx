import React from "react";

export function Select({ value, onValueChange, children }) {
  const items = React.Children.toArray(children).find((child) => child.type?.displayName === "SelectContent");
  return React.cloneElement(items, { value, onValueChange });
}
export function SelectTrigger({ className = "", children }) {
  return <div className={className}>{children}</div>;
}
export function SelectValue() {
  return null;
}
export function SelectContent({ children, value, onValueChange }) {
  return (
    <select className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {React.Children.map(children, (child) => React.cloneElement(child, { key: child.props.value }))}
    </select>
  );
}
SelectContent.displayName = "SelectContent";
export function SelectItem({ value, children }) {
  return <option value={value}>{children}</option>;
}
