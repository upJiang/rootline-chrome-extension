import "@fontsource/nunito/400.css"
import "@fontsource/nunito/600.css"
import "@fontsource/nunito/700.css"
import "@fontsource/fira-code/400.css"
import React from "react"
import ReactDOM from "react-dom/client"
import "../../styles/globals.css"
import "./style.css"
import { InstructionsApp } from "./InstructionsApp"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <InstructionsApp />
  </React.StrictMode>,
)
