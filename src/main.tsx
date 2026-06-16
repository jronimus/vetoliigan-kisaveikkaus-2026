import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

function routePath() {
  if (window.location.search === "?view=espn" || window.location.hash.replace(/^#/, "") === "/espn") {
    return "/espn";
  }

  const base = import.meta.env.BASE_URL === "/" ? "" : import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = window.location.pathname.startsWith(base)
    ? window.location.pathname.slice(base.length)
    : window.location.pathname;
  return path.replace(/\/$/, "") || "/";
}

async function render() {
  const root = createRoot(document.getElementById('root')!);

  if (routePath() === "/espn") {
    await import('./experiment.css');
    const { default: ExperimentApp } = await import('./ExperimentApp.tsx');
    root.render(
      <StrictMode>
        <ExperimentApp />
      </StrictMode>,
    );
    return;
  }

  await import('./index.css');
  const { default: App } = await import('./App.tsx');
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void render();
