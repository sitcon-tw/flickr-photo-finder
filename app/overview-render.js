import { isFilled } from "./search-sort.js";

function countFilled(photos, fieldName) {
  return photos.filter((photo) => isFilled(photo[fieldName])).length;
}

function formatCountRatio(count, total) {
  if (total === 0) {
    return "0 / 0";
  }
  const percent = Math.round((count / total) * 100);
  return `${count} / ${total} (${percent}%)`;
}

function countByField(photos, fieldName, labels = new Map()) {
  const counts = new Map();
  for (const photo of photos) {
    const rawValue = photo[fieldName];
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const normalizedValues = values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (normalizedValues.length === 0) {
      counts.set("未填", (counts.get("未填") ?? 0) + 1);
      continue;
    }
    for (const value of normalizedValues) {
      const label = labels.get(value) ?? value;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-Hant-TW"));
}

function peopleCountBuckets(photos) {
  const buckets = new Map([
    ["未標記", 0],
    ["無人", 0],
    ["1 人", 0],
    ["2-5 人", 0],
    ["6-20 人", 0],
    ["21 人以上", 0],
  ]);

  for (const photo of photos) {
    const value = String(photo.people_count ?? "").trim();
    if (!/^(0|[1-9]\d*)$/.test(value)) {
      buckets.set("未標記", buckets.get("未標記") + 1);
      continue;
    }

    const count = Number(value);
    if (count === 0) {
      buckets.set("無人", buckets.get("無人") + 1);
    } else if (count === 1) {
      buckets.set("1 人", buckets.get("1 人") + 1);
    } else if (count <= 5) {
      buckets.set("2-5 人", buckets.get("2-5 人") + 1);
    } else if (count <= 20) {
      buckets.set("6-20 人", buckets.get("6-20 人") + 1);
    } else {
      buckets.set("21 人以上", buckets.get("21 人以上") + 1);
    }
  }

  return [...buckets.entries()];
}

function reviewedCompletenessCount(photos, photoSchema) {
  const requiredFields = photoSchema?.tables?.photos?.reviewed_required_fields ?? [];
  return photos.filter((photo) => requiredFields.every((fieldName) => isFilled(photo[fieldName]))).length;
}

function makeOverviewItem({ title, value, detail, values = [] }) {
  const item = document.createElement("article");
  item.className = "overview-item";

  const heading = document.createElement("h3");
  heading.textContent = title;
  const valueElement = document.createElement("strong");
  valueElement.textContent = value;
  const detailElement = document.createElement("p");
  detailElement.textContent = detail;

  item.append(heading, valueElement, detailElement);

  if (values.length > 0) {
    const list = document.createElement("dl");
    list.className = "overview-breakdown";
    for (const [label, count] of values) {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = String(count);
      row.append(term, description);
      list.append(row);
    }
    item.append(list);
  }

  return item;
}

export function renderOverview({ photos, photoSchema, elements, optionLabels }) {
  const total = photos.length;
  const reviewedComplete = reviewedCompletenessCount(photos, photoSchema);
  const peopleCountFilled = countFilled(photos, "people_count");
  const subjectTypeFilled = countFilled(photos, "subject_type");
  const sponsorshipItemsFilled = countFilled(photos, "sponsorship_items");
  const sponsorshipTagsFilled = countFilled(photos, "sponsorship_tags");
  const missingPreview = photos.filter((photo) => !isFilled(photo.image_preview_url)).length;

  elements.overviewSummary.textContent = `共 ${total} 張照片，${reviewedComplete} 張已具備 reviewed 必要欄位。`;
  elements.overviewGrid.replaceChildren(
    makeOverviewItem({
      title: "照片總數",
      value: `${total}`,
      detail: `${missingPreview} 張缺少縮圖 URL。`,
    }),
    makeOverviewItem({
      title: "整理狀態",
      value: formatCountRatio(countFilled(photos, "curation_status"), total),
      detail: "metadata 是否人工確認。",
      values: countByField(photos, "curation_status", optionLabels("curation_status")),
    }),
    makeOverviewItem({
      title: "使用提醒",
      value: formatCountRatio(countFilled(photos, "public_use_status"), total),
      detail: "整理者留下的使用提醒。",
      values: countByField(photos, "public_use_status", optionLabels("public_use_status")),
    }),
    makeOverviewItem({
      title: "Reviewed 欄位完整度",
      value: formatCountRatio(reviewedComplete, total),
      detail: "依 photo-schema.json 計算。",
    }),
    makeOverviewItem({
      title: "人數標記",
      value: formatCountRatio(peopleCountFilled, total),
      detail: "支援單人、群眾、無人畫面。",
      values: peopleCountBuckets(photos),
    }),
    makeOverviewItem({
      title: "主要視覺主體",
      value: formatCountRatio(subjectTypeFilled, total),
      detail: "照片海初篩用的粗分類。",
      values: countByField(photos, "subject_type", optionLabels("subject_type")),
    }),
    makeOverviewItem({
      title: "贊助品項",
      value: formatCountRatio(sponsorshipItemsFilled, total),
      detail: "用來找 CFS 贊助品項。",
    }),
    makeOverviewItem({
      title: "贊助價值",
      value: formatCountRatio(sponsorshipTagsFilled, total),
      detail: "品牌露出、互動、佐證等用途。",
    }),
  );
}
