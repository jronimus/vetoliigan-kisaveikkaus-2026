import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

async function render() {
  const root = createRoot(document.getElementById("root")!);

  await import("./experiment.css");
  const { default: ExperimentApp } = await import("./ExperimentApp.tsx");

  root.render(
    <StrictMode>
      <ExperimentApp />
    </StrictMode>,
  );
}

void render();