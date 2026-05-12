// URL query serialization for the Pages finder. Keep this independent from DOM
// controls so deep-link behavior stays reviewable and testable.
function urlValue(key, value) {
  return value ? [[key, value]] : [];
}

export function encodeUrlState(state) {
  const params = new URLSearchParams();
  for (const [key, value] of [
    ...urlValue("task", state.taskMode !== "all" ? state.taskMode : ""),
    ...urlValue("q", String(state.search ?? "").trim()),
    ...urlValue("sort", state.sort !== "recommended" ? state.sort : ""),
    ...urlValue("album", state.album),
    ...urlValue("use", state.use),
    ...urlValue("mood", state.mood),
    ...urlValue("scene", state.scene),
    ...urlValue("people", state.peopleCount),
    ...urlValue("subject", state.subjectType),
    ...urlValue("orientation", state.orientation),
    ...urlValue("negative", state.negativeSpace),
    ...urlValue("crop", state.safeCrop),
    ...urlValue("sponsorTag", state.sponsorshipTag),
    ...urlValue("sponsorItem", String(state.sponsorshipItem ?? "").trim()),
    ...urlValue("public", state.publicStatus),
    ...urlValue("priority", state.priority),
    ...urlValue("curation", state.curationStatus),
    ...urlValue("collection", state.collection),
    ...urlValue("selected", [...(state.selectedPhotoIds ?? [])].join(",")),
  ]) {
    params.set(key, value);
  }
  return params;
}

export function decodeUrlState(params) {
  return {
    taskMode: params.get("task") ?? "",
    search: params.get("q") ?? "",
    sort: params.get("sort") ?? "",
    album: params.get("album") ?? "",
    use: params.get("use") ?? "",
    mood: params.get("mood") ?? "",
    scene: params.get("scene") ?? "",
    peopleCount: params.get("people") ?? "",
    subjectType: params.get("subject") ?? "",
    orientation: params.get("orientation") ?? "",
    negativeSpace: params.get("negative") ?? "",
    safeCrop: params.get("crop") ?? "",
    sponsorshipTag: params.get("sponsorTag") ?? "",
    sponsorshipItem: params.get("sponsorItem") ?? "",
    publicStatus: params.get("public") ?? "",
    priority: params.get("priority") ?? "",
    curationStatus: params.get("curation") ?? "",
    collection: params.get("collection") ?? "",
    selectedPhotoIds: (params.get("selected") ?? "").split(",").filter(Boolean),
  };
}
