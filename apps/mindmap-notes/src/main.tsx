import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "katex/dist/katex.min.css";
import "./styles.css";
import App from "./App";
if (new URLSearchParams(window.location.search).has("standalone")) document.title = "数学绘图 · Mathdraw";
const DrawingApp = lazy(() => import("./drawing/DrawingApp"));
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has("drawing") ? (
      <Suspense fallback={<div>正在打开数学绘图…</div>}>
        <DrawingApp />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
