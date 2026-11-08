import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { ColumnPage } from "./pages/ColumnPage";
import { WatchPage } from "./pages/WatchPage";
import { CollectPage } from "./pages/CollectPage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/columns/:kind" element={<ColumnPage />} />
        <Route path="/watch" element={<WatchPage />} />
        <Route path="/collect" element={<CollectPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
