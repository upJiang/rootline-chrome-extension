import "@fontsource/nunito/400.css"
import "@fontsource/nunito/600.css"
import "@fontsource/nunito/700.css"
import "@fontsource/fira-code/400.css"
import React, { Component, type ErrorInfo, type ReactNode } from "react"
import ReactDOM, { type Root } from "react-dom/client"
import "../../styles/globals.css"
import "../../styles/components.css"
import "./style.css"
import { PopupApp } from "./PopupApp"

declare global {
  interface Window {
    __ROOTLINE_POPUP_REACT_ROOT__?: Root
  }
}

class PopupErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Rootline Popup failed to render", error, errorInfo)
  }

  override render() {
    if (this.state.failed) {
      return (
        <main className="popup-shell">
          <section className="rl-card space-y-3" role="alert">
            <p className="m-0 text-sm font-semibold">Rootline 界面加载失败</p>
            <p className="rl-muted m-0 text-xs leading-relaxed">开发扩展可能刚完成热更新，请重新加载界面。</p>
            <button className="rl-button rl-button--primary w-full" onClick={() => window.location.reload()} type="button">重新加载</button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

const container = document.getElementById("root")
if (!container) throw new Error("Rootline Popup root element is missing.")
const root = window.__ROOTLINE_POPUP_REACT_ROOT__ ?? ReactDOM.createRoot(container)
window.__ROOTLINE_POPUP_REACT_ROOT__ = root

root.render(
  <React.StrictMode>
    <PopupErrorBoundary>
      <PopupApp />
    </PopupErrorBoundary>
  </React.StrictMode>,
)
