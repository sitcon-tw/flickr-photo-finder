const scaffoldLinks = [
  { href: "./config/project.json", label: "project config" },
  { href: "./data/interface-registry.json", label: "interface registry" },
  { href: "./data/photo-schema.json", label: "photo schema" },
  { href: "./data/search-aliases.json", label: "search aliases" },
  { href: "./data/tag-taxonomy.json", label: "tag taxonomy" },
];

export function App() {
  return (
    <main className="preview-shell">
      <section className="preview-panel" aria-labelledby="preview-title">
        <p className="preview-kicker">React preview artifact</p>
        <h1 id="preview-title">SITCON Flickr Photo Finder</h1>
        <p>
          This scaffold is intentionally separate from the production Pages artifact. The formal finder still uses the
          vanilla app until the cutover phase is explicitly merged.
        </p>
        <ul className="preview-links" aria-label="Copied public data contracts">
          {scaffoldLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
