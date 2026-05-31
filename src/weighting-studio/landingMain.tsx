import React from "react";
import ReactDOM from "react-dom/client";
import { LandingApp } from "./LandingApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LandingApp />
  </React.StrictMode>
);
