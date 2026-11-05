import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

declare global {
  interface Window {
    __hideSplash?: () => void;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 界面画出第一帧后，淡出启动动画（动画和窗口显示由 public/splash.js 负责）
requestAnimationFrame(() => requestAnimationFrame(() => window.__hideSplash?.()));
