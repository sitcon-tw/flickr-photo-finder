import { Button } from "react-aria-components";
import { pageSize, taskModes } from "./finderCore";
import "./styles.css";

const dataModes = [
  "正式 Google Sheets 公開 CSV",
  "fixtures/photos.csv",
  "tmp/sheets-export/photos.csv",
];

export function App() {
  return (
    <main className="migration-shell">
      <section className="migration-panel" aria-labelledby="migration-title">
        <p className="eyebrow">Pages frontend migration</p>
        <h1 id="migration-title">SITCON Flickr Photo Finder</h1>
        <p>
          React/Vite scaffold is ready for rebuilding the long-term finder UI with mature
          interaction primitives while preserving the existing public data boundary.
        </p>
        <ul>
          {dataModes.map((mode) => (
            <li key={mode}>{mode}</li>
          ))}
        </ul>
        <p className="core-status">
          Shared finder core loaded: {taskModes.length} task modes, {pageSize} photos per page.
        </p>
        <Button type="button">React Aria button</Button>
      </section>
    </main>
  );
}
