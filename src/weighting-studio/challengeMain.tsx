import React from "react";
import ReactDOM from "react-dom/client";
import { ChallengeApp } from "./ChallengeApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ChallengeApp />
  </React.StrictMode>
);
