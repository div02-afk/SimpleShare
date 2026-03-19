import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";
import Home from "./home";
import ProjectOverview from "./projectOverview";
import Receive from "./receive";
import Send from "./send";

function PageTracker() {
  const location = useLocation();
  const posthog = usePostHog();

  useEffect(() => {
    if (posthog) {
      posthog.capture("$pageview");
    }
  }, [location, posthog]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <PageTracker />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/send" element={<Send />} />
        <Route path="/receive" element={<Receive />} />
        <Route path="/how-it-works" element={<ProjectOverview />} />
      </Routes>
    </BrowserRouter>
  );
}
