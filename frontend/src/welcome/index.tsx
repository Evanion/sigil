import { render } from "solid-js/web";
import { TransProvider } from "@mbarzda/solid-i18next";
import { i18nInstance, initI18n } from "../i18n";
import { Welcome } from "./Welcome";
import "../styles/global.css";
import "./welcome.css";

const root = document.getElementById("root");
if (root) {
  // i18next must finish init before the first render so `t()` returns
  // strings rather than keys.
  void initI18n().then(() => {
    render(
      () => (
        <TransProvider instance={i18nInstance}>
          <Welcome />
        </TransProvider>
      ),
      root,
    );
  });
}
