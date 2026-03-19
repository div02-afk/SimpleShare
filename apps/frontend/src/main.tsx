import { PostHogProvider } from "posthog-js/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;

import type { PostHogConfig } from "posthog-js";

const options: Partial<PostHogConfig> = {
  ...(posthogHost && { api_host: posthogHost }),
  defaults: '2026-01-30',
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PostHogProvider apiKey={posthogKey || ""} options={options}>
      <App />
    </PostHogProvider>
  </React.StrictMode>
);
