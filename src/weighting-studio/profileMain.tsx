import React from "react";
import ReactDOM from "react-dom/client";
import { ProfileApp } from "./ProfileApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ProfileApp />
  </React.StrictMode>
);
