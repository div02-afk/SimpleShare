import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./home";
import ProjectOverview from "./projectOverview";
import Receive from "./receive";
import Send from "./send";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/send" element={<Send />} />
        <Route path="/receive" element={<Receive />} />
        <Route path="/how-it-works" element={<ProjectOverview />} />
      </Routes>
    </BrowserRouter>
  );
}
