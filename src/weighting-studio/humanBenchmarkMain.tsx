import React from "react";
import ReactDOM from "react-dom/client";
import { HumanBenchmarkApp } from "./HumanBenchmarkApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HumanBenchmarkApp />
  </React.StrictMode>
);
