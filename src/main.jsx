import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { ErrorBoundary, chunkReloadOk } from "./ui/components.jsx";

// La app arrancó: si venía de una recarga por archivo viejo, se limpia la marca.
// Si no, un deploy más tarde en la misma pestaña no tendría su recarga.
setTimeout(chunkReloadOk, 4000);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
