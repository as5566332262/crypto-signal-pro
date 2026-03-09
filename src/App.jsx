import { useState } from "react"
import Dashboard from "./pages/Dashboard"
import Scanner from "./pages/Scanner"
import SymbolDetail from "./pages/SymbolDetail"

const navButtonStyle = (active) => ({
  background: active ? "#1e293b" : "transparent",
  color: "white",
  border: active ? "1px solid #334155" : "1px solid transparent",
  padding: "10px 16px",
  borderRadius: 10,
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 600,
})

export default function App() {
  const [page, setPage] = useState("dashboard")

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <div
        style={{
          background: "#020617",
          color: "white",
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #0f172a",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700 }}>Crypto Signal Pro V3</div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => setPage("dashboard")}
            style={navButtonStyle(page === "dashboard")}
          >
            儀表板
          </button>

          <button
            onClick={() => setPage("scanner")}
            style={navButtonStyle(page === "scanner")}
          >
            掃描器
          </button>

          <button
            onClick={() => setPage("symbol")}
            style={navButtonStyle(page === "symbol")}
          >
            幣種詳情
          </button>
        </div>
      </div>

      {page === "dashboard" && <Dashboard />}
      {page === "scanner" && <Scanner />}
      {page === "symbol" && <SymbolDetail />}
    </div>
  )
}
