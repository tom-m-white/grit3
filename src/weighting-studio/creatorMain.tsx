import React from "react";
import ReactDOM from "react-dom/client";
import { CreatorApp } from "./CreatorApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CreatorApp />
  </React.StrictMode>
);
