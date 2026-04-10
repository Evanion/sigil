import { render } from "solid-js/web";
import { initI18n } from "./i18n";
import App from "./App";
import "./styles/global.css";

const root = document.getElementById("app");
if (!root) throw new Error("Root element #app not found");

// i18n must be initialized before the first render so that all
// components have access to translation resources immediately.
initI18n().then(() => {
  render(() => <App />, root);
});
