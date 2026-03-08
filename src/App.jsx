import { useState } from "react"
import Dashboard from "./pages/Dashboard"
import Scanner from "./pages/Scanner"
import SymbolDetail from "./pages/SymbolDetail"

export default function App() {

  const [page, setPage] = useState("dashboard")

  const renderPage = () => {
    if (page === "dashboard") return <Dashboard/>
    if (page === "scanner") return <Scanner/>
    if (page === "symbol") return <SymbolDetail/>
  }

  return (
    <div>

      <div style={{
        display:"flex",
        gap:20,
        padding:20,
        background:"#111",
        color:"white"
      }}>
        <button onClick={()=>setPage("dashboard")}>Dashboard</button>
        <button onClick={()=>setPage("scanner")}>Scanner</button>
        <button onClick={()=>setPage("symbol")}>Symbol Detail</button>
      </div>

      {renderPage()}

    </div>
  )
}
