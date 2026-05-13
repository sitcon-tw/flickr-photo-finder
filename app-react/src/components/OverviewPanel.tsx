import type { FinderData } from "../domain";
import { labelFor } from "../filters";

type OverviewPanelProps = {
  data: FinderData;
};

function filledCount(data: FinderData, fieldName: string): number {
  return data.photos.filter((photo) => {
    const value = photo[fieldName];
    return Array.isArray(value) ? value.length > 0 : String(value ?? "").trim() !== "";
  }).length;
}

function countByField(data: FinderData, fieldName: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const photo of data.photos) {
    const rawValue = photo[fieldName];
    const values = (Array.isArray(rawValue) ? rawValue : [rawValue]).map((value) => String(value ?? "").trim()).filter(Boolean);
    if (values.length === 0) {
      counts.set("未填", (counts.get("未填") ?? 0) + 1);
      continue;
    }
    for (const value of values) {
      const label = labelFor(data, fieldName, value);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-Hant-TW"));
}

function ratio(count: number, total: number): string {
  return total > 0 ? `${count} / ${total} (${Math.round((count / total) * 100)}%)` : "0 / 0";
}

export function OverviewPanel({ data }: OverviewPanelProps) {
  const total = data.photos.length;
  const missingPreview = data.photos.filter((photo) => !String(photo.image_preview_url ?? "").trim()).length;
  const summaries = [
    ["整理狀態", ratio(filledCount(data, "curation_status"), total), countByField(data, "curation_status").slice(0, 3)],
    ["使用提醒", ratio(filledCount(data, "public_use_status"), total), countByField(data, "public_use_status").slice(0, 3)],
    ["人數標記", ratio(filledCount(data, "people_count"), total), []],
    ["贊助品項", ratio(filledCount(data, "sponsorship_items"), total), []],
  ] as const;

  return (
    <section className="overview-panel" aria-label="索引概覽">
      <div className="panel-heading">
        <div>
          <h2>索引概覽</h2>
          <p>共 {total} 張照片，{missingPreview} 張缺少縮圖</p>
        </div>
      </div>
      <div className="overview-grid">
        {summaries.map(([title, value, breakdown]) => (
          <article className="overview-item" key={title}>
            <h3>{title}</h3>
            <strong>{value}</strong>
            {breakdown.length > 0 ? (
              <dl>
                {breakdown.map(([label, count]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
