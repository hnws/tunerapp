import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadAppConfig } from "./appConfig";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Missing root element with id="root".');
}

// The feature switches decide what the first render shows, so read them before rendering.
void loadAppConfig().then((config) => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App config={config} />
    </React.StrictMode>
  );
});
